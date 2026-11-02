import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  const tenants = await prisma.tenant.findMany();
  console.log('Tenants:', tenants.map(t => ({ id: t.id, name: t.name })));

  for (const t of tenants) {
    console.log(`\n=== Tenant: ${t.name} (${t.id}) ===`);
    const invoices = await prisma.invoice.findMany({ where: { tenantId: t.id } });
    console.log(`Invoices count: ${invoices.length}`);
    for (const inv of invoices) {
      console.log(` - ${inv.number}: status=${inv.status}, amount=${inv.amount}, outstanding=${inv.outstanding}, dueDate=${inv.dueDate}, customerId=${inv.customerId}`);
    }

    const payments = await prisma.payment.findMany({ where: { tenantId: t.id } });
    console.log(`Payments count: ${payments.length}`);
    for (const pay of payments) {
      console.log(` - ${pay.ref}: status=${pay.status}, amount=${pay.amount}, invoiceId=${pay.invoiceId}`);
    }

    const cases = await prisma.collectionCase.findMany({
      where: { tenantId: t.id },
      include: { invoice: true, customer: true }
    });
    console.log(`CollectionCases count: ${cases.length}`);
    for (const c of cases) {
      console.log(` - Case ${c.id}: status=${c.status}, priority=${c.priority}, customer=${c.customer?.name}, invoiceNumber=${c.invoice?.number}, invoiceStatus=${c.invoice?.status}, invoiceOutstanding=${c.invoice?.outstanding}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
