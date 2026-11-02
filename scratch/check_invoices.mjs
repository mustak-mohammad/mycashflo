import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  const invs = await prisma.invoice.findMany({
    select: { id: true, number: true, status: true, amount: true, outstanding: true, tenantId: true },
  });
  console.log('Total Invoices:', invs.length);
  for (const i of invs) {
    console.log(`- ${i.number} | status: ${i.status} | amt: ${i.amount} | outstanding: ${i.outstanding} | tenant: ${i.tenantId}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
