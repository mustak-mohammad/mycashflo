// Live Phase 6 End-to-End Runtime Verification Script
const BASE_URL = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
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

async function run() {
  console.log('====================================================');
  console.log('🚀 myCashflo — Phase 6 Live End-to-End Verification');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

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
    'Auth login returns signed JWT',
  );
  const token = loginRes.data.tokens?.accessToken;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. Fetch Customer & Invoice for test
  const custRes = await request('/customers?limit=1', { headers: authHeaders });
  assert(custRes.status === 200 && custRes.data.data.length > 0, 'Fetch customers succeeded');
  const customer = custRes.data.data[0];

  const invRes = await request('/invoices?status=OVERDUE&limit=1', { headers: authHeaders });
  assert(invRes.status === 200 && invRes.data.data.length > 0, 'Fetch overdue invoices succeeded');
  const invoice = invRes.data.data[0];

  // 4. AI Tools Catalog
  const toolsRes = await request('/intelligence/tools', { headers: authHeaders });
  assert(
    toolsRes.status === 200 && Array.isArray(toolsRes.data) && toolsRes.data.length >= 6,
    `AI Tools catalog exposes ${toolsRes.data?.length} tools`,
  );
  const consequentialTool = toolsRes.data.find((t) => t.isConsequential);
  assert(consequentialTool !== undefined, 'Tools catalog distinguishes consequential actions');

  // 5. Read-Only AI Tool: get_customer_balance
  const balToolRes = await request('/intelligence/tools/execute', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      toolName: 'get_customer_balance',
      parameters: { customerId: customer.id },
    }),
  });
  assert(
    [200, 201].includes(balToolRes.status) &&
      balToolRes.data.status === 'SUCCESS' &&
      balToolRes.data.result?.customerName === customer.name,
    `Executed 'get_customer_balance' for ${customer.name} (Balance: ₹${balToolRes.data.result?.outstandingBalance})`,
  );

  // 6. Read-Only AI Tool: get_overdue_invoices
  const overdueToolRes = await request('/intelligence/tools/execute', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      toolName: 'get_overdue_invoices',
      parameters: { customerId: customer.id },
    }),
  });
  assert(
    [200, 201].includes(overdueToolRes.status) && overdueToolRes.data.status === 'SUCCESS',
    `Executed 'get_overdue_invoices' (Overdue count: ${overdueToolRes.data.result?.overdueCount})`,
  );

  // 7. Consequential Action Confirmation Guard: record_payment_promise without confirmation
  const ptpUnconfirmed = await request('/intelligence/tools/execute', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      toolName: 'record_payment_promise',
      parameters: {
        customerId: customer.id,
        invoiceId: invoice.id,
        promisedAmount: 25000,
        promisedDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      confirmed: false,
    }),
  });
  assert(
    [200, 201].includes(ptpUnconfirmed.status) &&
      ptpUnconfirmed.data.status === 'REQUIRES_CONFIRMATION' &&
      ptpUnconfirmed.data.proposal?.id,
    `Confirmation Guard: Consequential action blocked, ActionProposal #${ptpUnconfirmed.data.proposal?.id} created`,
  );
  const proposalId = ptpUnconfirmed.data.proposal?.id;

  // 8. Pending Action Proposals
  const pendingRes = await request('/intelligence/actions/pending', { headers: authHeaders });
  assert(
    pendingRes.status === 200 && pendingRes.data.some((p) => p.id === proposalId),
    'Pending action proposal listed in human-in-the-loop queue',
  );

  // 9. Approve & Execute Consequential Action
  const approveRes = await request(`/intelligence/actions/${proposalId}/approve`, {
    method: 'POST',
    headers: authHeaders,
  });
  assert(
    [200, 201].includes(approveRes.status) && approveRes.data.proposal?.status === 'EXECUTED',
    'Action proposal approved and executed',
  );

  // 10. Collections Intelligence Assistant Chat
  const chatRes = await request('/intelligence/chat', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: `What is the balance for ${customer.name}?` }),
  });
  assert(
    [200, 201].includes(chatRes.status) &&
      chatRes.data.reply &&
      chatRes.data.toolCalled === 'get_customer_balance',
    `Chat assistant routed to tool: '${chatRes.data.toolCalled}' with response: "${chatRes.data.reply.slice(0, 60)}..."`,
  );

  // 11. Multi-Channel Notification Templates
  const templatesRes = await request('/notifications/templates', { headers: authHeaders });
  assert(
    templatesRes.status === 200 && templatesRes.data.length >= 4,
    `Notification templates catalog loaded (${templatesRes.data.length} templates)`,
  );

  // 12. Multi-Channel Notification Dispatch (WhatsApp)
  const dispatchRes = await request('/notifications/dispatch', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      customerId: customer.id,
      channel: 'WHATSAPP',
      template: 'PAYMENT_REMINDER_OVERDUE',
      payload: {
        invoiceNumber: invoice.number,
        amount: invoice.amount,
        dueDate: invoice.dueDate,
      },
    }),
  });
  assert(
    [200, 201].includes(dispatchRes.status) && dispatchRes.data.status === 'DELIVERED',
    `Dispatched WhatsApp reminder to ${customer.name} (Status: ${dispatchRes.data.status})`,
  );

  // 13. Automated Overdue Escalation Engine
  const autoRemindersRes = await request('/notifications/trigger-reminders', {
    method: 'POST',
    headers: authHeaders,
  });
  assert(
    [200, 201].includes(autoRemindersRes.status) && autoRemindersRes.data.evaluatedInvoices >= 0,
    `Automated Reminders Engine evaluated ${autoRemindersRes.data.evaluatedInvoices} invoices, sent ${autoRemindersRes.data.dispatchedCount} reminders`,
  );

  // 14. Notifications List
  const notifsListRes = await request('/notifications?limit=10', { headers: authHeaders });
  assert(
    notifsListRes.status === 200 && notifsListRes.data.total > 0,
    `Notifications list retrieved (${notifsListRes.data.total} total recorded in DB)`,
  );

  // 15. Tenant-Scoped Audit Log
  const auditRes = await request('/audit-logs?limit=20', { headers: authHeaders });
  assert(
    auditRes.status === 200 && auditRes.data.total > 0,
    `Tenant audit logs retrieved (${auditRes.data.total} recorded events)`,
  );
  const actionsLogged = auditRes.data.data.map((l) => l.action);
  assert(
    actionsLogged.includes('ai.action_proposed') &&
      actionsLogged.includes('ai.action_approved_and_executed') &&
      actionsLogged.includes('notification.dispatched'),
    `Audit logs contain required action trail: [${actionsLogged.slice(0, 4).join(', ')}]`,
  );

  // 16. Existing Phase 0-5 Endpoints Integrity Check
  const dashboardRes = await request('/dashboard', { headers: authHeaders });
  assert(
    dashboardRes.status === 200 && dashboardRes.data.totalReceivables !== undefined,
    'Phase 2/3 Dashboard KPI aggregations remain 100% operational',
  );

  const reportsRes = await request('/reports/ageing', { headers: authHeaders });
  assert(
    reportsRes.status === 200 && reportsRes.data && reportsRes.data.total !== undefined,
    `Phase 2/3 Reports & Ageing analysis remain 100% operational (Total overdue: ₹${reportsRes.data.total})`,
  );

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Fatal error during verification:', e);
  process.exit(1);
});
