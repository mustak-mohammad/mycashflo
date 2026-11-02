import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const notifCount = await prisma.notification.count();
  const cfgCount = await prisma.integrationConfig.count();
  console.log('Notification count:', notifCount);
  console.log('IntegrationConfig count:', cfgCount);
  const configs = await prisma.integrationConfig.findMany();
  console.log('Providers in IntegrationConfig:', configs.map(c => ({ provider: c.provider, tenantId: c.tenantId, isActive: c.isActive })));
  const notifs = await prisma.notification.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log('Recent notifications:', notifs);
  await prisma.$disconnect();
}
main().catch(console.error);
