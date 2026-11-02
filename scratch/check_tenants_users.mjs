import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, tenantId: true, role: true },
  });
  console.log('Users:');
  for (const u of users) {
    console.log(`- ${u.id}: ${u.email} (${u.role}) tenant=${u.tenantId}`);
  }

  const customers = await prisma.customer.findMany();
  console.log('\nCustomers:');
  for (const c of customers) {
    console.log(`- ${c.name} (${c.email}, ${c.phone}): status=${c.status}, notes=${c.notes}, tenant=${c.tenantId}`);
  }

  const configs = await prisma.integrationConfig.findMany();
  console.log('\nIntegrationConfigs:');
  for (const cfg of configs) {
    console.log(`- provider=${cfg.provider}, tenant=${cfg.tenantId}, active=${cfg.isActive}, config=${JSON.stringify(cfg.config)}`);
  }

  const notifs = await prisma.notification.findMany({
    where: { tenantId: 'cmvgtxnsn0009cx0wljknr02r' },
  });
  console.log('\nABC Notifications:');
  for (const n of notifs) {
    console.log(`- Notif ${n.id}: status=${n.status}, createdAt=${n.createdAt}, payload=${JSON.stringify(n.payload)}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
