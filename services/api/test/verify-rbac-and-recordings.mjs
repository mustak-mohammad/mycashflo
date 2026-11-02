import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api';
const prisma = new PrismaClient();

async function runTests() {
  console.log('================================================================');
  console.log('  myCashflo — RBAC Permissions & Voice Recordings Verification');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200 && healthData.status === 'ok', 'API Server is healthy and running on port 3000');

  // 2. Authenticate Admin and Agent
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@democorp.in', password: 'Admin@1234' }),
  });
  const adminAuth = await adminLoginRes.json();
  const adminToken = adminAuth.tokens?.accessToken || adminAuth.accessToken;
  assert([200, 201].includes(adminLoginRes.status) && adminToken, 'Admin logged in successfully and received JWT');

  const agentLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agent@democorp.in', password: 'Agent@1234' }),
  });
  const agentAuth = await agentLoginRes.json();
  const agentToken = agentAuth.tokens?.accessToken || agentAuth.accessToken;
  assert([200, 201].includes(agentLoginRes.status) && agentToken, 'Agent logged in successfully and received JWT');

  // Verify roles in JWT profile
  const adminProfileRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const adminProfile = await adminProfileRes.json();
  assert(adminProfile.role === 'ADMIN', `Admin profile verified (role: ${adminProfile.role})`);

  const agentProfileRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  const agentProfile = await agentProfileRes.json();
  assert(agentProfile.role === 'AGENT', `Agent profile verified (role: ${agentProfile.role})`);

  console.log('\n--- Part A: RBAC Permissions Enforcement ---');

  // 3. User Management Endpoint: Admin ALLOWED, Agent FORBIDDEN (403)
  const adminUsersRes = await fetch(`${API_BASE}/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(adminUsersRes.status === 200, `Admin can access /api/users (HTTP ${adminUsersRes.status})`);

  const agentUsersRes = await fetch(`${API_BASE}/users`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(agentUsersRes.status === 403, `Agent is strictly rejected from /api/users with 403 Forbidden (HTTP ${agentUsersRes.status})`);

  // 4. Integrations & Settings: Admin ALLOWED, Agent FORBIDDEN (403)
  const adminIntegrationsRes = await fetch(`${API_BASE}/integrations`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(adminIntegrationsRes.status === 200, `Admin can access /api/integrations (HTTP ${adminIntegrationsRes.status})`);

  const agentIntegrationsRes = await fetch(`${API_BASE}/integrations`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(agentIntegrationsRes.status === 403, `Agent is strictly rejected from /api/integrations with 403 Forbidden (HTTP ${agentIntegrationsRes.status})`);

  // 5. Automated Reminders Management: Admin ALLOWED, Agent FORBIDDEN (403)
  const agentRemindersRes = await fetch(`${API_BASE}/reminders/preview`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(agentRemindersRes.status === 403, `Agent is rejected from /api/reminders/preview with 403 Forbidden (HTTP ${agentRemindersRes.status})`);

  // 6. Direct Payment Settlement: Admin ALLOWED, Agent FORBIDDEN (403)
  // Find an open invoice
  const openInvoicesRes = await fetch(`${API_BASE}/invoices?limit=5`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const invoicesList = await openInvoicesRes.json();
  const testInvoice = invoicesList.data.find((i) => i.outstanding > 0) || invoicesList.data[0];

  const agentRecordPayRes = await fetch(`${API_BASE}/payments/record`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      invoiceId: testInvoice.id,
      amount: 1000,
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: 'AGENT-ILLEGAL-ATTEMPT-01',
    }),
  });
  assert(agentRecordPayRes.status === 403, `Agent cannot directly record settlement payments (HTTP 403 Forbidden)`);

  // Ensure the agent has an assignment to this customer via CollectionCase
  let assignedCase = await prisma.collectionCase.findFirst({
    where: { tenantId: adminProfile.tenantId, customerId: testInvoice.customerId, assignedTo: agentProfile.id },
  });
  if (!assignedCase) {
    assignedCase = await prisma.collectionCase.create({
      data: {
        tenantId: adminProfile.tenantId,
        customerId: testInvoice.customerId,
        assignedTo: agentProfile.id,
        status: 'OPEN',
        priority: 'HIGH',
      },
    });
  }

  // 7. Payment Claims: Agent CAN submit payment claims awaiting verification for assigned customer
  const claimRef = `CLAIM-${Date.now()}`;
  const initialOutstanding = Number(testInvoice.outstanding);

  const agentClaimRes = await fetch(`${API_BASE}/payments/claim`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      invoiceId: testInvoice.id,
      amount: 500,
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: claimRef,
      method: 'BANK_TRANSFER',
      notes: 'Customer transferred via NEFT and shared transaction receipt',
      evidenceUrl: 'https://proofs.internal/neft-receipt.jpg',
    }),
  });
  const claimData = await agentClaimRes.json();
  assert(
    agentClaimRes.status === 201 && claimData.claimStatus === 'AWAITING_VERIFICATION',
    `Agent submitted payment claim with status AWAITING_VERIFICATION (success: ${claimData.success})`,
  );

  // Check invoice balance was NOT reduced
  const checkInvoiceRes = await fetch(`${API_BASE}/invoices/${testInvoice.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const checkedInvoice = await checkInvoiceRes.json();
  assert(
    Number(checkedInvoice.outstanding) === Number(initialOutstanding),
    `Payment claim did NOT reduce invoice outstanding balance (${checkedInvoice.outstanding} == ${initialOutstanding})`,
  );

  // 8. Financial Adjustment Workflow: Agent CANNOT verify claims, Admin CAN
  const claimPayment = await prisma.payment.findFirst({
    where: { ref: claimRef },
  });
  assert(Boolean(claimPayment), `Payment claim record found in database (ID: ${claimPayment?.id})`);

  if (claimPayment) {
    const agentVerifyRes = await fetch(`${API_BASE}/payments/${claimPayment.id}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentVerifyRes.status === 403, `Agent is forbidden from approving/verifying payment claims (HTTP 403)`);

    const adminVerifyRes = await fetch(`${API_BASE}/payments/${claimPayment.id}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const verifyData = await adminVerifyRes.json();
    assert(
      adminVerifyRes.status === 201 && verifyData.success === true,
      `Admin successfully verified payment claim (reconciled remaining outstanding: ${verifyData.remainingOutstanding})`,
    );

    // Clean up test claim payment and restore invoice
    await prisma.payment.delete({ where: { id: claimPayment.id } }).catch(() => {});
    await prisma.invoice.update({
      where: { id: testInvoice.id },
      data: { outstanding: initialOutstanding, status: testInvoice.status },
    }).catch(() => {});
    await prisma.customer.update({
      where: { id: testInvoice.customerId },
      data: { outstandingBalance: { increment: 500 } },
    }).catch(() => {});
  }

  console.log('\n--- Part B: Voice Recordings & Download Option ---');

  // 9. Pick or create a test call session for recording download
  let targetCall = await prisma.callSession.findFirst({
    where: { tenantId: adminProfile.tenantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!targetCall) {
    targetCall = await prisma.callSession.create({
      data: {
        tenantId: adminProfile.tenantId,
        outcome: 'PROMISE_TO_PAY',
        duration: 95,
        summary: 'Customer agreed to remit outstanding amount by end of week.',
        transcript: 'Agent: Good afternoon. Customer: I will pay the bill on Friday.',
      },
    });
  }
  assert(Boolean(targetCall), `Call session identified for recording verification (ID: ${targetCall.id})`);

  // 10. Generate dummy valid audio buffer (WebM audio container simulation)
  const dummyAudio = Buffer.from(
    '1a45dfa39f4286810142f7810142f28104428581084282847765626d4287810242858102',
    'hex',
  );
  const audioBase64 = dummyAudio.toString('base64');

  // Upload recording via POST /api/calls/:id/recording/upload
  const uploadRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioBase64,
      mimeType: 'audio/webm',
    }),
  });
  const uploadData = await uploadRes.json();
  assert(
    uploadRes.status === 201 && uploadData.status === 'AVAILABLE',
    `Audio recording uploaded and status set to AVAILABLE (file size: ${uploadData.fileSize} bytes)`,
  );

  // 11. Check Recording Status Resolution Endpoint
  const getRecRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const recData = await getRecRes.json();
  assert(
    getRecRes.status === 200 && recData.status === 'AVAILABLE',
    `GET /api/calls/:id/recording returned AVAILABLE status with downloadUrl: ${recData.downloadUrl}`,
  );

  // 12. Check Voice Recording Audio Stream Endpoint
  const streamRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/stream`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    streamRes.status === 200 && streamRes.headers.get('content-type')?.includes('audio/webm'),
    `GET /api/calls/:id/recording/stream returned HTTP 200 with Content-Type: audio/webm`,
  );

  // 13. Check Voice Recording Download Endpoint with Bearer Token
  const downloadRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/download`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const disposition = downloadRes.headers.get('content-disposition');
  assert(
    downloadRes.status === 200 && disposition?.includes('attachment') && disposition?.includes('filename='),
    `GET /api/calls/:id/recording/download returned HTTP 200 with attachment header: ${disposition}`,
  );

  // 14. Check Voice Recording Download with Query Token (Direct browser download link)
  const queryDownloadRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/download?token=${encodeURIComponent(adminToken)}`);
  const queryDisposition = queryDownloadRes.headers.get('content-disposition');
  assert(
    queryDownloadRes.status === 200 && queryDisposition?.includes('attachment'),
    `Download via ?token= query parameter succeeded (for direct browser <a> links): ${queryDisposition}`,
  );

  // 15. Check Call PDF Report Download Endpoint
  const reportRes = await fetch(`${API_BASE}/calls/${targetCall.id}/report?token=${encodeURIComponent(adminToken)}`);
  assert(
    reportRes.status === 200 && reportRes.headers.get('content-type')?.includes('application/pdf'),
    `GET /api/calls/:id/report returned HTTP 200 with application/pdf`,
  );

  // 16. Verify Agent Access to Recording on Assigned Call
  const originalUserId = targetCall.userId;
  // When an agent is assigned to the call, they can download the recording
  await prisma.callSession.update({
    where: { id: targetCall.id },
    data: { agent: { connect: { id: agentProfile.id } } },
  });
  const agentDownloadRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/download`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(
    agentDownloadRes.status === 200,
    `Agent can download voice recording for their assigned call session (HTTP ${agentDownloadRes.status})`,
  );

  // When call belongs to another user (admin), agent is blocked with 403 Forbidden
  await prisma.callSession.update({
    where: { id: targetCall.id },
    data: { agent: { connect: { id: adminProfile.id } } },
  });
  const agentForbiddenRes = await fetch(`${API_BASE}/calls/${targetCall.id}/recording/download`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  assert(
    agentForbiddenRes.status === 403,
    `Agent cannot download recording for another user's call session (HTTP 403 Forbidden)`,
  );

  // Restore call session
  await prisma.callSession.update({
    where: { id: targetCall.id },
    data: { agent: { connect: { id: originalUserId || adminProfile.id } } },
  });

  console.log('\n================================================================');
  console.log(`  VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  prisma.$disconnect();
  process.exit(1);
});
