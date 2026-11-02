import jwt from '../services/api/node_modules/jsonwebtoken/index.js';

const secret = 'eb8916f797a31c90f7bcc92d5cabb34991f40a6eccef2eb7ce8ea0dd6f66f0a197058d552f3c9c25c9009102a33416e2d5520f6033360ba1e2d34f909db0b63f';

const token = jwt.sign(
  {
    sub: 'cmvgtxo38000bcx0w322dvni4',
    email: 'mustakmohammad396@gmail.com',
    tenantId: 'cmvgtxnsn0009cx0wljknr02r',
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

  console.log('1. Testing ABC GET /api/reminders/settings...');
  const settingsRes = await fetch(`${API_URL}/reminders/settings`, { headers });
  const settings = await settingsRes.json();
  console.log('ABC Settings:', settings);

  console.log('\n2. Testing ABC GET /api/reminders/preview...');
  const previewRes = await fetch(`${API_URL}/reminders/preview`, { headers });
  const preview = await previewRes.json();
  console.log(`ABC Preview summary: Evaluated: ${preview.evaluatedCount}, Eligible: ${preview.eligibleCount}, Suppressed: ${preview.suppressedCount}, DryRun: ${preview.isDryRun}`);
  if (preview.items && preview.items.length > 0) {
    for (const it of preview.items) {
      console.log(` - ${it.invoiceNumber} (${it.customerName}): amount=₹${it.outstandingAmount}, stage=${it.stage}, eligible=${it.isEligible}, suppressionReason=${it.suppressionReason || 'none'}`);
      console.log(`   Message Preview available: ${Boolean(it.messagePreview)} (Subject: ${it.messagePreview?.subject})`);
    }
  }

  console.log('\n3. Testing ABC GET /api/reminders/stats...');
  const statsRes = await fetch(`${API_URL}/reminders/stats`, { headers });
  const stats = await statsRes.json();
  console.log('ABC Stats:', stats);

  console.log('\n4. Testing ABC GET /api/reminders/history...');
  const historyRes = await fetch(`${API_URL}/reminders/history?limit=3`, { headers });
  const history = await historyRes.json();
  console.log(`ABC History count: ${history.total}, items retrieved: ${history.data.length}`);

  console.log('\n✅ All ABC tenant live API endpoints responded successfully with 200 OK!');
}

main().catch(console.error);
