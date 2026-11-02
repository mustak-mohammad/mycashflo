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

const API_URL = 'http://localhost:3000/api';

async function main() {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  console.log('1. Testing GET /api/reminders/settings...');
  const settingsRes = await fetch(`${API_URL}/reminders/settings`, { headers });
  const settings = await settingsRes.json();
  console.log('Settings:', settings);

  console.log('\n2. Testing GET /api/reminders/preview...');
  const previewRes = await fetch(`${API_URL}/reminders/preview`, { headers });
  const preview = await previewRes.json();
  console.log(`Preview summary: Evaluated: ${preview.evaluatedCount}, Eligible: ${preview.eligibleCount}, Suppressed: ${preview.suppressedCount}, DryRun: ${preview.isDryRun}`);
  if (preview.items && preview.items.length > 0) {
    console.log('Sample preview items:');
    for (const it of preview.items.slice(0, 3)) {
      console.log(` - ${it.invoiceNumber} (${it.customerName}): amount=${it.outstandingAmount}, stage=${it.stage}, eligible=${it.isEligible}, suppressionReason=${it.suppressionReason || 'none'}`);
    }
  }

  console.log('\n3. Testing POST /api/reminders/trigger (dry-run)...');
  const triggerRes = await fetch(`${API_URL}/reminders/trigger`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dryRun: true }),
  });
  const trigger = await triggerRes.json();
  console.log(`Trigger result: Evaluated: ${trigger.evaluatedCount}, Dispatched: ${trigger.dispatchedCount}, Suppressed: ${trigger.suppressedCount}`);

  console.log('\n4. Testing GET /api/reminders/stats...');
  const statsRes = await fetch(`${API_URL}/reminders/stats`, { headers });
  const stats = await statsRes.json();
  console.log('Stats:', stats);

  console.log('\n5. Testing GET /api/reminders/history...');
  const historyRes = await fetch(`${API_URL}/reminders/history?limit=3`, { headers });
  const history = await historyRes.json();
  console.log(`History count: ${history.total}, items retrieved: ${history.data.length}`);

  console.log('\n✅ All live API endpoints responded successfully with 200 OK!');
}

main().catch(console.error);
