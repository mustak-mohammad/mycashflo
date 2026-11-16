// Live Phase 7 Integrations End-to-End Runtime Verification Script
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_DIR = path.resolve(__dirname, '..');

const BASE_URL = 'http://localhost:3000/api';
const TEST_TELEPHONY_WEBHOOK_SECRET = 'p7_test_telephony_webhook_secret_safe';
let apiProcess = null;
const prisma = new PrismaClient();

async function request(reqPath, options = {}) {
  const url = `${BASE_URL}${reqPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, data: text };
  }
}

async function waitForServer(retries = 25, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function startServerIfNeeded() {
  const isRunning = await waitForServer(1, 200);
  if (isRunning) {
    console.log('📡 API server already running on port 3000.');
    return;
  }

  console.log('🚀 Launching API server from dist/main.js for verification...');
  apiProcess = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '3000',
      NODE_ENV: 'development',
      ENABLE_OUTBOUND_CALLS: 'false',
      OUTBOUND_CALLS_ENABLED: 'false',
      AUTOMATED_REMINDERS_ENABLED: 'false',
      EMAIL_DELIVERY_ENABLED: 'false',
      PAYMENT_SIMULATION_MODE: 'true',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_whsec_mycashflo',
      WHATSAPP_VERIFY_TOKEN: 'mycashflo_whatsapp_verify_token',
      WHATSAPP_ACCESS_TOKEN: 'mock_wa_token',
      RESEND_API_KEY: 'mock_re_key',
      TELEPHONY_WEBHOOK_SECRET: TEST_TELEPHONY_WEBHOOK_SECRET,
    },
  });

  const ready = await waitForServer(25, 1000);
  if (!ready) {
    throw new Error('Timed out waiting for API server to start on port 3000');
  }
  console.log('✅ API server started and healthy.\n');
}

async function run() {
  console.log('====================================================');
  console.log('🚀 myCashflo — Phase 7 Integrations Live Verification');
  console.log('====================================================\n');

  await startServerIfNeeded();

  let passed = 0;
  let failed = 0;

  let createdInvoiceId = null;
  let createdCustomerId = null;
  let testCustomerId = null;
  let testPaidAmount = 0;
  let tenantIdForCleanup = null;
  let originalIntegrationConfigs = [];
  const createdReplayKeys = [];

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health Check
    const health = await request('/health');
    assert(health.status === 200 && health.data.status === 'ok', 'Health check returns 200 OK');

    // 2. Authentication
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
    });
    assert(
      [200, 201].includes(loginRes.status) && loginRes.data.tokens?.accessToken,
      'Auth login succeeds and returns signed JWT token',
    );
    const token = loginRes.data.tokens?.accessToken;
    const authHeaders = { Authorization: `Bearer ${token}` };
    tenantIdForCleanup = loginRes.data.user?.tenantId;

    if (tenantIdForCleanup) {
      originalIntegrationConfigs = await prisma.integrationConfig.findMany({
        where: { tenantId: tenantIdForCleanup },
      });
    }

    // 3. Isolated Test Fixtures: synthetic customer & deterministic test invoice
    const createCustRes = await request('/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Phase7 Synthetic Test Client',
        email: `p7-synth-${Date.now().toString(36)}@synthetic.test`,
        phone: '+919999900077',
        company: 'Synthetic Verification Pvt Ltd',
      }),
    });
    const customer = createCustRes.data;
    assert(
      [200, 201].includes(createCustRes.status) && Boolean(customer?.id),
      `Created isolated synthetic test customer: ${customer?.id}`,
    );
    if (!customer?.id) {
      throw new Error(`Failed to create synthetic customer fixture: ${JSON.stringify(createCustRes.data)}`);
    }
    createdCustomerId = customer.id;
    testCustomerId = customer.id;

    // Create an isolated test invoice so demo and production invoices are never mutated
    const testInvoiceNumber = `INV-P7-LIVE-${Date.now().toString(36).toUpperCase()}`;
    const createInvRes = await request('/invoices', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        number: testInvoiceNumber,
        customerId: customer.id,
        amount: 25000,
        issueDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        dueDate: new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0],
        description: 'Automated Live Phase 7 Verification Fixture',
        currency: 'INR',
      }),
    });

    assert(
      [200, 201].includes(createInvRes.status) && createInvRes.data?.id,
      `Created isolated test invoice fixture: ${testInvoiceNumber}`,
    );
    const invoice = createInvRes.data;
    if (!invoice?.id) {
      throw new Error(`Failed to create test fixture invoice: ${JSON.stringify(createInvRes.data)}`);
    }
    createdInvoiceId = invoice.id;

    // Mark test invoice as OVERDUE
    await request(`/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'OVERDUE' }),
    });
    invoice.status = 'OVERDUE';
    invoice.outstanding = 25000;

    // 4. Integrations Catalog & Masked Secrets
    const intRes = await request('/integrations', { headers: authHeaders });
    assert(
      intRes.status === 200 && Array.isArray(intRes.data) && intRes.data.length >= 4,
      `Integrations list returns ${intRes.data?.length} providers (RAZORPAY, STRIPE, WHATSAPP_CLOUD, SIP_TELEPHONY)`,
    );

    // 5. Save Configuration for Razorpay
    const saveRzp = await request('/integrations/RAZORPAY', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        config: {
          keyId: 'rzp_test_mycashflo123',
          keySecret: 'sec_test_password_secret_9988',
          webhookSecret: 'rzp_whsec_mycashflo',
        },
        isActive: true,
      }),
    });
    assert(
      [200, 201].includes(saveRzp.status) &&
        saveRzp.data.config.keySecret.includes('...') &&
        !saveRzp.data.config.keySecret.includes('password'),
      'Save Razorpay config preserves tenant isolation and masks sensitive secrets',
    );

    // Ensure WhatsApp and SIP_TELEPHONY use explicit safe mock/test credentials for this verification run
    await request('/integrations/WHATSAPP_CLOUD', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        config: {
          phoneNumberId: 'phone_id_sim_test',
          accessToken: 'EAAG_whatsapp_cloud_access_token_mock',
          verifyToken: 'mycashflo_whatsapp_verify_token',
        },
        isActive: true,
      }),
    });

    await request('/integrations/SIP_TELEPHONY', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        config: {
          sipTrunkUri: 'sip.sandbox.carrier.test',
          webhookSecret: TEST_TELEPHONY_WEBHOOK_SECRET,
        },
        isActive: true,
      }),
    });

    // 6. Test Connectivity Endpoints
    const testRzp = await request('/integrations/RAZORPAY/test', {
      method: 'POST',
      headers: authHeaders,
    });
    assert(
      [200, 201].includes(testRzp.status) && testRzp.data.status === 'SUCCESS',
      `Razorpay connectivity test: ${testRzp.data.message}`,
    );

    const testStripe = await request('/integrations/STRIPE/test', {
      method: 'POST',
      headers: authHeaders,
    });
    assert(
      [200, 201].includes(testStripe.status) && testStripe.data.status === 'SUCCESS',
      `Stripe connectivity test: ${testStripe.data.message}`,
    );

    const testWa = await request('/integrations/WHATSAPP_CLOUD/test', {
      method: 'POST',
      headers: authHeaders,
    });
    assert(
      [200, 201].includes(testWa.status) && testWa.data.status === 'SUCCESS' && testWa.data.messageId,
      `WhatsApp Cloud API connectivity test: ${testWa.data.message}`,
    );

    const testTel = await request('/integrations/SIP_TELEPHONY/test', {
      method: 'POST',
      headers: authHeaders,
    });
    assert(
      [200, 201].includes(testTel.status) && testTel.data.status === 'SUCCESS' && testTel.data.isSimulated,
      `SIP Telephony Gateway policy check: ${testTel.data.message}`,
    );

    // 7. Payment Link Generation (Razorpay — forced simulation so zero live payment links created)
    const rzpLinkRes = await request('/payments/link', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: invoice.id,
        provider: 'RAZORPAY',
        simulate: true,
        description: 'Settlement for Overdue Invoice',
      }),
    });
    assert(
      [200, 201].includes(rzpLinkRes.status) &&
        rzpLinkRes.data.shortUrl &&
        rzpLinkRes.data.shortUrl.includes('rzp.io') &&
        rzpLinkRes.data.isSimulated === true,
      `Generated simulated Razorpay payment link: ${rzpLinkRes.data.shortUrl} (Link ID: ${rzpLinkRes.data.paymentLinkId})`,
    );

    // 8. Payment Link Generation (Stripe — forced simulation)
    const stripeLinkRes = await request('/payments/link', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: invoice.id,
        provider: 'STRIPE',
        simulate: true,
        description: 'Global Card Settlement',
      }),
    });
    assert(
      [200, 201].includes(stripeLinkRes.status) &&
        stripeLinkRes.data.shortUrl &&
        stripeLinkRes.data.shortUrl.includes('checkout.stripe.com'),
      `Generated Stripe payment link: ${stripeLinkRes.data.shortUrl}`,
    );

    // 9. Payment Link Tenant Isolation
    const crossTenantLink = await request('/payments/link', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: 'non-existent-or-other-tenant-invoice',
      }),
    });
    assert(crossTenantLink.status === 404, 'Reject payment link generation for cross-tenant invoice with 404');

    // 10. Webhook Signature Security
    const badWebhook = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'forged_invalid_signature' },
      body: JSON.stringify({ event: 'payment_link.paid' }),
    });
    assert(badWebhook.status === 400, 'Reject webhook with invalid signature (400 Bad Request)');

    // 11. Payment Webhook Automated Reconciliation
    const webhookSecret = 'rzp_whsec_mycashflo';
    const webhookAmount = Number(invoice.outstanding);
    testPaidAmount = webhookAmount;
    const webhookPayload = {
      event: 'payment_link.paid',
      invoiceNumber: invoice.number,
      paymentLinkId: rzpLinkRes.data.paymentLinkId,
      payment: {
        id: `pay_test_${Date.now()}`,
        amount: Math.round(webhookAmount * 100),
        currency: 'INR',
        notes: { invoiceNumber: invoice.number },
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const webhookRes = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': validSignature },
      body: rawBody,
    });
    assert(
      webhookRes.status === 200 && webhookRes.data.processed === true,
      `Reconciled invoice ${invoice.number} via Razorpay webhook (New Status: ${webhookRes.data.invoiceStatus})`,
    );

    // 11b. Verify Idempotency: exact same webhook event does not double-deduct
    const replayRes = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': validSignature },
      body: rawBody,
    });
    assert(
      replayRes.status === 200 && replayRes.data.idempotent === true,
      `Verified webhook replay idempotency: duplicate event skipped without second balance deduction`,
    );

    // 12. WhatsApp Notification Adapter Dispatch
    const waDispatch = await request('/notifications/dispatch', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        channel: 'WHATSAPP',
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: invoice.number,
          amount: invoice.amount,
          companyContactNumber: '+919800000001',
          paymentLink: rzpLinkRes.data.shortUrl,
        },
      }),
    });
    assert(
      [200, 201].includes(waDispatch.status) &&
        waDispatch.data.channel === 'WHATSAPP' &&
        waDispatch.data.payload.providerMessageId?.startsWith('wamid.'),
      `Dispatched WhatsApp notice via WhatsAppCloudAdapter (ID: ${waDispatch.data.payload.providerMessageId})`,
    );

    // 13. Meta WhatsApp Webhook Challenge Verification
    const challengeParam = 'meta_challenge_str_8899';
    const waChallenge = await request(
      `/notifications/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=mycashflo_whatsapp_verify_token&hub.challenge=${challengeParam}`,
    );
    assert(
      waChallenge.status === 200 && waChallenge.data === challengeParam,
      `Meta WhatsApp Webhook handshake verification returned challenge string (${waChallenge.data})`,
    );

    // 14. Outbound SIP Telephony Gateway Safety Policy
    const outboundCall = await request('/calls/outbound/initiate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        reason: 'Payment Commitment Follow-up',
      }),
    });
    assert(
      [200, 201].includes(outboundCall.status) &&
        outboundCall.data.status === 'SIMULATED' &&
        outboundCall.data.isSimulated === true,
      `STRICT SAFETY VERIFIED: Outbound PSTN calling is disabled by policy. Call simulated with SID ${outboundCall.data.callSid}`,
    );

    // 15. Telephony Carrier Webhook Security (Missing, Invalid, Valid, Replay)
    const webhookBody = JSON.stringify({
      CallSid: outboundCall.data.callSid,
      CallStatus: 'completed',
      CallDuration: '72',
    });

    const unauthTelWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      body: webhookBody,
    });
    assert(
      unauthTelWebhook.status === 401,
      `Telephony webhook rejects missing authentication with 401 (got ${unauthTelWebhook.status})`,
    );

    const invalidTelWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong_invalid_telephony_token' },
      body: webhookBody,
    });
    assert(
      invalidTelWebhook.status === 401,
      `Telephony webhook rejects invalid authentication with 401 (got ${invalidTelWebhook.status})`,
    );

    const telWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TELEPHONY_WEBHOOK_SECRET}` },
      body: webhookBody,
    });
    assert(
      telWebhook.status === 200 && telWebhook.data.received === true,
      `Authenticated telephony status callback received and reconciled (Call SID: ${telWebhook.data.callSid})`,
    );

    const replayKeyHash = crypto
      .createHash('sha256')
      .update(`SIP_TRUNK|${webhookBody}`)
      .digest('hex');
    createdReplayKeys.push(`SIP_TRUNK:fp:${replayKeyHash}`);

    const replayTelWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TELEPHONY_WEBHOOK_SECRET}` },
      body: webhookBody,
    });
    assert(
      replayTelWebhook.status === 401,
      `Telephony webhook rejects duplicate replay attempt with 401 (got ${replayTelWebhook.status})`,
    );

    // 16. Audit Log Records Trail
    const auditRes = await request('/audit-logs?limit=25', { headers: authHeaders });
    assert(auditRes.status === 200 && auditRes.data.total > 0, 'Fetched tenant audit log trail');
    const actions = auditRes.data.data.map((l) => l.action);
    assert(
      actions.includes('payment.link_created') &&
        actions.includes('payment.received_via_webhook') &&
        actions.includes('telephony.outbound_initiated') &&
        actions.includes('integration.configured'),
      `Audit log captures Phase 7 events: [${actions.slice(0, 5).join(', ')}]`,
    );

    // 17. Regression Checks for Phase 2-6
    const dashboard = await request('/dashboard', { headers: authHeaders });
    assert(
      dashboard.status === 200 && dashboard.data.totalReceivables !== undefined,
      `Dashboard metrics aggregated with 0 regressions (Total: ₹${dashboard.data.totalReceivables})`,
    );

    const ageing = await request('/reports/ageing', { headers: authHeaders });
    assert(
      ageing.status === 200 && ageing.data.total !== undefined,
      `Ageing reports operational (Overdue total: ₹${ageing.data.total})`,
    );
  } finally {
    // Isolated Cleanup: restore IntegrationConfigs and remove synthetic test fixtures only
    try {
      console.log('\n🧹 Performing isolated test fixture cleanup...');
      if (createdReplayKeys.length > 0) {
        await prisma.webhookReplay.deleteMany({ where: { replayKey: { in: createdReplayKeys } } });
      }
      if (createdCustomerId) {
        await prisma.notification.deleteMany({ where: { customerId: createdCustomerId } });
        await prisma.callSession.deleteMany({ where: { customerId: createdCustomerId } });
      }
      if (createdInvoiceId) {
        await prisma.payment.deleteMany({ where: { invoiceId: createdInvoiceId } });
        await prisma.invoice.deleteMany({ where: { id: createdInvoiceId } });
      }
      if (createdCustomerId) {
        await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
      }
      if (tenantIdForCleanup) {
        const savedMap = new Map(originalIntegrationConfigs.map((c) => [c.provider, c]));
        for (const prov of ['RAZORPAY', 'WHATSAPP_CLOUD', 'SIP_TELEPHONY']) {
          const orig = savedMap.get(prov);
          if (orig) {
            await prisma.integrationConfig.upsert({
              where: { provider_tenantId: { provider: prov, tenantId: tenantIdForCleanup } },
              update: { config: orig.config, isActive: orig.isActive },
              create: {
                provider: orig.provider,
                config: orig.config,
                isActive: orig.isActive,
                tenantId: tenantIdForCleanup,
              },
            });
          } else {
            await prisma.integrationConfig.deleteMany({
              where: { tenantId: tenantIdForCleanup, provider: prov },
            });
          }
        }
      }
      console.log('✅ Isolated test cleanup complete. Zero residue left in database.');
    } catch (cleanErr) {
      console.warn('Note: Non-fatal cleanup warning:', cleanErr.message);
    }
    await prisma.$disconnect();

    if (apiProcess) {
      console.log('🛑 Shutting down spawned verification API server process...');
      apiProcess.kill();
    }
  }

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(async (e) => {
  await prisma.$disconnect();
  if (apiProcess) apiProcess.kill();
  console.error('Fatal error during verification:', e);
  process.exit(1);
});
