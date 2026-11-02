import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  const notifs = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
    },
  });

  console.log('Total notifications retrieved:', notifs.length);
  for (const n of notifs) {
    const payload = n.payload || {};
    console.log('----------------------------------------------------');
    console.log(`ID: ${n.id}`);
    console.log(`Tenant: ${n.tenantId}`);
    console.log(`Status in DB: ${n.status}`);
    console.log(`Channel: ${n.channel} | Template: ${n.template}`);
    console.log(`Customer: ${n.customer?.name} (Actual Email: ${n.customer?.email})`);
    console.log(`Recipient Dispatched: ${payload.recipient || 'N/A'}`);
    console.log(`Test Recipient: ${payload.testRecipient || 'N/A'}`);
    console.log(`isTest: ${payload.isTest ?? false}`);
    console.log(`isSimulated: ${payload.isSimulated ?? false}`);
    console.log(`Provider: ${payload.provider || 'N/A'}`);
    console.log(`Provider Message ID: ${payload.providerMessageId || 'N/A'}`);
    console.log(`Created At: ${n.createdAt.toISOString()}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
