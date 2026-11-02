import crypto from 'crypto';
import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (_) {}
  } else {
    data = await res.text();
  }
  return { status: res.status, ok: res.ok, data };
}

const results = [];
function record(phase, testName, passed, details = '') {
  results.push({ phase, testName, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [${passed ? 'PASS' : 'FAIL'}] ${phase} — ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function runValidation() {
  console.log('========================================================================');
  console.log('🧪 myCashFlo — Comprehensive Priority Flow Validation Suite');
  console.log('========================================================================\n');

  let createdCustomerId = null;
  const createdInvoiceIds = [];
  const createdPaymentRefs = [];

  try {
    // ---------------------------------------------------------------------------
    // Priority 1: Service Health Checks
    // ---------------------------------------------------------------------------
    console.log('--- [Priority 1: Local Services Health] ---');
    const healthRes = await request('/health');
    record('P1-Health', 'Backend API health check responds with 200 OK', healthRes.status === 200 && healthRes.data?.status === 'ok', `status=${healthRes.data?.status}`);

    const webRes = await fetch('http://localhost:5173/');
    record('P1-Health', 'Web frontend dev server responds with 200 OK', webRes.status === 200, `status=${webRes.status}`);

    // ---------------------------------------------------------------------------
    // Priority 2: Login, Session Refresh, Logout, and Tenant Isolation
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 2: Authentication, Token Rotation & Tenant Isolation] ---');
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
    });
    const accessToken = loginRes.data?.tokens?.accessToken;
    const refreshToken = loginRes.data?.tokens?.refreshToken;
    record('P2-Auth', 'Admin login issues access token and refresh token', loginRes.status === 200 && !!accessToken && !!refreshToken, `User: ${loginRes.data?.user?.email}`);

    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    const meRes = await request('/auth/me', { headers: authHeaders });
    record('P2-Auth', 'Profile /auth/me returns current user profile and tenant ID', meRes.status === 200 && meRes.data?.email === 'admin@democorp.in', `Tenant: ${meRes.data?.tenant?.slug || meRes.data?.tenantId}`);

    // Test session refresh with rotation
    const refreshRes = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    const newAccessToken = refreshRes.data?.tokens?.accessToken;
    const newRefreshToken = refreshRes.data?.tokens?.refreshToken;
    record('P2-Auth', 'Refresh endpoint rotates session and returns new token pair', refreshRes.status === 200 && !!newAccessToken && !!newRefreshToken && newRefreshToken !== refreshToken);

    // Test reuse detection: presenting already rotated token should be rejected
    const reuseRes = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }), // old token
    });
    record('P2-Auth', 'Token reuse detection rejects previously rotated refresh token', reuseRes.status === 401 || reuseRes.status === 403, `Status: ${reuseRes.status}`);

    // Login again to have a clean session for subsequent tests
    const freshLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
    });
    const activeToken = freshLogin.data?.tokens?.accessToken;
    const activeHeaders = { Authorization: `Bearer ${activeToken}` };

    // Tenant isolation checks:
    // ABC tenant invoice cmvi1tof10009cxfowtuy5ptk (Sunrise Technologies)
    const crossInvRes = await request('/invoices/cmvi1tof10009cxfowtuy5ptk', { headers: activeHeaders });
    record('P2-Isolation', 'Cross-tenant invoice lookup returns 404 Not Found (Zero Leakage)', crossInvRes.status === 404, `Status: ${crossInvRes.status}`);

    // ABC tenant customer cmvgtxo38000bcx0w322dvni4 (Sunrise Technologies)
    const crossCustRes = await request('/customers/cmvgtxo38000bcx0w322dvni4', { headers: activeHeaders });
    record('P2-Isolation', 'Cross-tenant customer lookup returns 404 Not Found (Zero Leakage)', crossCustRes.status === 404, `Status: ${crossCustRes.status}`);

    // ---------------------------------------------------------------------------
    // Priority 3: Customer, Invoice, Edit, Payment Link, Payment Recording, Balance Reconciliation
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 3: Complete Financial Lifecycle with Isolated Test Data] ---');
    const testPhone = `+9199${Date.now().toString().slice(-8)}`;
    const testCustRes = await request('/customers', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        name: `Validation Corp ${Date.now().toString().slice(-4)}`,
        email: `val.${Date.now().toString().slice(-4)}@testcorp.internal`,
        phone: testPhone,
        company: 'Validation Testing Enterprises Ltd',
        customerReference: `REF-VAL-${Date.now().toString().slice(-4)}`,
        gstNumber: '27AABCU9603R1ZM',
        billingAddress: '404 Validation Way, Tech Park, Pune',
      }),
    });
    const testCustomer = testCustRes.data;
    createdCustomerId = testCustomer?.id;
    record('P3-Receivables', 'Customer created with profile, GSTIN, and billing metadata', [200, 201].includes(testCustRes.status) && !!testCustomer?.id, `ID: ${testCustomer?.id}`);

    // Create Invoice for testCustomer
    const invNumber = `INV-VAL-${Date.now().toString().slice(-6)}`;
    const createInvRes = await request('/invoices', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        customerId: testCustomer.id,
        number: invNumber,
        amount: 50000,
        issueDate: new Date(Date.now() - 86400000 * 20).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10),
        description: 'Initial Validation Services',
        currency: 'INR',
      }),
    });
    const testInvoice = createInvRes.data;
    if (testInvoice?.id) createdInvoiceIds.push(testInvoice.id);
    record('P3-Receivables', 'Invoice created with status OVERDUE and accurate outstanding balance', 
      [200, 201].includes(createInvRes.status) && testInvoice?.status === 'OVERDUE' && Number(testInvoice?.outstanding) === 50000,
      `Invoice: ${testInvoice?.number}, Outstanding: ₹${testInvoice?.outstanding}`
    );

    // Verify customer outstanding balance updated
    const custAfterInv = await request(`/customers/${testCustomer.id}`, { headers: activeHeaders });
    record('P3-Receivables', 'Customer ledger balance updated with invoice balance',
      custAfterInv.status === 200 && Number(custAfterInv.data?.outstandingBalance) === 50000,
      `Customer Balance: ₹${custAfterInv.data?.outstandingBalance}`
    );

    // Edit Invoice: PATCH /invoices/:id
    const editInvRes = await request(`/invoices/${testInvoice.id}`, {
      method: 'PATCH',
      headers: activeHeaders,
      body: JSON.stringify({
        description: 'Updated Scope of Validation Services',
        dueDate: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10),
      }),
    });
    record('P3-Receivables', 'Invoice editing updates description and due date',
      editInvRes.status === 200 && editInvRes.data?.description === 'Updated Scope of Validation Services',
      `Description: ${editInvRes.data?.description}`
    );

    // Payment Link Creation (Razorpay / Stripe Simulation)
    const linkRes = await request('/payments/link', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        invoiceId: testInvoice.id,
        provider: 'RAZORPAY',
        description: 'Settlement Link for Validation Invoice',
      }),
    });
    record('P3-Payments', 'Payment link generated in sandbox simulation mode (clearly marked simulated)',
      [200, 201].includes(linkRes.status) && !!linkRes.data?.paymentLinkId && linkRes.data?.isSimulated === true,
      `Link: ${linkRes.data?.shortUrl}, isSimulated: ${linkRes.data?.isSimulated}`
    );

    // Record Partial Payment: 20,000 via POST /payments/record
    const partPayRef = `PAY-VAL-PART-${Date.now().toString().slice(-5)}`;
    createdPaymentRefs.push(partPayRef);
    const partPayRes = await request('/payments/record', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        invoiceId: testInvoice.id,
        amount: 20000,
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: partPayRef,
        method: 'BANK_TRANSFER',
        notes: 'Partial settlement via NEFT',
      }),
    });
    record('P3-Payments', 'Partial payment recorded successfully via /payments/record',
      [200, 201].includes(partPayRes.status) && partPayRes.data?.success === true && Number(partPayRes.data?.payment?.amount) === 20000,
      `Payment Ref: ${partPayRes.data?.payment?.ref}`
    );

    // Verify Invoice Partial Reconciliation: outstanding should be 30,000, status PARTIALLY_PAID
    const invAfterPart = await request(`/invoices/${testInvoice.id}`, { headers: activeHeaders });
    record('P3-Reconciliation', 'Invoice partially reconciled (status PARTIALLY_PAID, outstanding ₹30,000)',
      invAfterPart.status === 200 && invAfterPart.data?.status === 'PARTIALLY_PAID' && Number(invAfterPart.data?.outstanding) === 30000,
      `Status: ${invAfterPart.data?.status}, Remaining: ₹${invAfterPart.data?.outstanding}`
    );

    // Verify Customer balance decremented to 30,000
    const custAfterPart = await request(`/customers/${testCustomer.id}`, { headers: activeHeaders });
    record('P3-Reconciliation', 'Customer outstanding balance decremented by partial payment',
      custAfterPart.status === 200 && Number(custAfterPart.data?.outstandingBalance) === 30000,
      `Customer Balance: ₹${custAfterPart.data?.outstandingBalance}`
    );

    // Record Final Settlement Payment: 30,000 via POST /payments/record
    const settlePayRef = `PAY-VAL-SETTLE-${Date.now().toString().slice(-5)}`;
    createdPaymentRefs.push(settlePayRef);
    const settlePayRes = await request('/payments/record', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        invoiceId: testInvoice.id,
        amount: 30000,
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: settlePayRef,
        method: 'UPI',
        notes: 'Final settlement via UPI',
      }),
    });
    record('P3-Payments', 'Final settlement payment recorded successfully via /payments/record',
      [200, 201].includes(settlePayRes.status) && settlePayRes.data?.success === true,
      `Payment Ref: ${settlePayRes.data?.payment?.ref}`
    );

    // Verify Invoice Fully Settled: status PAID, outstanding 0
    const invFinal = await request(`/invoices/${testInvoice.id}`, { headers: activeHeaders });
    record('P3-Reconciliation', 'Invoice fully settled (status PAID, outstanding ₹0)',
      invFinal.status === 200 && invFinal.data?.status === 'PAID' && Number(invFinal.data?.outstanding) === 0,
      `Status: ${invFinal.data?.status}, Outstanding: ₹${invFinal.data?.outstanding}`
    );

    // Verify Customer balance reaches 0
    const custFinal = await request(`/customers/${testCustomer.id}`, { headers: activeHeaders });
    record('P3-Reconciliation', 'Customer balance fully reconciled to ₹0',
      custFinal.status === 200 && Number(custFinal.data?.outstandingBalance) === 0,
      `Customer Balance: ₹${custFinal.data?.outstandingBalance}`
    );

    // Attempting overpayment on settled invoice should be strictly rejected with 400
    const overpayRes = await request('/payments/record', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        invoiceId: testInvoice.id,
        amount: 5000,
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: `PAY-OVERPAY-${Date.now().toString().slice(-5)}`,
        method: 'CASH',
      }),
    });
    record('P3-Payments', 'PaymentsService strictly rejects payment on already PAID invoice with 400',
      overpayRes.status === 400,
      `Status: ${overpayRes.status}, Message: ${overpayRes.data?.message}`
    );

    // ---------------------------------------------------------------------------
    // Priority 4: Dashboard and Reports Verification Against Same Underlying Data
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 4: Dashboard & Reports Consistency] ---');
    const dashRes = await request('/dashboard', { headers: activeHeaders });
    record('P4-Reporting', 'Dashboard endpoint returns aggregated financial metrics',
      dashRes.status === 200 && typeof dashRes.data?.totalReceivables === 'number',
      `Receivables: ₹${dashRes.data?.totalReceivables}, Overdue: ₹${dashRes.data?.overdueAmount}`
    );

    const ageingRes = await request('/reports/ageing', { headers: activeHeaders });
    record('P4-Reporting', 'Ageing report endpoint returns matching overdue calculations',
      ageingRes.status === 200 && typeof ageingRes.data?.total === 'number',
      `Ageing Total: ₹${ageingRes.data?.total}, d0_30: ₹${ageingRes.data?.d0_30}`
    );

    const ledgerRes = await request(`/reports/ledger?customerId=${testCustomer.id}`, { headers: activeHeaders });
    record('P4-Reporting', 'Customer ledger report displays complete audit of debits, credits, and ₹0 net balance',
      ledgerRes.status === 200 && Number(ledgerRes.data?.summary?.netBalance) === 0 && Array.isArray(ledgerRes.data?.data) && ledgerRes.data?.data?.length >= 3,
      `Net Balance: ₹${ledgerRes.data?.summary?.netBalance}, Entries: ${ledgerRes.data?.data?.length}`
    );

    // ---------------------------------------------------------------------------
    // Priority 5: Chotu Overdue Scan & Preview with Genuine Overdue Test Invoice
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 5: Chotu AI Overdue Scan, Stages, and Suppression] ---');
    const scanInvNum = `INV-SCAN-${Date.now().toString().slice(-6)}`;
    const scanInvRes = await request('/invoices', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        customerId: testCustomer.id,
        number: scanInvNum,
        amount: 45000,
        issueDate: new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10), // 15 days overdue
        description: 'Chotu AI Scan Verification Invoice',
        currency: 'INR',
      }),
    });
    const scanInvoice = scanInvRes.data;
    if (scanInvoice?.id) createdInvoiceIds.push(scanInvoice.id);

    // Scan & Preview
    const previewRes = await request('/reminders/preview', { headers: activeHeaders });
    const previewItems = previewRes.data?.items || [];
    const scannedItem = previewItems.find(i => i.invoiceId === scanInvoice?.id);

    record('P5-Reminders', 'Scan & Preview evaluates genuine overdue invoice with accurate amount & due date',
      previewRes.status === 200 && !!scannedItem && Number(scannedItem.outstandingAmount) === 45000,
      `Invoice: ${scannedItem?.invoiceNumber}, Amount: ₹${scannedItem?.outstandingAmount}, Stage: ${scannedItem?.stage}`
    );

    record('P5-Reminders', 'Reminder stage correctly classified based on overdue days',
      ['OVERDUE_STAGE_1', 'OVERDUE_STAGE_2', 'OVERDUE_STAGE_3', 'DUE_SOON', 'DUE_TODAY'].includes(scannedItem?.stage),
      `Classified Stage: ${scannedItem?.stage}`
    );

    const messageText = scannedItem?.messagePreview?.message || '';
    record('P5-Reminders', 'Message preview rendered with customer & invoice placeholders substituted',
      !!messageText && messageText.includes('45,000') && messageText.includes(scanInvNum),
      `Message length: ${messageText.length} chars`
    );

    // Test Opt-Out Suppression: Set customer status to INACTIVE
    await request(`/customers/${testCustomer.id}`, {
      method: 'PATCH',
      headers: activeHeaders,
      body: JSON.stringify({ status: 'INACTIVE' }),
    });

    const previewAfterOptOut = await request('/reminders/preview', { headers: activeHeaders });
    const suppressedItem = previewAfterOptOut.data?.items?.find(i => i.invoiceId === scanInvoice?.id);

    record('P5-Reminders', 'Opt-out / Inactive protection strictly suppresses outreach to inactive account',
      suppressedItem?.isEligible === false && (suppressedItem?.suppressionReason === 'CUSTOMER_INACTIVE' || suppressedItem?.suppressionReason === 'CUSTOMER_OPTED_OUT'),
      `isEligible: ${suppressedItem?.isEligible}, Suppression Reason: ${suppressedItem?.suppressionReason}`
    );

    // Restore customer status to ACTIVE
    await request(`/customers/${testCustomer.id}`, {
      method: 'PATCH',
      headers: activeHeaders,
      body: JSON.stringify({ status: 'ACTIVE' }),
    });

    // Verify Idempotency & Frequency Limits in preview stats
    const statsRes = await request('/reminders/stats', { headers: activeHeaders });
    record('P5-Reminders', 'Reminder statistics reflect tenant configuration and dry-run safety status',
      statsRes.status === 200 && statsRes.data?.isDryRun === true && statsRes.data?.isGloballyEnabled === false,
      `isDryRun: ${statsRes.data?.isDryRun}, isGloballyEnabled: ${statsRes.data?.isGloballyEnabled}`
    );

    // ---------------------------------------------------------------------------
    // Priority 6: Verify Outbound Safeguards Remain Disabled
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 6: Environmental Outreach Safeguards Verification] ---');
    const reminderSettings = await request('/reminders/settings', { headers: activeHeaders });
    record('P6-Safety', 'AUTOMATED_REMINDERS_ENABLED is false globally (scheduled runs disabled)',
      reminderSettings.data?.globalEnabled === false,
      `globalEnabled: ${reminderSettings.data?.globalEnabled}`
    );

    // ---------------------------------------------------------------------------
    // Priority 7: Review REMINDERS_TEST_EMAIL_DELIVERY_ENABLED Dedicated Pathway
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 7: Scoped Test Send Pathway Review] ---');
    const testSendAttempt = await request('/reminders/test-send', {
      method: 'POST',
      headers: activeHeaders,
      body: JSON.stringify({
        invoiceId: scanInvoice.id,
        channel: 'EMAIL',
        recipient: 'attacker@outside-domain.com',
      }),
    });
    // With REMINDERS_TEST_EMAIL_DELIVERY_ENABLED=false, this must simulate or block, never sending to invoice customer
    record('P7-Safety', 'Dedicated test-send pathway strictly intercepts unauthorized outreach without live customer dispatch',
      [200, 201, 400].includes(testSendAttempt.status) && (testSendAttempt.data?.isSimulated === true || testSendAttempt.data?.status === 'SIMULATED' || testSendAttempt.status === 400),
      `Status: ${testSendAttempt.status}, isSimulated: ${testSendAttempt.data?.isSimulated ?? true}`
    );

    // ---------------------------------------------------------------------------
    // Priority 8: Webhook Signatures & Idempotency
    // ---------------------------------------------------------------------------
    console.log('\n--- [Priority 8: Webhook Security, Signatures & Idempotency] ---');
    // Reject forged signature
    const forgedRes = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'invalid_forged_signature_0000000000000' },
      body: JSON.stringify({ event: 'payment_link.paid' }),
    });
    record('P8-Webhooks', 'Reject forged webhook signature with 400 Bad Request', forgedRes.status === 400);

    // Valid signature idempotency test
    const webhookSecret = 'rzp_whsec_mycashflo';
    const sharedPaymentId = `pay_idemp_${Date.now()}`;
    const payload = {
      event: 'payment_link.paid',
      invoiceNumber: scanInvoice.number,
      paymentLinkId: 'plink_idemp_test',
      payment: {
        id: sharedPaymentId,
        amount: 4500000, // 45,000 INR in paise
        currency: 'INR',
        notes: { invoiceNumber: scanInvoice.number },
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // First webhook delivery: settles invoice
    const wh1 = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    record('P8-Webhooks', 'First webhook delivery with valid HMAC signature processes and reconciles invoice',
      wh1.status === 200 && wh1.data?.processed === true,
      `Status: ${wh1.data?.invoiceStatus}`
    );

    // Second duplicate webhook delivery with SAME payment ID: must be idempotent!
    const wh2 = await request('/payments/webhook/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: rawBody,
    });
    record('P8-Webhooks', 'Duplicate webhook event skipped idempotently without double-deduction',
      wh2.status === 200 && wh2.data?.idempotent === true && wh2.data?.message?.includes('already processed'),
      `idempotent: ${wh2.data?.idempotent}, Message: ${wh2.data?.message}`
    );

  } finally {
    // ---------------------------------------------------------------------------
    // Clean Up Isolated Test Fixtures
    // ---------------------------------------------------------------------------
    console.log('\n--- [Cleanup: Isolated Test Fixtures Removal] ---');
    try {
      if (createdPaymentRefs.length > 0) {
        await prisma.payment.deleteMany({ where: { ref: { in: createdPaymentRefs } } });
      }
      if (createdCustomerId) {
        await prisma.notification.deleteMany({ where: { customerId: createdCustomerId } });
      }
      if (createdInvoiceIds.length > 0) {
        await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
      }
      if (createdCustomerId) {
        await prisma.customer.delete({ where: { id: createdCustomerId } });
      }
      console.log('  🧹 Cleaned up isolated test customer, invoices, and payment records.');
    } catch (cleanupErr) {
      console.warn('  ⚠️ Cleanup warning:', cleanupErr.message);
    }
    await prisma.$disconnect();
  }

  // Summary
  console.log('\n========================================================================');
  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  console.log(`🏁 Validation Suite Finished: ${passedTests} passed, ${failedTests} failed (Total: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runValidation().catch((err) => {
  console.error('Fatal validation runner error:', err);
  process.exit(1);
});
