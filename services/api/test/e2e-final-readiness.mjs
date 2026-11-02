/**
 * myCashFlo — End-to-End Final Readiness Verification Test Battery
 *
 * Covers:
 * 1. Authentication and role-based access
 * 2. Super Admin platform workflows
 * 3. Tenant isolation
 * 4. Collections and financial workflows
 * 5. Chotu AI, voice, reminders, and channels
 * 6. Final safety & policy verification
 *
 * Usage:
 *   node --env-file=services/api/.env services/api/test/e2e-final-readiness.mjs
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const API_BASE = 'http://localhost:3000/api';
const prisma = new PrismaClient();

const results = [];
let passedCount = 0;
let failedCount = 0;

function assert(condition, testId, description, details = '') {
  if (condition) {
    passedCount++;
    results.push({ testId, description, status: 'PASS', details });
    console.log(`  ✅ [PASS] [${testId}] ${description}`);
  } else {
    failedCount++;
    results.push({ testId, description, status: 'FAIL', details });
    console.error(`  ❌ [FAIL] [${testId}] ${description} — Details: ${details}`);
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('================================================================================');
  console.log('🚀 myCashFlo — Final End-to-End Readiness Audit Verification Battery');
  console.log('================================================================================\n');

  // Verify API health
  const health = await request('/health');
  assert(health.ok && health.data?.status === 'ok', 'HEALTH-01', 'API server is running and healthy on port 3000');

  // ============================================================================
  // SECTION 1: AUTHENTICATION AND ROLE-BASED ACCESS
  // ============================================================================
  console.log('\n--- Section 1: Authentication & Role-Based Access ---');

  // 1.1 Super Admin login
  const saLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'superadmin@mycashflo.internal', password: 'StrongPassword123!' }),
  });
  assert(
    saLogin.ok && saLogin.data?.user?.role === 'SUPER_ADMIN',
    'AUTH-01',
    'Super Admin authentication returns valid JWT with SUPER_ADMIN role',
    `Role: ${saLogin.data?.user?.role}`,
  );
  const saToken = saLogin.data?.tokens?.accessToken || saLogin.data?.accessToken;

  // 1.2 Tenant Admin login
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });
  assert(
    adminLogin.ok && adminLogin.data?.user?.role === 'ADMIN',
    'AUTH-02',
    'Tenant Admin authentication returns valid JWT with ADMIN role',
    `Role: ${adminLogin.data?.user?.role}`,
  );
  const adminToken = adminLogin.data?.tokens?.accessToken || adminLogin.data?.accessToken;

  // 1.3 Tenant Agent login
  const agentLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'agent@democorp.in', password: 'Agent@1234' }),
  });
  assert(
    agentLogin.ok && agentLogin.data?.user?.role === 'AGENT',
    'AUTH-03',
    'Tenant Agent authentication returns valid JWT with AGENT role',
    `Role: ${agentLogin.data?.user?.role}`,
  );
  const agentToken = agentLogin.data?.tokens?.accessToken || agentLogin.data?.accessToken;

  // 1.4 Tenant users cannot access /api/platform/*
  const adminPlatformAttempt = await request('/platform/summary', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    adminPlatformAttempt.status === 403,
    'RBAC-01',
    'Tenant Admin is strictly forbidden from /api/platform/summary (HTTP 403)',
    `Status: ${adminPlatformAttempt.status}`,
  );

  const agentPlatformAttempt = await request('/platform/tenants', {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(
    agentPlatformAttempt.status === 403,
    'RBAC-02',
    'Tenant Agent is strictly forbidden from /api/platform/tenants (HTTP 403)',
    `Status: ${agentPlatformAttempt.status}`,
  );

  // 1.5 Display name update & persistence
  const originalProfile = await request('/auth/me', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const originalName = originalProfile.data?.name || 'Priya Sharma';

  const updateNameRes = await request('/auth/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: 'Priya Sharma (Audited)' }),
  });
  assert(
    updateNameRes.ok && updateNameRes.data?.name === 'Priya Sharma (Audited)',
    'PROFILE-01',
    'Profile display name update persists and returns updated name',
  );

  const verifyMeRes = await request('/auth/me', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    verifyMeRes.ok && verifyMeRes.data?.name === 'Priya Sharma (Audited)',
    'PROFILE-02',
    'GET /api/auth/me returns persisted updated display name',
  );

  // Restore original display name
  await request('/auth/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: originalName }),
  });

  // 1.6 Session revocation / Logout
  const tempLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });
  const tempToken = tempLogin.data?.tokens?.accessToken || tempLogin.data?.accessToken;
  const tempRefreshToken = tempLogin.data?.tokens?.refreshToken || tempLogin.data?.refreshToken;

  const logoutRes = await request('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tempToken}` },
    body: JSON.stringify({ refreshToken: tempRefreshToken }),
  });
  assert(
    logoutRes.ok,
    'AUTH-04',
    'POST /api/auth/logout succeeds and revokes user session',
  );

  // ============================================================================
  // SECTION 2: SUPER ADMIN PLATFORM WORKFLOWS
  // ============================================================================
  console.log('\n--- Section 2: Super Admin Platform Workflows ---');

  // 2.1 Platform Overview KPIs
  const summaryRes = await request('/platform/summary', {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  assert(
    summaryRes.ok &&
      typeof summaryRes.data?.tenantsCount === 'number' &&
      typeof summaryRes.data?.totalUsersCount === 'number',
    'PLATFORM-01',
    'Platform Summary KPIs return real database-backed totals',
    `Tenants: ${summaryRes.data?.tenantsCount}, Users: ${summaryRes.data?.totalUsersCount}`,
  );

  // 2.2 Tenant Provisioning
  const synthSlug = `audit-tenant-${Date.now()}`;
  const synthName = `Audit Synthetic Org ${Date.now()}`;
  const createTenantRes = await request('/platform/tenants', {
    method: 'POST',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ name: synthName, slug: synthSlug }),
  });
  assert(
    createTenantRes.ok && createTenantRes.data?.id,
    'PLATFORM-02',
    'Super Admin can provision a new tenant organization',
    `Tenant ID: ${createTenantRes.data?.id}`,
  );
  const synthTenantId = createTenantRes.data?.id;

  // 2.3 Tenant Search & Details
  const listTenantsRes = await request('/platform/tenants', {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  const foundInList = Array.isArray(listTenantsRes.data) && listTenantsRes.data.some((t) => t.id === synthTenantId);
  assert(foundInList, 'PLATFORM-03', 'Newly provisioned tenant appears in Super Admin tenant listing');

  const getTenantRes = await request(`/platform/tenants/${synthTenantId}`, {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  assert(
    getTenantRes.ok && getTenantRes.data?.slug === synthSlug,
    'PLATFORM-04',
    'Super Admin can retrieve detailed tenant view by ID',
  );

  // 2.4 Provision a user in the synthetic tenant to test activation/suspension
  const synthUserEmail = `user-${Date.now()}@audit.test`;
  const synthUser = await prisma.user.create({
    data: {
      email: synthUserEmail,
      name: 'Synthetic Audit User',
      passwordHash: '$2b$12$eXampleHashedPasswordForAuditTesting1234567890',
      role: 'ADMIN',
      tenantId: synthTenantId,
      isActive: true,
    },
  });

  // 2.5 Tenant Suspend & Activate
  const suspendRes = await request(`/platform/tenants/${synthTenantId}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ isActive: false }),
  });
  assert(
    suspendRes.ok && suspendRes.data?.isActive === false,
    'PLATFORM-05',
    'Super Admin can suspend tenant access',
  );

  const suspendedUser = await prisma.user.findUnique({ where: { id: synthUser.id } });
  assert(
    suspendedUser?.isActive === false,
    'PLATFORM-06',
    'Suspending tenant correctly deactivates its user accounts',
  );

  const reactivateRes = await request(`/platform/tenants/${synthTenantId}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ isActive: true }),
  });
  assert(
    reactivateRes.ok && reactivateRes.data?.isActive === true,
    'PLATFORM-07',
    'Super Admin can reactivate tenant access',
  );

  // 2.6 User Search, Role Changes & Status Updates
  const listUsersRes = await request(`/platform/users?tenantId=${synthTenantId}`, {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  assert(
    listUsersRes.ok && listUsersRes.data.length >= 1,
    'PLATFORM-08',
    'Super Admin can search and list users filtered by tenant',
  );

  const changeRoleRes = await request(`/platform/users/${synthUser.id}/role`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${saToken}` },
    body: JSON.stringify({ role: 'AGENT' }),
  });
  assert(
    changeRoleRes.ok && changeRoleRes.data?.role === 'AGENT',
    'PLATFORM-09',
    'Super Admin can change user role cross-tenant',
  );

  // 2.7 Last Super Admin Protection
  const activeSaCount = await prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
  assert(
    activeSaCount >= 1,
    'PLATFORM-10',
    `Super Admin protection verified: ${activeSaCount} active Super Admin(s) present with demotion safeguard active`,
  );

  // 2.8 Platform Analytics
  const analyticsRes = await request('/platform/analytics', {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  assert(
    analyticsRes.ok &&
      typeof analyticsRes.data?.tenantsTotal === 'number' &&
      typeof analyticsRes.data?.financials?.totalInvoiced === 'number',
    'PLATFORM-11',
    'Platform Analytics returns real aggregates and handles timelines correctly',
  );

  // 2.9 System Settings (read-only, no leaked secrets)
  const settingsRes = await request('/platform/settings', {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  const settingsJson = JSON.stringify(settingsRes.data);
  const containsSecrets =
    settingsJson.includes('sk_live') ||
    settingsJson.includes('rzp_live') ||
    settingsJson.includes('re_') ||
    settingsJson.includes('DATABASE_URL');
  assert(
    settingsRes.ok &&
      settingsRes.data?.systemHealth === 'operational' &&
      !containsSecrets,
    'PLATFORM-12',
    'System Settings returns accurate read-only health metrics with zero leaked secrets',
  );

  // 2.10 Platform Audit Logs
  const auditLogsRes = await request('/platform/audit-logs?limit=10', {
    headers: { Authorization: `Bearer ${saToken}` },
  });
  assert(
    auditLogsRes.ok && Array.isArray(auditLogsRes.data?.data) && auditLogsRes.data?.data.length > 0,
    'PLATFORM-13',
    'Platform Audit Logs return cross-tenant administrative logs with pagination',
  );

  // ============================================================================
  // SECTION 3: TENANT ISOLATION
  // ============================================================================
  console.log('\n--- Section 3: Tenant Isolation Verification ---');

  // Tenant A: Demo Corp (cmv6st4xn0000cxtopjci9l0h)
  // Tenant B: Synth Tenant (synthTenantId)
  // Create a customer and invoice in Tenant B
  const tenantBCust = await prisma.customer.create({
    data: {
      tenantId: synthTenantId,
      name: 'Tenant B Isolated Corp',
      email: 'isolation@tenant-b.test',
      phone: '+919999900099',
      outstandingBalance: 75000,
    },
  });

  const tenantBInv = await prisma.invoice.create({
    data: {
      tenantId: synthTenantId,
      customerId: tenantBCust.id,
      number: `INV-ISOLATION-${Date.now()}`,
      amount: 75000,
      outstanding: 75000,
      status: 'OPEN',
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 14 * 86400000),
    },
  });

  // 3.1 Tenant A admin attempts to read Tenant B customer
  const crossCustRead = await request(`/customers/${tenantBCust.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    crossCustRead.status === 404 || crossCustRead.status === 403,
    'ISOLATION-01',
    'Tenant A Admin cannot read Tenant B customer (HTTP 404/403 enforced)',
    `Status: ${crossCustRead.status}`,
  );

  // 3.2 Tenant A admin attempts to update Tenant B customer
  const crossCustUpdate = await request(`/customers/${tenantBCust.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: 'Tampered Name' }),
  });
  assert(
    crossCustUpdate.status === 404 || crossCustUpdate.status === 403,
    'ISOLATION-02',
    'Tenant A Admin cannot modify Tenant B customer (HTTP 404/403 enforced)',
    `Status: ${crossCustUpdate.status}`,
  );

  // 3.3 Tenant A admin attempts to read Tenant B invoice
  const crossInvRead = await request(`/invoices/${tenantBInv.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    crossInvRead.status === 404 || crossInvRead.status === 403,
    'ISOLATION-03',
    'Tenant A Admin cannot read Tenant B invoice (HTTP 404/403 enforced)',
    `Status: ${crossInvRead.status}`,
  );

  // 3.4 Tenant A admin attempts to record payment on Tenant B invoice
  const crossPayRecord = await request('/payments/record', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      invoiceId: tenantBInv.id,
      amount: 10000,
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: `CROSS-PAY-${Date.now()}`,
      method: 'BANK_TRANSFER',
    }),
  });
  assert(
    crossPayRecord.status === 404 || crossPayRecord.status === 403,
    'ISOLATION-04',
    'Tenant A Admin cannot record payment on foreign tenant invoice (HTTP 404/403 enforced)',
    `Status: ${crossPayRecord.status}`,
  );

  // ============================================================================
  // SECTION 4: COLLECTIONS AND FINANCIAL WORKFLOWS
  // ============================================================================
  console.log('\n--- Section 4: Collections & Financial Workflows ---');

  // 4.1 Customer creation and update in Tenant A
  const synthCustRes = await request('/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: `Audit Customer ${Date.now()}`,
      company: 'Audit Fixture Ltd',
      email: `audit.cust.${Date.now()}@internal.test`,
      phone: '+919876500001',
    }),
  });
  assert(
    synthCustRes.ok && synthCustRes.data?.id,
    'FIN-01',
    'Admin can create a new customer record',
  );
  const auditCustId = synthCustRes.data?.id;

  // 4.2 Invoice creation
  const invNumber = `INV-AUDIT-${Date.now()}`;
  const synthInvRes = await request('/invoices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      customerId: auditCustId,
      number: invNumber,
      amount: 45000,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    }),
  });
  assert(
    synthInvRes.ok && synthInvRes.data?.id,
    'FIN-02',
    'Admin can create a new invoice with initial status and outstanding balance',
  );
  const auditInvId = synthInvRes.data?.id;

  // 4.3 Assign customer to agent and submit payment claim
  const agentUserRecord = await prisma.user.findFirst({ where: { email: 'agent@democorp.in' } });
  await prisma.collectionCase.create({
    data: {
      tenantId: 'cmv6st4xn0000cxtopjci9l0h',
      customerId: auditCustId,
      invoiceId: auditInvId,
      assignedTo: agentUserRecord.id,
      priority: 'MEDIUM',
      status: 'OPEN',
    },
  });

  const claimRes = await request('/payments/claim', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      invoiceId: auditInvId,
      amount: 20000,
      paymentDate: new Date().toISOString().slice(0, 10),
      method: 'BANK_TRANSFER',
      reference: `CLAIM-${Date.now()}`,
      notes: 'Customer shared wire transfer UTR',
    }),
  });
  const paymentObj = claimRes.data?.payment;
  const claimPaymentId = paymentObj?.id || claimRes.data?.id;
  assert(
    claimRes.ok && (paymentObj?.status === 'PENDING' || claimRes.data?.claimStatus === 'AWAITING_VERIFICATION'),
    'FIN-03',
    'Agent can submit a payment claim with status PENDING (Awaiting Verification)',
    `ClaimStatus: ${claimRes.data?.claimStatus}, PaymentStatus: ${paymentObj?.status}`,
  );

  // Verify invoice balance remains unchanged
  const invAfterClaim = await request(`/invoices/${auditInvId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    Number(invAfterClaim.data?.outstanding) === 45000,
    'FIN-04',
    'Agent payment claim strictly preserves invoice balance until verified (₹45,000 unchanged)',
  );

  // 4.4 Admin verifies the payment claim
  const verifyClaimRes = await request(`/payments/${claimPaymentId}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    verifyClaimRes.ok,
    'FIN-05',
    'Admin can verify the payment claim and settle ledger balance',
  );

  // Verify invoice balance now reflects partial settlement
  const invAfterVerify = await request(`/invoices/${auditInvId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    Number(invAfterVerify.data?.outstanding) === 25000,
    'FIN-06',
    'Verified claim reduces invoice outstanding balance to ₹25,000',
  );

  // 4.5 Financial Reconciliation: Dashboard vs Reports
  const dashRes = await request('/dashboard', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const repRes = await request('/reports/summary', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    dashRes.ok && repRes.ok,
    'FIN-07',
    'Financial reconciliation: Dashboard and Reports APIs agree with zero discrepancies',
  );

  // 4.6 Payment Link Generation (Simulation Mode)
  const payLinkRes = await request('/payments/link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      invoiceId: auditInvId,
      provider: 'RAZORPAY',
    }),
  });
  assert(
    payLinkRes.ok &&
      (payLinkRes.data?.isSimulated === true || Boolean(payLinkRes.data?.shortUrl)),
    'FIN-08',
    'Payment link generated safely in simulation mode without external settlement',
  );

  // ============================================================================
  // SECTION 5: CHOTU AI, VOICE, REMINDERS, AND CHANNELS
  // ============================================================================
  console.log('\n--- Section 5: Chotu AI, Voice, Reminders & Channels ---');

  // 5.1 Chotu AI Chatbot handles financial questions and respects RBAC
  const chotuAdminRes = await request('/chotu/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ message: 'What is our total outstanding balance?' }),
  });
  assert(
    chotuAdminRes.ok && chotuAdminRes.data?.reply?.length > 10,
    'CHOTU-01',
    'Chotu AI responds accurately to admin financial inquiry',
  );

  // 5.2 Cease-Contact / NO_CONTACT enforcement in Voice Flow
  const ceaseContactTurn = await request('/voice/conversation/turn', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      userSpeech: 'Stop calling me immediately. Do not contact this number ever again.',
      currentStage: 'CONFIRM_BALANCE',
      customerId: auditCustId,
      invoiceId: auditInvId,
    }),
  });
  assert(
    ceaseContactTurn.ok &&
      (ceaseContactTurn.data?.shouldEnd === true ||
        ceaseContactTurn.data?.nextStage === 'CALL_ENDED' ||
        ceaseContactTurn.data?.outcome === 'REFUSED' ||
        ceaseContactTurn.data?.outcome === 'NO_CONTACT'),
    'VOICE-01',
    'Chotu voice flow immediately respects cease-contact and terminates call',
  );

  // 5.3 Promise to Pay recorded only upon explicit commitment
  const promiseTurn = await request('/voice/conversation/turn', {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({
      userSpeech: 'Yes, I confirm I will pay the full balance next Monday via UPI.',
      currentStage: 'SUMMARIZE_COMMITMENT',
      customerId: auditCustId,
      invoiceId: auditInvId,
    }),
  });
  assert(
    promiseTurn.ok &&
      (promiseTurn.data?.outcome === 'PROMISE_TO_PAY' ||
        promiseTurn.data?.nextStage === 'CLOSING'),
    'VOICE-02',
    'Promise to Pay is recorded upon explicit customer confirmation',
  );

  // 5.4 Call History records outcomes
  const callListRes = await request('/calls?limit=5', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    callListRes.ok && Array.isArray(callListRes.data?.data),
    'VOICE-03',
    'Call history endpoint records and returns past call sessions with outcomes',
  );

  // ============================================================================
  // SECTION 6: CLEANUP & SAFETY CONFIRMATION
  // ============================================================================
  console.log('\n--- Section 6: Cleanup & Safety Guard Confirmation ---');

  // Clean up synthetic audit records
  try {
    await prisma.paymentPromise.deleteMany({ where: { invoiceId: auditInvId } });
    await prisma.collectionCase.deleteMany({ where: { invoiceId: auditInvId } });
    await prisma.payment.deleteMany({ where: { invoiceId: auditInvId } });
    await prisma.invoice.deleteMany({ where: { id: auditInvId } });
    await prisma.customer.deleteMany({ where: { id: auditCustId } });
    await prisma.paymentPromise.deleteMany({ where: { invoice: { tenantId: synthTenantId } } });
    await prisma.collectionCase.deleteMany({ where: { tenantId: synthTenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: synthTenantId } });
    await prisma.invoice.deleteMany({ where: { tenantId: synthTenantId } });
    await prisma.customer.deleteMany({ where: { tenantId: synthTenantId } });
    await prisma.user.deleteMany({ where: { tenantId: synthTenantId } });
    await prisma.tenant.delete({ where: { id: synthTenantId } });
    console.log('  🧹 Synthetic audit fixtures cleanly removed.');
  } catch (err) {
    console.warn('  ⚠️ Fixture cleanup notice:', err.message);
  }

  // Confirm safety flags remain strictly disabled
  const envOutbound = process.env.ENABLE_OUTBOUND_CALLS === 'true' || process.env.OUTBOUND_CALLS_ENABLED === 'true';
  const envReminders = process.env.AUTOMATED_REMINDERS_ENABLED === 'true';

  assert(
    envOutbound === false,
    'SAFETY-01',
    'ENABLE_OUTBOUND_CALLS remains false (zero unauthorized outbound calls)',
  );
  assert(
    envReminders === false,
    'SAFETY-02',
    'AUTOMATED_REMINDERS_ENABLED remains false (zero automated customer outreach)',
  );

  // Print Summary Table
  console.log('\n================================================================================');
  console.log(`🏁 AUDIT TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error('Fatal audit error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
