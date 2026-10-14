import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const t = await p.tenant.findFirst({ where: { slug: 'democorp' } });
if (t) {
  await p.collectionCase.deleteMany({ where: { tenantId: t.id } });
  await p.payment.deleteMany({ where: { tenantId: t.id } });
  await p.invoice.deleteMany({ where: { tenantId: t.id } });
  await p.customer.deleteMany({ where: { tenantId: t.id } });
  await p.refreshToken.deleteMany({});
  await p.user.deleteMany({ where: { tenantId: t.id } });
  await p.tenant.delete({ where: { id: t.id } });
  console.log('Cleared demo tenant & all its data.');
} else {
  console.log('No demo tenant found — nothing to clear.');
}
await p.$disconnect();
