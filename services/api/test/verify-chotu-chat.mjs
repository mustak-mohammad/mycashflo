import { PrismaClient } from '@prisma/client';

const API_BASE = 'http://localhost:3000/api';
const prisma = new PrismaClient();

async function runTests() {
  console.log('========================================================================');
  console.log('🤖 myCashFlo — Chotu AI Chatbot Live Integration & Security Verification');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200 && healthData.status === 'ok', 'API Server is healthy and running on port 3000');

  // 2. Unauthenticated request to /api/chotu/chat is rejected with 401
  const unauthRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello Chotu' }),
  });
  assert(unauthRes.status === 401, `Unauthenticated chat request rejected with 401 Unauthorized (HTTP ${unauthRes.status})`);

  // 3. Authenticate Admin and Agent
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

  console.log('\n--- Part A: Validation & Safety Enforcement ---');

  // 4. Oversized message (>1000 characters) rejected with 400 Bad Request
  const oversizedMsg = 'A'.repeat(1005);
  const oversizedRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: oversizedMsg }),
  });
  assert(oversizedRes.status === 400, `Oversized message (>1000 chars) rejected with 400 Bad Request (HTTP ${oversizedRes.status})`);

  // 5. Empty message rejected with 400 Bad Request
  const emptyRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: '   ' }),
  });
  assert(emptyRes.status === 400, `Empty message rejected with 400 Bad Request (HTTP ${emptyRes.status})`);

  // 6. Financial mutation refusal: user asks to settle invoice or mark as paid
  const mutationRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Please mark invoice INV-1001 as paid and change balance to zero' }),
  });
  const mutationData = await mutationRes.json();
  assert(
    mutationRes.status === 200 &&
      mutationData.reply.includes('Read-Only Assistance Mode') &&
      mutationData.suggestedRoute === '/payments',
    'Financial mutation attempt intercepted and refused with read-only explanation',
  );

  // 7. Outreach safety guard: user asks to send WhatsApp reminder
  const outreachRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Send WhatsApp payment reminder to customer immediately' }),
  });
  const outreachData = await outreachRes.json();
  assert(
    outreachRes.status === 200 && outreachData.reply.includes('Outreach Safety Guard'),
    'Live customer outreach attempt intercepted and refused with safety explanation',
  );

  console.log('\n--- Part B: Domain-Aware Financial Answers & Guidance ---');

  // 8. Receivables overview query for Admin
  const overviewRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Give me an overview of outstanding invoices.' }),
  });
  const overviewData = await overviewRes.json();
  assert(
    overviewRes.status === 200 &&
      overviewData.reply.includes('Receivables Overview') &&
      overviewData.reply.includes('₹') &&
      overviewData.suggestedQuestions.length > 0,
    `Admin receivables overview returned verified totals and follow-up chips (Length: ${overviewData.reply.length} chars)`,
  );

  // 9. Overdue invoices list query
  const overdueRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Which invoices are overdue?' }),
  });
  const overdueData = await overdueRes.json();
  assert(
    overdueRes.status === 200 &&
      (overdueData.reply.includes('Overdue Invoices') || overdueData.reply.includes('No Overdue Invoices')),
    'Overdue invoices inquiry returned verified invoice records',
  );

  // 10. Navigation guidance for reports
  const navReportRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'How do I generate an ageing report?' }),
  });
  const navReportData = await navReportRes.json();
  assert(
    navReportRes.status === 200 &&
      navReportData.reply.includes('How to Access Reports') &&
      navReportData.suggestedRoute === '/reports',
    'Report navigation inquiry returned step-by-step guidance and route hint',
  );

  console.log('\n--- Part C: RBAC Enforcement & Tenant Isolation ---');

  // 11. Admin settings guidance
  const adminSettingsRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'How do I manage settings and integrations?' }),
  });
  const adminSettingsData = await adminSettingsRes.json();
  assert(
    adminSettingsRes.status === 200 &&
      adminSettingsData.reply.includes('Managing Settings & Integrations') &&
      adminSettingsData.suggestedRoute === '/settings',
    'Admin user receives comprehensive settings and gateway integration guidance',
  );

  // 12. Agent restricted from settings
  const agentSettingsRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'How do I manage settings and add users?' }),
  });
  const agentSettingsData = await agentSettingsRes.json();
  assert(
    agentSettingsRes.status === 200 &&
      agentSettingsData.reply.includes('restricted to **Tenant Administrators**') &&
      !agentSettingsData.suggestedRoute,
    'Collection Agent is informed of role restrictions when inquiring about settings',
  );

  // 13. Agent asking for collections & follow-ups
  const agentFollowUpRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Which assigned customers need follow-up?' }),
  });
  const agentFollowUpData = await agentFollowUpRes.json();
  assert(
    agentFollowUpRes.status === 200 && agentFollowUpData.reply.includes('Your Assignments'),
    'Collection Agent inquiry is strictly scoped to assigned collection accounts and cases',
  );

  // 14. Cross-tenant isolation with selectedRecordId
  // Invoice from ABC tenant: cmvi1tof10009cxfowtuy5ptk
  const crossTenantRes = await fetch(`${API_BASE}/chotu/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'What is the balance of this selected invoice?',
      selectedRecordId: 'cmvi1tof10009cxfowtuy5ptk',
    }),
  });
  const crossTenantData = await crossTenantRes.json();
  assert(
    crossTenantRes.status === 200 && !crossTenantData.reply.includes('Sunrise Technologies'),
    'Cross-tenant record query via selectedRecordId does not leak foreign tenant data (Zero Leakage)',
  );

  console.log('\n========================================================================');
  console.log(`🏁 Chotu AI Chatbot Verification Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

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
