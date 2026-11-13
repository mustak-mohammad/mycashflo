import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { PrismaClient, InvoiceStatus, PaymentStatus, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service.js';
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
  'PaymentsService - Real PostgreSQL READ COMMITTED Concurrency & Rollback Tests',
  () => {
    const TENANT_KEY_ID = 'rzp_test_pg_pub_123';
    const TENANT_KEY_SECRET = 'rzp_test_pg_priv_secret_123';
    const TENANT_WEBHOOK_SECRET = 'rzp_whsec_pg_test_secret_123';

    const originalNodeEnv = process.env.NODE_ENV;
    const originalRzpKeyId = process.env.RAZORPAY_KEY_ID;
    const originalRzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const originalRzpWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const originalPaymentSim = process.env.PAYMENT_SIMULATION_MODE;

    let prisma: PrismaClient;
    let service: PaymentsService;
    let runPrefix: string;
    let tenantId: string;
    let adminUserId: string;

    function signCheckout(orderId: string, paymentId: string, secret = TENANT_KEY_SECRET) {
      return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    }

    function signWebhook(body: Record<string, any>, secret = TENANT_WEBHOOK_SECRET) {
      const raw = JSON.stringify(body);
      const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      return { raw, signature };
    }

    async function seedScenario(opts: { invoices: Array<{ number: string; amount: number }> }) {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const total = opts.invoices.reduce((sum, inv) => sum + inv.amount, 0);
      const customer = await prisma.customer.create({
        data: {
          tenantId,
          name: `PG Test Customer ${suffix}`,
          email: `pg-${suffix}@example.test`,
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
            status: InvoiceStatus.OPEN,
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

      runPrefix = `pgconc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tenant = await prisma.tenant.create({
        data: {
          name: `PG Concurrency Tenant ${runPrefix}`,
          slug: `pg-conc-${runPrefix}`,
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
      const auditMock: any = {
        log: vi.fn().mockResolvedValue(undefined),
      };

      service = new PaymentsService(prisma as any, auditMock, integrationsMock);
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
        // Delete only synthetic records owned by this disposable test run (respecting FK order)
        await prisma.webhookReplay.deleteMany({
          where: { replayKey: { contains: runPrefix } },
        });
        await prisma.paymentRefund.deleteMany({ where: { tenantId } });
        await prisma.paymentOrderIntent.deleteMany({ where: { tenantId } });
        await prisma.collectionCase.deleteMany({ where: { tenantId } });
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

    it('PG-01: serializes concurrent partial payments on the same invoice under real PostgreSQL READ COMMITTED', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-ONE-INV', amount: 10000 }],
      });
      const inv = invoices[0];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          const body = JSON.parse(init.body);
          const id =
            body.amount === 400000
              ? `order_pg1_a_${Date.now()}`
              : `order_pg1_b_${Date.now()}`;
          return {
            ok: true,
            json: async () => ({
              id,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        const payId = url.split('/').pop()!;
        const isFirst = payId.includes('_a_');
        const matchingOrder = await prisma.paymentOrderIntent.findFirst({
          where: { tenantId, invoiceId: inv.id, amountInPaise: isFirst ? 400000 : 600000 },
        });
        return {
          ok: true,
          json: async () => ({
            id: payId,
            order_id: matchingOrder?.providerOrderId,
            amount: isFirst ? 400000 : 600000,
            currency: 'INR',
            status: 'captured',
          }),
        } as any;
      });

      const o1 = await service.createRazorpayOrder(adminUser, { invoiceId: inv.id, amount: 4000 });
      const o2 = await service.createRazorpayOrder(adminUser, { invoiceId: inv.id, amount: 6000 });

      const pay1Id = `pay_pg1_a_${Date.now()}`;
      const pay2Id = `pay_pg1_b_${Date.now()}`;

      const [v1, v2] = await Promise.all([
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: inv.id,
          razorpay_order_id: o1.orderId,
          razorpay_payment_id: pay1Id,
          razorpay_signature: signCheckout(o1.orderId, pay1Id),
        }),
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: inv.id,
          razorpay_order_id: o2.orderId,
          razorpay_payment_id: pay2Id,
          razorpay_signature: signCheckout(o2.orderId, pay2Id),
        }),
      ]);

      expect(v1.verified).toBe(true);
      expect(v2.verified).toBe(true);

      const refreshedInv = await prisma.invoice.findUnique({ where: { id: inv.id } });
      const refreshedCust = await prisma.customer.findUnique({ where: { id: customer.id } });
      const completedPayments = await prisma.payment.findMany({
        where: { invoiceId: inv.id, status: PaymentStatus.COMPLETED },
      });

      expect(Number(refreshedInv?.outstanding)).toBe(0);
      expect(refreshedInv?.status).toBe(InvoiceStatus.PAID);
      expect(Number(refreshedCust?.outstandingBalance)).toBe(0);
      expect(completedPayments).toHaveLength(2);
    });

    it('PG-02: serializes concurrent settlements across two different invoices of one customer without losing balance updates', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [
          { number: 'PG-MULTI-A', amount: 4000 },
          { number: 'PG-MULTI-B', amount: 6000 },
        ],
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          const body = JSON.parse(init.body);
          const id = `order_pg2_${body.amount}_${Date.now()}`;
          return {
            ok: true,
            json: async () => ({
              id,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        const payId = url.split('/').pop()!;
        const isFirst = payId.includes('_a_');
        const targetInvId = isFirst ? invoices[0].id : invoices[1].id;
        const intent = await prisma.paymentOrderIntent.findFirst({
          where: { tenantId, invoiceId: targetInvId },
        });
        return {
          ok: true,
          json: async () => ({
            id: payId,
            order_id: intent?.providerOrderId,
            amount: isFirst ? 400000 : 600000,
            currency: 'INR',
            status: 'captured',
          }),
        } as any;
      });

      const oA = await service.createRazorpayOrder(adminUser, { invoiceId: invoices[0].id });
      const oB = await service.createRazorpayOrder(adminUser, { invoiceId: invoices[1].id });

      const payA = `pay_pg2_a_${Date.now()}`;
      const payB = `pay_pg2_b_${Date.now()}`;

      await Promise.all([
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: invoices[0].id,
          razorpay_order_id: oA.orderId,
          razorpay_payment_id: payA,
          razorpay_signature: signCheckout(oA.orderId, payA),
        }),
        service.verifyRazorpayPayment(adminUser, {
          invoiceId: invoices[1].id,
          razorpay_order_id: oB.orderId,
          razorpay_payment_id: payB,
          razorpay_signature: signCheckout(oB.orderId, payB),
        }),
      ]);

      const refreshedA = await prisma.invoice.findUnique({ where: { id: invoices[0].id } });
      const refreshedB = await prisma.invoice.findUnique({ where: { id: invoices[1].id } });
      const refreshedCust = await prisma.customer.findUnique({ where: { id: customer.id } });

      expect(Number(refreshedA?.outstanding)).toBe(0);
      expect(Number(refreshedB?.outstanding)).toBe(0);
      expect(Number(refreshedCust?.outstandingBalance)).toBe(0);
    });

    it('PG-03: prevents duplicate Razorpay orders under concurrent createRazorpayOrder calls via PostgreSQL activeClaimKey unique index', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { invoices } = await seedScenario({
        invoices: [{ number: 'PG-CONC-ORD', amount: 7500 }],
      });
      const inv = invoices[0];

      let externalPostCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init: any) => {
        externalPostCount++;
        const body = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            id: `order_pg3_single_${Date.now()}`,
            amount: body.amount,
            currency: 'INR',
            receipt: body.receipt,
            status: 'created',
          }),
        } as any;
      });

      const results = await Promise.all([
        service.createRazorpayOrder(adminUser, { invoiceId: inv.id }),
        service.createRazorpayOrder(adminUser, { invoiceId: inv.id }),
        service.createRazorpayOrder(adminUser, { invoiceId: inv.id }),
        service.createRazorpayOrder(adminUser, { invoiceId: inv.id }),
        service.createRazorpayOrder(adminUser, { invoiceId: inv.id }),
      ]);

      expect(externalPostCount).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(new Set(results.map((r) => r.orderId)).size).toBe(1);

      const intentsInDb = await prisma.paymentOrderIntent.findMany({
        where: { tenantId, invoiceId: inv.id },
      });
      const paymentsInDb = await prisma.payment.findMany({
        where: { tenantId, invoiceId: inv.id },
      });
      expect(intentsInDb).toHaveLength(1);
      expect(paymentsInDb).toHaveLength(1);
    });

    it('PG-04: processes concurrent duplicate and partial refund webhooks accurately in PostgreSQL', async () => {
      const adminUser: any = { userId: adminUserId, tenantId, role: 'ADMIN' };
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-RFND', amount: 10000 }],
      });
      const inv = invoices[0];

      const fixedOrderId = `order_pg4_${Date.now()}`;
      const fixedPayId = `pay_pg4_${Date.now()}`;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
        const url = String(input);
        if (url.endsWith('/v1/orders')) {
          const body = JSON.parse(init.body);
          return {
            ok: true,
            json: async () => ({
              id: fixedOrderId,
              amount: body.amount,
              currency: 'INR',
              receipt: body.receipt,
              status: 'created',
            }),
          } as any;
        }
        return {
          ok: true,
          json: async () => ({
            id: fixedPayId,
            order_id: fixedOrderId,
            amount: 1000000,
            currency: 'INR',
            status: 'captured',
          }),
        } as any;
      });

      await service.createRazorpayOrder(adminUser, { invoiceId: inv.id });
      await service.verifyRazorpayPayment(adminUser, {
        invoiceId: inv.id,
        razorpay_order_id: fixedOrderId,
        razorpay_payment_id: fixedPayId,
        razorpay_signature: signCheckout(fixedOrderId, fixedPayId),
      });

      const rfndA = `rfnd_pg4_a_${Date.now()}`;
      const rfndB = `rfnd_pg4_b_${Date.now()}`;

      const bodyA = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: rfndA, payment_id: fixedPayId, amount: 300000, currency: 'INR' } } },
      };
      const bodyB = {
        event: 'refund.processed',
        payload: { refund: { entity: { id: rfndB, payment_id: fixedPayId, amount: 400000, currency: 'INR' } } },
      };

      const sA1 = signWebhook(bodyA);
      const sA2 = signWebhook(bodyA);
      const sB = signWebhook(bodyB);

      await Promise.all([
        service.handleWebhook(
          'razorpay',
          bodyA,
          { 'x-razorpay-signature': sA1.signature, 'x-razorpay-event-id': `evt_${runPrefix}_a1` },
          sA1.raw,
        ),
        service.handleWebhook(
          'razorpay',
          bodyA,
          { 'x-razorpay-signature': sA2.signature, 'x-razorpay-event-id': `evt_${runPrefix}_a2` },
          sA2.raw,
        ),
        service.handleWebhook(
          'razorpay',
          bodyB,
          { 'x-razorpay-signature': sB.signature, 'x-razorpay-event-id': `evt_${runPrefix}_b1` },
          sB.raw,
        ),
      ]);

      const refreshedInv = await prisma.invoice.findUnique({ where: { id: inv.id } });
      const refreshedCust = await prisma.customer.findUnique({ where: { id: customer.id } });
      const refundsInDb = await prisma.paymentRefund.findMany({
        where: { tenantId, invoiceId: inv.id },
      });
      const paymentRow = await prisma.payment.findFirst({
        where: { tenantId, invoiceId: inv.id },
      });

      expect(refundsInDb).toHaveLength(2);
      expect(Number(refreshedInv?.outstanding)).toBe(7000);
      expect(refreshedInv?.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(Number(refreshedCust?.outstandingBalance)).toBe(7000);
      expect(paymentRow?.status).toBe(PaymentStatus.COMPLETED);
    });

    it('PG-05: rolls back real PostgreSQL transaction and WebhookReplay claim cleanly on out-of-order failure and allows retry', async () => {
      const { customer, invoices } = await seedScenario({
        invoices: [{ number: 'PG-ROLLBACK', amount: 5000 }],
      });
      const inv = invoices[0];

      const ordId = `order_pg5_${Date.now()}`;
      const payId = `pay_pg5_${Date.now()}`;
      const rfndId = `rfnd_pg5_${Date.now()}`;
      const replayEventId = `evt_${runPrefix}_ooo_rb`;

      // Seed PENDING checkout order anchor
      await prisma.payment.create({
        data: {
          ref: `RZP-ORD-${ordId}`,
          tenantId,
          customerId: customer.id,
          invoiceId: inv.id,
          amount: 5000,
          currency: 'INR',
          method: 'PAYMENT_LINK',
          status: PaymentStatus.PENDING,
          providerRef: ordId,
          notes: `Razorpay Checkout Order [order:${ordId}]`,
        },
      });

      // Out-of-order refund.processed before payment settled -> MUST throw AND roll back WebhookReplay row!
      const earlyBody = {
        event: 'refund.processed',
        payload: {
          refund: { entity: { id: rfndId, payment_id: payId, amount: 500000, currency: 'INR' } },
          payment: { entity: { id: payId, order_id: ordId, amount: 500000, currency: 'INR' } },
        },
      };
      const sEarly = signWebhook(earlyBody);

      await expect(
        service.handleWebhook(
          'razorpay',
          earlyBody,
          { 'x-razorpay-signature': sEarly.signature, 'x-razorpay-event-id': replayEventId },
          sEarly.raw,
        ),
      ).rejects.toThrow(`before payment ${payId} settlement is recorded`);

      // Verify PostgreSQL rolled back the WebhookReplay claim and left balances untouched
      const replayAfterRollback = await prisma.webhookReplay.findFirst({
        where: { replayKey: `razorpay:event:${replayEventId}` },
      });
      const invAfterRollback = await prisma.invoice.findUnique({ where: { id: inv.id } });
      expect(replayAfterRollback).toBeNull();
      expect(Number(invAfterRollback?.outstanding)).toBe(5000);

      // Now payment.captured settles, and retried refund.processed (with SAME replayEventId) succeeds!
      const capBody = {
        event: 'payment.captured',
        payload: { payment: { entity: { id: payId, order_id: ordId, amount: 500000, currency: 'INR' } } },
      };
      const sCap = signWebhook(capBody);
      await service.handleWebhook(
        'razorpay',
        capBody,
        { 'x-razorpay-signature': sCap.signature, 'x-razorpay-event-id': `evt_${runPrefix}_cap5` },
        sCap.raw,
      );

      const retryRfnd = await service.handleWebhook(
        'razorpay',
        earlyBody,
        { 'x-razorpay-signature': sEarly.signature, 'x-razorpay-event-id': replayEventId },
        sEarly.raw,
      );

      expect(retryRfnd.status).toBe('REFUND_PROCESSED');
      expect(retryRfnd.idempotent).toBe(false);

      const finalInv = await prisma.invoice.findUnique({ where: { id: inv.id } });
      const finalCust = await prisma.customer.findUnique({ where: { id: customer.id } });
      expect(Number(finalInv?.outstanding)).toBe(5000);
      expect(finalInv?.status).toBe(InvoiceStatus.OPEN);
      expect(Number(finalCust?.outstandingBalance)).toBe(5000);
    });
  },
);

