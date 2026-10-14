/**
 * myCashflo — Development Seed Script
 * Run: npm run db:seed
 *
 * Creates:
 *  - 1 Tenant (Demo Corp)
 *  - 2 Users  (admin + agent)
 *  - 5 Customers
 *  - 8 Invoices (mix of statuses)
 *  - 2 Payments
 *  - 2 Collection Cases
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Seeding myCashflo database…');

  // ── Guard: skip if already seeded ─────────────────────────────────────────
  const existingTenant = await prisma.tenant.findFirst({ where: { slug: 'democorp' } });
  if (existingTenant) {
    console.log('ℹ️   Already seeded — skipping. Delete tenant "democorp" to re-seed.');
    return;
  }

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: { name: 'Demo Corp Pvt Ltd', slug: 'democorp' },
  });
  console.log(`✔  Tenant: ${tenant.name} (${tenant.id})`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const [adminHash, agentHash] = await Promise.all([
    bcrypt.hash('Admin@1234', 12),
    bcrypt.hash('Agent@1234', 12),
  ]);

  const [admin, agent] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@democorp.in',
        passwordHash: adminHash,
        name: 'Priya Sharma',
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    }),
    prisma.user.create({
      data: {
        email: 'agent@democorp.in',
        passwordHash: agentHash,
        name: 'Rahul Verma',
        role: 'AGENT',
        tenantId: tenant.id,
      },
    }),
  ]);
  console.log(`✔  Users: ${admin.email}, ${agent.email}`);

  // ── Customers ─────────────────────────────────────────────────────────────
  const [c1, c2, c3, c4, c5] = await Promise.all([
    prisma.customer.create({ data: { name: 'Raj Enterprises',   email: 'billing@rajent.in',          phone: '+91 98765 43210', company: 'Raj Enterprises',        outstandingBalance: 145000, tenantId: tenant.id } }),
    prisma.customer.create({ data: { name: 'Mehta Traders',     email: 'accounts@mehtatraders.com',  phone: '+91 87654 32109', company: 'Mehta Traders Ltd',       outstandingBalance: 89500,  tenantId: tenant.id } }),
    prisma.customer.create({ data: { name: 'Global Logistics',  email: 'finance@globallogistics.in', phone: '+91 76543 21098', company: 'Global Logistics',        outstandingBalance: 320000, tenantId: tenant.id } }),
    prisma.customer.create({ data: { name: 'Patel & Sons',      email: 'patel@patelsons.com',        phone: '+91 65432 10987', company: 'Patel and Sons',          outstandingBalance: 0,      tenantId: tenant.id } }),
    prisma.customer.create({ data: { name: 'Star Tech',         email: 'billing@startech.io',        phone: '+91 54321 09876', company: 'Star Tech Solutions',     outstandingBalance: 67200,  tenantId: tenant.id } }),
  ]);
  console.log(`✔  Customers: 5 created`);

  // ── Invoices ──────────────────────────────────────────────────────────────
  const d = (n: number) => new Date(Date.now() + n * 86_400_000);

  const [inv1, , , inv4, , inv6, inv7] = await Promise.all([
    prisma.invoice.create({ data: { number: 'INV-2024-001', customerId: c1.id, amount: 85000,  outstanding: 85000,  status: 'OVERDUE',        issueDate: d(-60), dueDate: d(-30), tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-002', customerId: c1.id, amount: 60000,  outstanding: 60000,  status: 'OPEN',           issueDate: d(-20), dueDate: d(10),  tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-003', customerId: c2.id, amount: 89500,  outstanding: 89500,  status: 'OVERDUE',        issueDate: d(-45), dueDate: d(-15), tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-004', customerId: c3.id, amount: 200000, outstanding: 100000, status: 'PARTIALLY_PAID', issueDate: d(-30), dueDate: d(-5),  tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-005', customerId: c3.id, amount: 120000, outstanding: 120000, status: 'OPEN',           issueDate: d(-10), dueDate: d(20),  tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-006', customerId: c4.id, amount: 50000,  outstanding: 0,      status: 'PAID',           issueDate: d(-40), dueDate: d(-10), tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-007', customerId: c5.id, amount: 42000,  outstanding: 42000,  status: 'OVERDUE',        issueDate: d(-50), dueDate: d(-20), tenantId: tenant.id } }),
    prisma.invoice.create({ data: { number: 'INV-2024-008', customerId: c5.id, amount: 25200,  outstanding: 25200,  status: 'OPEN',           issueDate: d(-5),  dueDate: d(25),  tenantId: tenant.id } }),
  ]);
  console.log(`✔  Invoices: 8 created`);

  // ── Payments ──────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.payment.create({ data: { ref: 'PAY-2024-001', customerId: c4.id, invoiceId: inv6.id, amount: 50000,  method: 'BANK_TRANSFER', status: 'COMPLETED', paidAt: d(-8), tenantId: tenant.id } }),
    prisma.payment.create({ data: { ref: 'PAY-2024-002', customerId: c3.id, invoiceId: inv4.id, amount: 100000, method: 'UPI',           status: 'COMPLETED', paidAt: d(-3), tenantId: tenant.id } }),
  ]);
  console.log(`✔  Payments: 2 created`);

  // ── Collection Cases ──────────────────────────────────────────────────────
  await Promise.all([
    prisma.collectionCase.create({ data: { customerId: c1.id, invoiceId: inv1.id, assignedTo: agent.id, priority: 'HIGH',   status: 'OPEN',        notes: 'Customer not responding to emails. Escalate to call.', tenantId: tenant.id } }),
    prisma.collectionCase.create({ data: { customerId: c3.id, invoiceId: inv4.id, assignedTo: agent.id, priority: 'URGENT', status: 'IN_PROGRESS', notes: 'Partial payment received. Following up on balance.',     tenantId: tenant.id } }),
    prisma.collectionCase.create({ data: { customerId: c5.id, invoiceId: inv7.id, assignedTo: agent.id, priority: 'MEDIUM', status: 'OPEN',        notes: 'First overdue notice sent.',                             tenantId: tenant.id } }),
  ]);
  console.log(`✔  Collection cases: 3 created`);

  console.log('\n✅  Seed complete!');
  console.log('   Admin: admin@democorp.in  /  Admin@1234');
  console.log('   Agent: agent@democorp.in  /  Agent@1234');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
