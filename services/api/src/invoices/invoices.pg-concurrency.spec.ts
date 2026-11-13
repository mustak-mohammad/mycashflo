import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import {
  PrismaClient,
  InvoiceStatus,
  PaymentStatus,
  OrderIntentStatus,
  UserRole,
  PaymentMethod,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { RazorpayAdapter } from '../integrations/adapters/razorpay.adapter.js';
import { StripeAdapter } from '../integrations/adapters/stripe.adapter.js';

const testDbUrl = process.env.TEST_DATABASE_URL || '';

function assertSafeTestDatabaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const dbName = parsed.pathname.replace(/^\//, '').split('/')[0];
  if (!dbName || dbName === 'mycashflo' || dbName === 'postgres' || !dbName.toLowerCase().includes('test')) {
    throw new Error(
      `SAFETY ABORT: Refusing to execute PostgreSQL concurrency tests on database "${dbName}". Must target a dedicated *_test database.`,
    );
  }
  return dbName;
}

describe.runIf(Boolean(testDbUrl))(
  'InvoicesService - Real PostgreSQL READ COMMITTED Concurrency & Safeguards',
  () => {
    const TENANT_KEY_ID = 'rzp_test_inv_pub_123';
    const TENANT_KEY_SECRET = 'rzp_test_inv_priv_secret_123';
    const TENANT_WEBHOOK_SECRET = 'rzp_whsec_inv_test_secret_123';

    const originalNodeEnv = process.env.NODE_ENV;
    const originalRzpKeyId = process.env.RAZORPAY_KEY_ID;
    const originalRzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const originalRzpWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const originalPaymentSim = process.env.PAYMENT_SIMULATION_MODE;

    let prisma: PrismaClient;
    let invoicesService: InvoicesService;
    let paymentsService: PaymentsService;
    let auditLogsService: AuditLogsService;
    let runPrefix: string;
    let tenantId: string;
    let adminUserId: string;

    function signCheckout(orderId: string, paymentId: string, secret = TENANT_KEY_SECRET) {
      return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    }

    async function seedScenario(opts: {
      invoices: Array<{ number: string; amount: number; status?: InvoiceStatus }>;
    }) {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const total = opts.invoices.reduce((sum, inv) => sum + inv.amount, 0);
      const customer = await prisma.customer.create({
        data: {
          tenantId,
          name: `PG Inv Cust ${suffix}`,
          email: `pg-inv-${suffix}@example.test`,
          phone: '+919876543210',
          outstandingBalance: total,
          currency: 'INR',
        },
      });

      const createdInvoices = [];
      for (const item of opts.invoices) {
        const inv = await prisma.invoice.create({
          data: {
            tenantId,
            customerId: customer.id,
            number: `${item.number}-${suffix}`,
            amount: item.amount,
            outstanding: item.amount,
            currency: 'INR',
            status: item.status || InvoiceStatus.OPEN,
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 86400 * 1000),
          },
        });
        createdInvoices.push(inv);
      }

      return { customer, invoices: createdInvoices };
    }

    beforeAll(async () => {
      const expectedDbName = assertSafeTestDatabaseUrl(testDbUrl);
      prisma = new PrismaClient({
        datasources: { db: { url: testDbUrl } },
      });
      await prisma.$connect();

      const info = await prisma.$queryRawUnsafe<Array<{ db: string; iso: string }>>(
        `SELECT current_database() AS db, current_setting('transaction_isolation') AS iso`,
      );
      if (info[0]?.db !== expectedDbName || info[0]?.db === 'mycashflo') {
        throw new Error(`SAFETY ABORT: Connected DB "${info[0]?.db}" does not match "${expectedDbName}".`);
      }

      runPrefix = `pginv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tenant = await prisma.tenant.create({
        data: {
          name: `PG Inv Concurrency Tenant ${runPrefix}`,
          slug: `pg-inv-${runPrefix}`,
        },
      });
      tenantId = tenant.id;

      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `admin-${runPrefix}@example.test`,
          passwordHash: 'not_used_in_service_test',
          name: 'PG Admin',
          role: UserRole.ADMIN,
        },
      });
      adminUserId = user.id;

      const razorpay = new RazorpayAdapter();
      const stripe = new StripeAdapter();
      const integrationsMock: any = {
        razorpay,
        stripe,
        getRawConfig: vi.fn().mockImplementation(async (reqTenantId: string, provider: string) => {
          if (reqTenantId === tenantId && provider.toUpperCase() === 'RAZORPAY') {
            return {
              keyId: TENANT_KEY_ID,
              keySecret: TENANT_KEY_SECRET,
              webhookSecret: TENANT_WEBHOOK_SECRET,
            };
          }
          return {};
        }),
      };

      auditLogsService = new AuditLogsService(prisma as any);
      invoicesService = new InvoicesService(prisma as any, auditLogsService);
      paymentsService = new PaymentsService(prisma as any, auditLogsService, integrationsMock);
    });

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      delete process.env.PAYMENT_SIMULATION_MODE;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      process.env.RAZORPAY_WEBHOOK_SECRET = TENANT_WEBHOOK_SECRET;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.env.NODE_ENV = originalNodeEnv;
      if (originalRzpKeyId !== undefined) process.env.RAZORPAY_KEY_ID = originalRzpKeyId;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalRzpKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = originalRzpKeySecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
      if (originalRzpWebhookSecret !== undefined) {
        process.env.RAZORPAY_WEBHOOK_SECRET = originalRzpWebhookSecret;
      } else {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
      }
      if (originalPaymentSim !== undefined) {
        process.env.PAYMENT_SIMULATION_MODE = originalPaymentSim;
      } else {
        delete process.env.PAYMENT_SIMULATION_MODE;
      }
    });

    afterAll(async () => {
      if (prisma && tenantId) {
        // Clean up only isolated synthetic records created for this test run in strict FK order
        await prisma.auditLog.deleteMany({ where: { tenantId } });
        await prisma.webhookReplay.deleteMany({
          where: { replayKey: { contains: runPrefix } },
        });
        await prisma.paymentRefund.deleteMany({ where: { tenantId } });
        await prisma.paymentOrderIntent.deleteMany({ where: { tenantId } });
        await prisma.collectionCase.deleteMany({ where: { tenantId } });
        await prisma.paymentPromise.deleteMany({ where: { tenantId } });
        await prisma.payment.deleteMany({ where: { tenantId } });
        await prisma.invoice.deleteMany({ where: { tenantId } });
        await prisma.customer.deleteMany({ where: { tenantId } });
        await prisma.user.deleteMany({ where: { tenantId } });
        await prisma.tenant.deleteMany({ where: { id: tenantId } });
      }
      if (prisma) {
        await prisma.$disconnect();
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PG-CANCEL-01: Cancellation races with payment settlement on the same invoice
    // ──────────────────────────────────────────────────────────────────────────
    it('PG-CANCEL-01: serializes cancellation and payment settlement on the same invoice without corruption or double adjustments', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-CAN-01', amount: 10000 }],
      });
      const inv = invoices[0];

      // Concurrently race invoice cancellation with direct payment settlement
      const cancelPromise = invoicesService.update(inv.id, adminUser, {
        status: InvoiceStatus.CANCELLED,
      });
      const settlePromise = paymentsService.recordPayment(adminUser, {
        invoiceId: inv.id,
        amount: 10000,
        paymentDate: '2026-11-13',
        reference: `REF-PG-CAN-01-${Date.now()}`,
        method: PaymentMethod.BANK_TRANSFER,
      });

      const results = await Promise.allSettled([cancelPromise, settlePromise]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Under strict PostgreSQL Customer-then-Invoice row locks, exactly one operation must succeed
      // and the other must be rejected with BadRequestException
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(BadRequestException);

      // Re-read fresh state from PostgreSQL
      const freshInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const freshCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id } });

      if (results[0].status === 'fulfilled') {
        // Cancellation won: Invoice is CANCELLED, customer balance is 0, no payment applied
        expect(freshInvoice.status).toBe(InvoiceStatus.CANCELLED);
        expect(Number(freshInvoice.amount)).toBe(10000);
        expect(Number(freshInvoice.outstanding)).toBe(10000);
        expect(Number(freshCustomer.outstandingBalance)).toBe(0);
        expect(payments).toHaveLength(0);
        expect(err.message).toContain('Cannot record payment for a CANCELLED invoice');
      } else {
        // Settlement won: Invoice is PAID, payment is COMPLETED, customer balance is 0
        expect(freshInvoice.status).toBe(InvoiceStatus.PAID);
        expect(Number(freshInvoice.outstanding)).toBe(0);
        expect(Number(freshCustomer.outstandingBalance)).toBe(0);
        expect(payments).toHaveLength(1);
        expect(payments[0].status).toBe(PaymentStatus.COMPLETED);
        expect(err.message).toMatch(/Cannot cancel invoice|completed payment records exist|PAID/);
      }

      // In neither serialization outcome can the balance become negative or corrupted
      expect(Number(freshCustomer.outstandingBalance)).toBeGreaterThanOrEqual(0);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PG-CANCEL-02: Cancellation races with settlement on a different invoice of same customer
    // ──────────────────────────────────────────────────────────────────────────
    it('PG-CANCEL-02: Customer-then-Invoice locking prevents lost updates when cancelling one invoice while settling another for same customer', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [
          { number: 'PG-CAN-02A', amount: 12000 },
          { number: 'PG-CAN-02B', amount: 18000 },
        ],
      });
      const [invA, invB] = invoices;

      expect(Number(customer.outstandingBalance)).toBe(30000);

      // Concurrently cancel invoice A while recording partial payment of 8,000 on invoice B
      const cancelPromise = invoicesService.update(invA.id, adminUser, {
        status: InvoiceStatus.CANCELLED,
      });
      const settlePromise = paymentsService.recordPayment(adminUser, {
        invoiceId: invB.id,
        amount: 8000,
        paymentDate: '2026-11-13',
        reference: `REF-PG-CAN-02-${Date.now()}`,
        method: PaymentMethod.BANK_TRANSFER,
      });

      // Both must succeed because they operate on distinct invoices and both lock the shared Customer row first
      const [cancelRes, settleRes] = await Promise.all([cancelPromise, settlePromise]);
      expect(cancelRes.status).toBe(InvoiceStatus.CANCELLED);
      expect(settleRes.payment.status).toBe(PaymentStatus.COMPLETED);

      // Re-read fresh state from PostgreSQL
      const freshInvA = await prisma.invoice.findUniqueOrThrow({ where: { id: invA.id } });
      const freshInvB = await prisma.invoice.findUniqueOrThrow({ where: { id: invB.id } });
      const freshCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });

      expect(freshInvA.status).toBe(InvoiceStatus.CANCELLED);
      expect(Number(freshInvA.amount)).toBe(12000);
      expect(Number(freshInvA.outstanding)).toBe(12000); // Historical outstanding preserved

      expect(freshInvB.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(Number(freshInvB.amount)).toBe(18000);
      expect(Number(freshInvB.outstanding)).toBe(10000); // 18000 - 8000

      // The customer balance MUST equal exactly the remaining active receivable (10,000 INR)
      // Neither update was lost, and CANCELLED invoice A is properly excluded
      expect(Number(freshCustomer.outstandingBalance)).toBe(10000);

      // Verify active receivable query formula matches
      const activeInvoices = await prisma.invoice.findMany({
        where: {
          customerId: customer.id,
          tenantId,
          status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
        },
      });
      const expectedTotal = activeInvoices.reduce((sum, inv) => sum + Number(inv.outstanding), 0);
      expect(Number(freshCustomer.outstandingBalance)).toBe(expectedTotal);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PG-CANCEL-03: Concurrent duplicate cancellation on the same invoice
    // ──────────────────────────────────────────────────────────────────────────
    it('PG-CANCEL-03: handles concurrent duplicate cancellations idempotently without duplicating audit events or balance adjustments', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-CAN-03', amount: 25000 }],
      });
      const inv = invoices[0];

      // Concurrently trigger duplicate cancellation requests on the exact same invoice
      const [res1, res2] = await Promise.allSettled([
        invoicesService.update(inv.id, adminUser, { status: InvoiceStatus.CANCELLED }),
        invoicesService.update(inv.id, adminUser, { status: InvoiceStatus.CANCELLED }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      // Exactly one must succeed, the duplicate must be cleanly rejected
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Invoice is already marked as CANCELLED|Cannot modify an invoice marked as CANCELLED/);

      // Verify final invoice and customer state in PostgreSQL
      const freshInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const freshCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });

      expect(freshInvoice.status).toBe(InvoiceStatus.CANCELLED);
      expect(Number(freshInvoice.amount)).toBe(25000);
      expect(Number(freshInvoice.outstanding)).toBe(25000);
      expect(Number(freshCustomer.outstandingBalance)).toBe(0);

      // Audit log must have recorded EXACTLY ONE cancellation entry in PostgreSQL
      const auditEntries = await prisma.auditLog.findMany({
        where: {
          tenantId,
          entityId: inv.id,
          action: 'invoice.cancelled',
        },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].metadata).toMatchObject({
        newStatus: InvoiceStatus.CANCELLED,
        recalculatedCustomerBalance: 0,
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PG-CANCEL-04: Cancellation races with active Razorpay order intent
    // ──────────────────────────────────────────────────────────────────────────
    it('PG-CANCEL-04A: strictly blocks cancellation when an active order intent already exists', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-CAN-04A', amount: 15000 }],
      });
      const inv = invoices[0];

      // Establish an active PaymentOrderIntent in PostgreSQL
      const intent = await prisma.paymentOrderIntent.create({
        data: {
          tenantId,
          invoiceId: inv.id,
          customerId: customer.id,
          idempotencyKey: `auto:test:${inv.id}`,
          activeClaimKey: `${tenantId}:${inv.id}:1500000:INR`,
          receipt: `rcpt_test_${Date.now()}`.slice(0, 40),
          amount: 15000,
          amountInPaise: 1500000,
          currency: 'INR',
          status: OrderIntentStatus.CREATED,
          provider: 'RAZORPAY',
          keyId: TENANT_KEY_ID,
          expiresAt: new Date(Date.now() + 1800000),
        },
      });

      // Cancellation must be rejected because active payment intent is in progress
      await expect(
        invoicesService.update(inv.id, adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow(BadRequestException);

      // Verify invoice status remains OPEN and customer balance remains intact
      const freshInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const freshCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(freshInvoice.status).toBe(InvoiceStatus.OPEN);
      expect(Number(freshCustomer.outstandingBalance)).toBe(15000);
    });

    it('PG-CANCEL-04B: safely handles concurrency between Razorpay order creation and invoice cancellation', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-CAN-04B', amount: 20000 }],
      });
      const inv = invoices[0];

      const generatedOrderId = `order_pg_can4b_${Date.now()}`;

      // Mock Razorpay Orders API call with a slight delay so PostgreSQL intent creation is active
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          const body = JSON.parse(init.body);
          return {
            ok: true,
            json: async () => ({
              id: generatedOrderId,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        return { ok: false, status: 404, json: async () => ({}) } as any;
      });

      // Concurrently launch order creation and cancellation
      const orderPromise = paymentsService.createRazorpayOrder(adminUser, {
        invoiceId: inv.id,
        amount: 20000,
      });

      // Introduce a slight delay (10ms) before cancellation so order intent is in CREATING status
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cancelPromise = invoicesService.update(inv.id, adminUser, {
        status: InvoiceStatus.CANCELLED,
      });

      const [orderResult, cancelResult] = await Promise.allSettled([orderPromise, cancelPromise]);

      // Re-read fresh state from PostgreSQL
      const freshInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const freshCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      const freshIntents = await prisma.paymentOrderIntent.findMany({ where: { invoiceId: inv.id } });

      if (orderResult.status === 'fulfilled') {
        // Order creation established an active intent; cancellation must have been rejected
        expect(cancelResult.status).toBe('rejected');
        const cancelErr = (cancelResult as PromiseRejectedResult).reason;
        expect(cancelErr).toBeInstanceOf(BadRequestException);
        expect(cancelErr.message).toMatch(/active payment intent in progress|pending payment operations/);

        // Invoice remains OPEN and eligible for payment; customer balance unchanged
        expect(freshInvoice.status).toBe(InvoiceStatus.OPEN);
        expect(Number(freshCustomer.outstandingBalance)).toBe(20000);
        expect(freshIntents.length).toBeGreaterThan(0);
      } else {
        // Cancellation completed first; order creation must have been rejected
        expect(cancelResult.status).toBe('fulfilled');
        const orderErr = (orderResult as PromiseRejectedResult).reason;
        expect(orderErr).toBeInstanceOf(BadRequestException);
        expect(orderErr.message).toContain('Cannot create Razorpay order for CANCELLED invoice');

        // Invoice is CANCELLED and customer balance is 0
        expect(freshInvoice.status).toBe(InvoiceStatus.CANCELLED);
        expect(Number(freshCustomer.outstandingBalance)).toBe(0);
      }
    });

    it('PG-CANCEL-04C: strictly forbids creating a Razorpay order on an already CANCELLED invoice', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-CAN-04C', amount: 16000 }],
      });
      const inv = invoices[0];

      // Cancel invoice first
      await invoicesService.update(inv.id, adminUser, { status: InvoiceStatus.CANCELLED });

      // Attempt creating a Razorpay order on the cancelled invoice
      await expect(
        paymentsService.createRazorpayOrder(adminUser, {
          invoiceId: inv.id,
          amount: 16000,
        }),
      ).rejects.toThrow('Cannot create Razorpay order for CANCELLED invoice');

      // Verify no order intent or pending payment was created
      const intents = await prisma.paymentOrderIntent.findMany({ where: { invoiceId: inv.id } });
      const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
      expect(intents).toHaveLength(0);
      expect(payments).toHaveLength(0);
    });
  },
);

