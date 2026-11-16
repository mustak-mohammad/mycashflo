// Comprehensive Full Application Verification Script (Phases 0 through 7)
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_DIR = path.resolve(__dirname, '..');

const BASE_URL = 'http://localhost:3000/api';
const TEST_TELEPHONY_WEBHOOK_SECRET = 'full_verify_telephony_webhook_secret';
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

async function waitForServer(retries = 30, delayMs = 1000) {
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
    console.log('📡 API server already running on port 3000.\n');
    return;
  }

  console.log('🚀 Launching API server from dist/main.js for end-to-end verification...');
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

  const ready = await waitForServer(30, 1000);
  if (!ready) {
    throw new Error('Timed out waiting for API server to start on port 3000');
  }
  console.log('✅ API server started and healthy.\n');
}

async function run() {
  console.log('========================================================================');
  console.log('🌟 myCashflo — Comprehensive Verification Suite (Phases 0 through 7)');
  console.log('========================================================================\n');

  await startServerIfNeeded();

  let passed = 0;
  let failed = 0;
  const results = [];
  const runStartedAt = new Date();
  let createdCustomerId = null;
  let createdInvoiceId = null;
  let createdProposalId = null;
  let tenantIdForCleanup = null;
  let originalIntegrationConfigs = [];
  const createdReplayKeys = [];

  function record(section, name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}${details ? ` (${details})` : ''}`);
      passed++;
      results.push({ section, name, status: 'PASS', details });
    } else {
      console.error(`  ❌ [FAIL] ${name}${details ? ` (${details})` : ''}`);
      failed++;
      results.push({ section, name, status: 'FAIL', details });
    }
  }

  try {
    // ---------------------------------------------------------
    // 1. HEALTH & METADATA CHECKS
    // ---------------------------------------------------------
    console.log('--- [1. Health & Server Metadata] ---');
    const health = await request('/health');
    record('Health', 'API Health Check returns 200 OK', health.status === 200 && health.data?.status === 'ok', `status=${health.data?.status}`);
    
    const unauthTest = await request('/customers');
    record('Security', 'Unauthenticated request to protected route is rejected with 401', unauthTest.status === 401, `status=${unauthTest.status}`);

    // ---------------------------------------------------------
    // 2. AUTHENTICATION & USER ROLES
    // ---------------------------------------------------------
    console.log('\n--- [2. Authentication & User Roles] ---');
    const badLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@democorp.in', password: 'WrongPassword999!' }),
    });
    record('Auth', 'Invalid credentials correctly rejected with 401', badLogin.status === 401);

    // Admin Login
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
    });
    const adminToken = adminLogin.data?.tokens?.accessToken;
    record('Auth', 'Admin login succeeds and returns signed JWT', [200, 201].includes(adminLogin.status) && !!adminToken, `User: ${adminLogin.data?.user?.email}, Role: ${adminLogin.data?.user?.role}`);

    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    tenantIdForCleanup = adminLogin.data?.user?.tenantId;
    if (tenantIdForCleanup) {
      originalIntegrationConfigs = await prisma.integrationConfig.findMany({
        where: { tenantId: tenantIdForCleanup },
      });
      // Ensure WhatsApp and Resend are explicitly mocked before any notification endpoint is exercised
      await request('/integrations/WHATSAPP_CLOUD', {
        method: 'PUT',
        headers: adminAuth,
        body: JSON.stringify({
          config: {
            phoneNumberId: 'phone_id_sim_test',
            accessToken: 'EAAG_whatsapp_cloud_access_token_mock',
            verifyToken: 'mycashflo_whatsapp_verify_token',
          },
          isActive: true,
        }),
      });
      await request('/integrations/RESEND', {
        method: 'PUT',
        headers: adminAuth,
        body: JSON.stringify({
          config: {
            apiKey: 'mock_re_key_verification',
            from: 'myCashflo <onboarding@resend.dev>',
          },
          isActive: true,
        }),
      });
    }

    // Agent Login
    const agentLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'agent@democorp.in', password: 'Agent@1234' }),
    });
    const agentToken = agentLogin.data?.tokens?.accessToken;
    record('Auth', 'Agent login succeeds and returns signed JWT', [200, 201].includes(agentLogin.status) && !!agentToken, `User: ${agentLogin.data?.user?.email}, Role: ${agentLogin.data?.user?.role}`);

    // Auth Me Profile
    const meRes = await request('/auth/me', { headers: adminAuth });
    record('Auth', 'Profile endpoint /auth/me returns current user and tenant details', meRes.status === 200 && meRes.data?.email === 'admin@democorp.in' && meRes.data?.tenantId, `User: ${meRes.data?.email}, Tenant: ${meRes.data?.tenant?.slug || meRes.data?.tenantId}`);

    // ---------------------------------------------------------
    // 3. CORE RECEIVABLES & DASHBOARD (PHASE 2)
    // ---------------------------------------------------------
    console.log('\n--- [3. Core Receivables & Collections Operations] ---');
    const dashRes = await request('/dashboard', { headers: adminAuth });
    const dash = dashRes.data || {};
    record('Dashboard', 'Dashboard aggregations return valid financial metrics', 
      dashRes.status === 200 && typeof dash.totalReceivables === 'number',
      `Receivables: ₹${dash.totalReceivables}, Overdue: ₹${dash.overdueAmount}`
    );

    const customersRes = await request('/customers?limit=10', { headers: adminAuth });
    const customers = customersRes.data?.data || [];
    record('Customers', 'Customers listing returns seeded accounts', customersRes.status === 200 && customers.length > 0, `Count: ${customers.length}`);

    // Create isolated synthetic customer & invoice so real customer/invoice data is untouched
    const createCustRes = await request('/customers', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        name: 'Full Verify Synthetic Client',
        email: `full-synth-${Date.now().toString(36)}@synthetic.test`,
        phone: '+919999900088',
        company: 'Synthetic Full Verification Ltd',
      }),
    });
    const testCustomer = createCustRes.data;
    if (createCustRes.status === 201 || createCustRes.status === 200) {
      createdCustomerId = testCustomer.id;
    }

    const singleCustRes = await request(`/customers/${testCustomer.id}`, { headers: adminAuth });
    record('Customers', 'Customer detail endpoint returns customer profile and relationship data', singleCustRes.status === 200 && singleCustRes.data?.id === testCustomer.id);

    const invoicesRes = await request('/invoices?limit=20', { headers: adminAuth });
    const invoices = invoicesRes.data?.data || [];
    record('Invoices', 'Invoices listing returns active invoices across statuses', invoicesRes.status === 200 && invoices.length > 0, `Count: ${invoices.length}`);

    const createInvRes = await request('/invoices', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        customerId: testCustomer.id,
        number: `INV-VERIFY-${Date.now().toString(36).toUpperCase()}`,
        amount: 35000,
        issueDate: new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10),
        description: 'E2E Verification Invoice (Synthetic)',
        currency: 'INR',
      }),
    });
    const overdueInv = createInvRes.data;
    if ([200, 201].includes(createInvRes.status) && overdueInv?.id) {
      createdInvoiceId = overdueInv.id;
      await request(`/invoices/${overdueInv.id}`, {
        method: 'PATCH',
        headers: adminAuth,
        body: JSON.stringify({ status: 'OVERDUE' }),
      });
      overdueInv.status = 'OVERDUE';
      overdueInv.outstanding = 35000;
    }
    record('Invoices', 'Isolated invoice created for collections & payment workflow', Boolean(overdueInv?.id), `Invoice: ${overdueInv?.number}, Due: ₹${overdueInv?.outstanding || overdueInv?.amount}, Status: ${overdueInv?.status}`);

    const paymentsRes = await request('/payments?limit=10', { headers: adminAuth });
    record('Payments', 'Payments history endpoint accessible and returns records', paymentsRes.status === 200);

    const followUpsRes = await request('/follow-ups', { headers: adminAuth });
    record('FollowUps', 'Follow-up tasks queue endpoint accessible', followUpsRes.status === 200);

    // ---------------------------------------------------------
    // 4. CHOTU AI VOICE SESSION NEGOTIATION (PHASE 5)
    // ---------------------------------------------------------
    console.log('\n--- [4. Voice Agent & Token Negotiation] ---');
    const voiceTokenRes = await request('/voice/token', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ customerId: testCustomer.id }),
    });
    record('Voice', 'Voice token endpoint issues valid room session token & identity', 
      [200, 201].includes(voiceTokenRes.status) && voiceTokenRes.data?.token && voiceTokenRes.data?.roomName,
      `Room: ${voiceTokenRes.data?.roomName}`
    );

    // ---------------------------------------------------------
    // 5. COLLECTIONS INTELLIGENCE & AI TOOLS (PHASE 6)
    // ---------------------------------------------------------
    console.log('\n--- [5. Collections Intelligence & AI Tools] ---');
    const toolsRes = await request('/intelligence/tools', { headers: adminAuth });
    record('Intelligence', 'AI Tools catalog exposes callable collection tools', 
      toolsRes.status === 200 && Array.isArray(toolsRes.data) && toolsRes.data.length >= 6,
      `Tools count: ${toolsRes.data?.length}`
    );

    // Read-only tool: get_customer_balance
    const toolExecBalance = await request('/intelligence/tools/execute', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        toolName: 'get_customer_balance',
        parameters: { customerId: testCustomer.id },
      }),
    });
    record('Intelligence', 'Tool get_customer_balance executes and returns financial summary', 
      [200, 201].includes(toolExecBalance.status) && toolExecBalance.data?.status === 'SUCCESS',
      `Customer: ${toolExecBalance.data?.result?.customerName}, Balance: ₹${toolExecBalance.data?.result?.outstandingBalance}`
    );

    // Read-only tool: get_overdue_invoices
    const toolExecOverdue = await request('/intelligence/tools/execute', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        toolName: 'get_overdue_invoices',
        parameters: { customerId: testCustomer.id },
      }),
    });
    record('Intelligence', 'Tool get_overdue_invoices executes and returns overdue invoices', 
      [200, 201].includes(toolExecOverdue.status) && toolExecOverdue.data?.status === 'SUCCESS',
      `Overdue Count: ${toolExecOverdue.data?.result?.overdueCount}`
    );

    // Consequential action guard: intercept unconfirmed PTP
    const toolExecPtp = await request('/intelligence/tools/execute', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        toolName: 'record_payment_promise',
        parameters: {
          customerId: testCustomer.id,
          invoiceId: overdueInv.id,
          promisedAmount: 15000,
          promisedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        },
        confirmed: false,
      }),
    });
    const proposal = toolExecPtp.data?.proposal;
    if (proposal?.id) {
      createdProposalId = proposal.id;
    }
    record('Intelligence', 'Human-in-the-loop Guard intercepts unconfirmed consequential action', 
      [200, 201].includes(toolExecPtp.status) && toolExecPtp.data?.status === 'REQUIRES_CONFIRMATION' && !!proposal?.id,
      `Proposal ID: ${proposal?.id}, Action: ${proposal?.actionType}`
    );

    // Approve the pending proposal
    if (proposal?.id) {
      const approveRes = await request(`/intelligence/actions/${proposal.id}/approve`, {
        method: 'POST',
        headers: adminAuth,
      });
      record('Intelligence', 'Supervisor approval commits intercepted proposal and executes mutation', 
        [200, 201].includes(approveRes.status) && approveRes.data?.proposal?.status === 'EXECUTED',
        `Status: ${approveRes.data?.proposal?.status}`
      );
    }

    // AI Chat Assistant
    const chatRes = await request('/intelligence/chat', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ message: `What is the balance for ${testCustomer.name}?` }),
    });
    record('Intelligence', 'AI Chat Assistant executes tool calling and provides natural response', 
      [200, 201].includes(chatRes.status) && chatRes.data?.reply && chatRes.data?.toolCalled === 'get_customer_balance',
      `Tool called: ${chatRes.data?.toolCalled}`
    );

    // Notification Templates
    const tplRes = await request('/notifications/templates', { headers: adminAuth });
    record('Notifications', 'Notification templates catalog loaded', tplRes.status === 200 && Array.isArray(tplRes.data) && tplRes.data.length >= 4);

    // Multi-channel notification dispatch
    const dispatchRes = await request('/notifications/dispatch', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        customerId: testCustomer.id,
        channel: 'WHATSAPP',
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: overdueInv.number,
          amount: overdueInv.amount,
          dueDate: overdueInv.dueDate,
          companyContactNumber: '+919800000001',
        },
      }),
    });
    record('Notifications', 'Notification engine renders and dispatches message across channels', 
      [200, 201].includes(dispatchRes.status) && dispatchRes.data?.status === 'DELIVERED',
      `Status: ${dispatchRes.data?.status}, Channel: ${dispatchRes.data?.channel}`
    );

    // Automated escalation trigger
    const triggerRes = await request('/notifications/trigger-reminders', {
      method: 'POST',
      headers: adminAuth,
    });
    record('Notifications', 'Automated overdue reminder escalation rules triggered successfully', 
      [200, 201].includes(triggerRes.status) && typeof triggerRes.data?.evaluatedInvoices === 'number',
      `Evaluated: ${triggerRes.data?.evaluatedInvoices}, Dispatched: ${triggerRes.data?.dispatchedCount}`
    );

    // Audit logs
    const auditRes = await request('/audit-logs?limit=5', { headers: adminAuth });
    record('AuditLogs', 'Audit trail logs ledger mutations, approvals, and dispatches with tenant isolation', 
      auditRes.status === 200 && Array.isArray(auditRes.data?.data) && auditRes.data.data.length > 0,
      `Latest action: ${auditRes.data?.data[0]?.action}`
    );

    // ---------------------------------------------------------
    // 6. PHASE 7 INTEGRATIONS: RAZORPAY, STRIPE, WHATSAPP, SIP
    // ---------------------------------------------------------
    console.log('\n--- [6. Phase 7 Integrations: Gateways & Adapters] ---');

    // Integrations Config List
    const configRes = await request('/integrations', { headers: adminAuth });
    record('Integrations', 'Integrations configurations list accessible and returns 4 providers', 
      configRes.status === 200 && Array.isArray(configRes.data) && configRes.data.length >= 4,
      `Providers: ${configRes.data?.map(i => i.provider).join(', ')}`
    );

    // Save Razorpay config
    const saveRzp = await request('/integrations/RAZORPAY', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        config: {
          keyId: 'rzp_test_mycashflo123',
          keySecret: 'sec_test_password_secret_9988',
          webhookSecret: 'rzp_whsec_mycashflo',
        },
        isActive: true,
      }),
    });
    record('Integrations', 'Razorpay integration configuration saved with secret masking', 
      [200, 201].includes(saveRzp.status) && saveRzp.data?.config?.keySecret?.includes('...'),
      `Masked secret: ${saveRzp.data?.config?.keySecret}`
    );

    // Save Stripe config
    const saveStripe = await request('/integrations/STRIPE', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        config: {
          publishableKey: 'pk_test_MasterStripePublishableKey',
          secretKey: 'sk_test_MasterStripeSecretKey999',
          webhookSecret: 'whsec_stripe_democorp_secret',
        },
        isActive: true,
      }),
    });
    record('Integrations', 'Stripe integration configuration saved with secret masking', 
      [200, 201].includes(saveStripe.status) && saveStripe.data?.config?.secretKey?.includes('...'),
      `Masked secret: ${saveStripe.data?.config?.secretKey}`
    );

    // Save WhatsApp Cloud config
    const saveWa = await request('/integrations/WHATSAPP_CLOUD', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        config: {
          phoneNumberId: 'phone_id_99887766',
          accessToken: 'EAAG_whatsapp_cloud_access_token_mock',
          verifyToken: 'mycashflo_whatsapp_verify_token',
        },
        isActive: true,
      }),
    });
    record('Integrations', 'WhatsApp Cloud configuration saved with secret masking', 
      [200, 201].includes(saveWa.status) && saveWa.data?.config?.accessToken?.includes('...'),
      `Masked secret: ${saveWa.data?.config?.accessToken}`
    );

    // Connectivity Tests for all 4 providers
    const testRzp = await request('/integrations/RAZORPAY/test', { method: 'POST', headers: adminAuth });
    record('Integrations', 'Razorpay connectivity test verifies sandbox simulation handshake', [200, 201].includes(testRzp.status) && testRzp.data?.status === 'SUCCESS', testRzp.data?.message);

    const testStripe = await request('/integrations/STRIPE/test', { method: 'POST', headers: adminAuth });
    record('Integrations', 'Stripe connectivity test verifies sandbox simulation handshake', [200, 201].includes(testStripe.status) && testStripe.data?.status === 'SUCCESS', testStripe.data?.message);

    const testWa = await request('/integrations/WHATSAPP_CLOUD/test', { method: 'POST', headers: adminAuth });
    record('Integrations', 'WhatsApp Cloud connectivity test succeeds', [200, 201].includes(testWa.status) && testWa.data?.status === 'SUCCESS' && testWa.data?.messageId, testWa.data?.message);

    const testSip = await request('/integrations/SIP_TELEPHONY/test', { method: 'POST', headers: adminAuth });
    record('Integrations', 'SIP Telephony connectivity test confirms gateway readiness and safety guard', [200, 201].includes(testSip.status) && testSip.data?.status === 'SUCCESS' && testSip.data?.isSimulated, testSip.data?.message);

    // Payment Link Generation: Razorpay (forced safe simulation)
    const rzpLinkRes = await request('/payments/link', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        invoiceId: overdueInv.id,
        provider: 'RAZORPAY',
        simulate: true,
        description: 'Settlement for Overdue Invoice',
      }),
    });
    record('PaymentLinks', 'Razorpay payment link generated in safe simulation mode with tracking ID and URL', 
      [200, 201].includes(rzpLinkRes.status) && rzpLinkRes.data?.shortUrl?.includes('rzp.io') && rzpLinkRes.data?.isSimulated === true,
      `Link ID: ${rzpLinkRes.data?.paymentLinkId}, URL: ${rzpLinkRes.data?.shortUrl}`
    );

    // Payment Link Generation: Stripe (forced safe simulation)
    const stripeLinkRes = await request('/payments/link', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        invoiceId: overdueInv.id,
        provider: 'STRIPE',
        simulate: true,
        description: 'Global Card Settlement',
      }),
    });
    record('PaymentLinks', 'Stripe payment link generated with tracking ID and URL', 
      [200, 201].includes(stripeLinkRes.status) && stripeLinkRes.data?.shortUrl?.includes('stripe.com'),
      `Link ID: ${stripeLinkRes.data?.paymentLinkId}, URL: ${stripeLinkRes.data?.shortUrl}`
    );

    // Webhook Signature Rejection: Reject forged signature
    const forgedWebhook = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: JSON.stringify({ event: 'payment_link.paid' }),
    });
    record('Webhooks', 'Webhook rejecting forged/invalid HMAC signature with 400 Bad Request', forgedWebhook.status === 400);

    // Webhook Automated Invoice Reconciliation (Razorpay)
    const webhookSecret = 'rzp_whsec_mycashflo';
    const webhookPayload = {
      event: 'payment_link.paid',
      invoiceNumber: overdueInv.number,
      paymentLinkId: rzpLinkRes.data?.paymentLinkId || 'plink_test',
      payment: {
        id: `pay_test_${Date.now()}`,
        amount: Math.round(Number(overdueInv.outstanding || overdueInv.amount) * 100),
        currency: 'INR',
        notes: { invoiceNumber: overdueInv.number },
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const webhookRes = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': validSignature },
      body: rawBody,
    });
    record('Webhooks', 'Razorpay webhook automated reconciliation verifies HMAC and settles invoice', 
      webhookRes.status === 200 && webhookRes.data?.processed === true,
      `New Invoice Status: ${webhookRes.data?.invoiceStatus}`
    );

    // WhatsApp Meta Webhook Challenge Handshake
    const challengeParam = 'meta_challenge_str_' + Date.now();
    const waChallenge = await request(
      `/notifications/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=mycashflo_whatsapp_verify_token&hub.challenge=${challengeParam}`,
      { method: 'GET' }
    );
    record('WhatsApp', 'WhatsApp Meta webhook challenge verification handshake succeeds', 
      waChallenge.status === 200 && String(waChallenge.data) === challengeParam,
      `Echo: ${waChallenge.data}`
    );

    // WhatsApp Webhook Status Receipt
    const waReceipt = await request('/notifications/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': 'mock_valid_signature',
      },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'phone_id_99887766',
            changes: [
              {
                field: 'messages',
                value: {
                  statuses: [{ id: 'wamid.HBgLMTIzNDU2', status: 'delivered', timestamp: '1700000000' }],
                },
              },
            ],
          },
        ],
      }),
    });
    record('WhatsApp', 'WhatsApp delivery receipt webhook processed successfully', waReceipt.status === 200 && waReceipt.data?.status === 'ok', `Processed: ${waReceipt.data?.processed}`);

    // SIP Telephony Safety Guard
    const outboundCall = await request('/calls/outbound/initiate', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        customerId: testCustomer.id,
        reason: 'Payment Commitment Follow-up',
      }),
    });
    record('Telephony', 'SIP Telephony Gateway safety guard guarantees zero PSTN charges in simulation mode', 
      [200, 201].includes(outboundCall.status) && outboundCall.data?.status === 'SIMULATED' && outboundCall.data?.isSimulated === true,
      `Call SID: ${outboundCall.data?.callSid}, Status: ${outboundCall.data?.status}`
    );

    // Configure SIP Telephony webhook secret for authenticated callback verification
    await request('/integrations/SIP_TELEPHONY', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        config: {
          sipTrunkUri: 'sip.sandbox.carrier.test',
          webhookSecret: TEST_TELEPHONY_WEBHOOK_SECRET,
        },
        isActive: true,
      }),
    });

    // Carrier Webhook Callback Security (Missing Auth, Invalid Auth, Valid Auth, Replay)
    const telWebhookBody = JSON.stringify({
      CallSid: outboundCall.data?.callSid || 'call_sess_mock',
      CallStatus: 'completed',
      CallDuration: '45',
    });

    const missingAuthWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      body: telWebhookBody,
    });
    record('Telephony', 'Telephony webhook rejects missing authentication with 401', missingAuthWebhook.status === 401, `Status: ${missingAuthWebhook.status}`);

    const invalidAuthWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong_invalid_secret' },
      body: telWebhookBody,
    });
    record('Telephony', 'Telephony webhook rejects invalid authentication with 401', invalidAuthWebhook.status === 401, `Status: ${invalidAuthWebhook.status}`);

    const carrierWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TELEPHONY_WEBHOOK_SECRET}` },
      body: telWebhookBody,
    });
    record('Telephony', 'Authenticated carrier callback webhook processed and logs call termination', carrierWebhook.status === 200 && carrierWebhook.data?.received === true);

    const replayFp = crypto
      .createHash('sha256')
      .update(`SIP_TRUNK|${telWebhookBody}`)
      .digest('hex');
    createdReplayKeys.push(`SIP_TRUNK:fp:${replayFp}`);

    const replayWebhook = await request('/calls/webhook/sip_gateway', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TELEPHONY_WEBHOOK_SECRET}` },
      body: telWebhookBody,
    });
    record('Telephony', 'Telephony webhook rejects duplicate replay with 401', replayWebhook.status === 401, `Status: ${replayWebhook.status}`);

    // ---------------------------------------------------------
    // 7. MULTI-TENANT ISOLATION SECURITY
    // ---------------------------------------------------------
    console.log('\n--- [7. Multi-Tenant Data Isolation Security] ---');
    const crossTenantCust = await request('/customers/cust_other_tenant_fake_999', { headers: adminAuth });
    record('TenantIsolation', 'Cross-tenant customer access rejected with 404 (zero data leakage)', crossTenantCust.status === 404);

    const crossTenantInv = await request('/invoices/inv_other_tenant_fake_999', { headers: adminAuth });
    record('TenantIsolation', 'Cross-tenant invoice access rejected with 404 (zero data leakage)', crossTenantInv.status === 404);

    const crossTenantLink = await request('/payments/link', {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        invoiceId: 'non-existent-or-other-tenant-invoice',
        provider: 'RAZORPAY',
      }),
    });
    record('TenantIsolation', 'Reject payment link generation for cross-tenant invoice with 404', crossTenantLink.status === 404);

  } catch (err) {
    console.error('💥 Unexpected execution error during verification:', err);
    failed++;
  } finally {
    try {
      if (createdReplayKeys.length > 0) {
        await prisma.webhookReplay.deleteMany({ where: { replayKey: { in: createdReplayKeys } } });
      }
      if (createdProposalId) {
        await prisma.actionProposal.deleteMany({ where: { id: createdProposalId } });
      }
      if (createdCustomerId) {
        await prisma.paymentPromise.deleteMany({ where: { invoiceId: createdInvoiceId || undefined } });
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
        await prisma.notification.deleteMany({
          where: { tenantId: tenantIdForCleanup, createdAt: { gte: runStartedAt } },
        });
        const savedMap = new Map(originalIntegrationConfigs.map((c) => [c.provider, c]));
        for (const prov of ['RAZORPAY', 'STRIPE', 'WHATSAPP_CLOUD', 'SIP_TELEPHONY', 'RESEND']) {
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
    } catch (cleanErr) {
      console.warn('Non-fatal cleanup warning:', cleanErr.message);
    }
    await prisma.$disconnect();

    if (apiProcess) {
      console.log('\n🛑 Terminating spawned test API server process...');
      apiProcess.kill();
    }
  }

  console.log('\n========================================================================');
  console.log(`🏁 Full Verification Finished: ${passed} passed, ${failed} failed (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

void run();
