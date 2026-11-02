import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  const tenantId = 'cmv6st4xn0000cxtopjci9l0h'; // Demo Corp

  const staleCases = await prisma.collectionCase.findMany({
    where: {
      tenantId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      OR: [
        { invoice: { status: 'PAID' } },
        { invoice: { outstanding: { lte: 0 } } },
      ],
    },
    include: { invoice: true, customer: true }
  });

  console.log(`Found ${staleCases.length} stale cases linked to PAID invoices:`);
  for (const c of staleCases) {
    console.log(`- Case ${c.id}: ${c.customer?.name}, invoice=${c.invoice?.number}, status=${c.status}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
