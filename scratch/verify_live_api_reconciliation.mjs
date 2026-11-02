import jwt from '../services/api/node_modules/jsonwebtoken/index.js';

const secret = 'eb8916f797a31c90f7bcc92d5cabb34991f40a6eccef2eb7ce8ea0dd6f66f0a197058d552f3c9c25c9009102a33416e2d5520f6033360ba1e2d34f909db0b63f';

const token = jwt.sign(
  {
    sub: 'cmv6st53l0002cxtos35mcf1o',
    email: 'admin@democorp.in',
    tenantId: 'cmv6st4xn0000cxtopjci9l0h',
    role: 'ADMIN',
  },
  secret,
  { expiresIn: '1h' }
);

async function check() {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const [dashRes, repRes, colRes] = await Promise.all([
    fetch('http://localhost:3000/api/dashboard', { headers }).then(r => r.json()),
    fetch('http://localhost:3000/api/reports/summary', { headers }).then(r => r.json()),
    fetch('http://localhost:3000/api/collections', { headers }).then(r => r.json()),
  ]);

  console.log('=== LIVE API DASHBOARD RESPONSE ===');
  console.log(JSON.stringify({
    totalReceivables: dashRes.totalReceivables,
    totalBilled: dashRes.totalBilled,
    totalCollected: dashRes.totalCollected,
    overdueAmount: dashRes.overdueAmount,
    collectionRate: dashRes.collectionRate,
    openInvoiceCount: dashRes.openInvoiceCount,
    overdueCustomerCount: dashRes.overdueCustomerCount,
    openCaseCount: dashRes.openCaseCount,
    collectedThisMonth: dashRes.collectedThisMonth,
  }, null, 2));

  console.log('\n=== LIVE API REPORTS SUMMARY RESPONSE ===');
  console.log(JSON.stringify({
    totalReceivables: repRes.totalReceivables,
    totalBilled: repRes.totalBilled,
    totalCollected: repRes.totalCollected,
    totalOverdue: repRes.totalOverdue,
    collectionRate: repRes.collectionRate,
    openInvoices: repRes.openInvoices,
    overdueCustomers: repRes.overdueCustomers,
    collectedThisMonth: repRes.collectedThisMonth,
  }, null, 2));

  console.log('\n=== RECONCILIATION VERIFICATION ===');
  console.log('Total Receivables Match:', dashRes.totalReceivables === repRes.totalReceivables, `(${dashRes.totalReceivables} vs ${repRes.totalReceivables})`);
  console.log('Total Billed Match:', dashRes.totalBilled === repRes.totalBilled, `(${dashRes.totalBilled} vs ${repRes.totalBilled})`);
  console.log('Total Collected Match:', dashRes.totalCollected === repRes.totalCollected, `(${dashRes.totalCollected} vs ${repRes.totalCollected})`);
  console.log('Overdue Amount Match:', dashRes.overdueAmount === repRes.totalOverdue, `(${dashRes.overdueAmount} vs ${repRes.totalOverdue})`);
  console.log('Collection Rate Match:', dashRes.collectionRate === repRes.collectionRate, `(${dashRes.collectionRate}% vs ${repRes.collectionRate}%)`);
  console.log('Open Invoices Match:', dashRes.openInvoiceCount === repRes.openInvoices, `(${dashRes.openInvoiceCount} vs ${repRes.openInvoices})`);
  console.log('Overdue Customers Match:', dashRes.overdueCustomerCount === repRes.overdueCustomers, `(${dashRes.overdueCustomerCount} vs ${repRes.overdueCustomers})`);
  console.log('Active Collection Cases Reconciled to 0:', dashRes.openCaseCount === 0, `(${dashRes.openCaseCount})`);
  console.log('\n=== LIVE COLLECTIONS PAGE API RESPONSE ===');
  console.log('Active Cases Count (openCount):', colRes.summary?.openCount);
  console.log('High Priority Cases Count (highCount):', colRes.summary?.highCount);
  console.log('Total Cases in DB:', colRes.total);
  console.log('Cases in response:', colRes.data?.map(c => ({ id: c.id, status: c.status, invoice: c.invoice?.number })));
}

check().catch(console.error);
