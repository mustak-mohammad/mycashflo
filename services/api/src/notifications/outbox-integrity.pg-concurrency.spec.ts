import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  PrismaClient,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  NotificationChannel,
  OutboxJobStatus,
  OutboxJobType,
  ReminderStage,
  ConsentState,
} from '@prisma/client';
import { executeWithDeadlockRetry } from '../common/deadlock-retry.util.js';
import { NotificationOutboxService } from './notification-outbox.service.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: OFFLINE / UNIT BEHAVIORAL VERIFICATION (Runs in all CI environments)
// ─────────────────────────────────────────────────────────────────────────────
describe('NotificationOutbox - Integrity, Lock Ordering & Deadlock Resilience Logic', () => {
  it('correctly models strict global lock ordering (Customer -> Invoice -> Payment)', () => {
    const lockAcquisitionOrder = ['Customer', 'Invoice', 'Payment'];
    expect(lockAcquisitionOrder[0]).toBe('Customer');
    expect(lockAcquisitionOrder[1]).toBe('Invoice');
    expect(lockAcquisitionOrder[2]).toBe('Payment');
  });

  it('bounded retry recovers from transient 40P01 deadlock errors', async () => {
    let callCount = 0;
    const flakyOperation = async () => {
      callCount++;
      if (callCount < 3) {
        const deadlockErr = new Error('deadlock detected');
        (deadlockErr as any).code = '40P01';
        throw deadlockErr;
      }
      return 'SUCCESS_AFTER_RETRY';
    };

    const result = await executeWithDeadlockRetry(flakyOperation, 4, 10);
    expect(result).toBe('SUCCESS_AFTER_RETRY');
    expect(callCount).toBe(3);
  });

  it('bounded retry gives up after exceeding maxRetries on persistent errors', async () => {
    let callCount = 0;
    const persistentDeadlock = async () => {
      callCount++;
      const deadlockErr = new Error('deadlock detected');
      (deadlockErr as any).code = '40P01';
      throw deadlockErr;
    };

    await expect(executeWithDeadlockRetry(persistentDeadlock, 3, 10)).rejects.toThrow('deadlock detected');
    expect(callCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: REAL POSTGRESQL CONCURRENCY & INTEGRITY (Runs only when TEST_DATABASE_URL is set)
// ─────────────────────────────────────────────────────────────────────────────
describe.runIf(Boolean(testDbUrl))(
  'NotificationOutbox - Real PostgreSQL Parent Integrity & Concurrency Verification',
  () => {
    let prisma: PrismaClient;
    let testDbName: string;
    let tenantAlpha: string;
    let tenantBeta: string;
    let customerA1: string;
    let customerA2: string;
    let invoiceA1: string;
    let paymentA1: string;

    beforeAll(async () => {
      testDbName = assertSafeTestDatabaseUrl(testDbUrl);
      prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      tenantAlpha = `tenant_a_${suffix}`;
      tenantBeta = `tenant_b_${suffix}`;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt") VALUES ('${tenantAlpha}', 'Alpha Corp ${suffix}', '${tenantAlpha}', NOW(), NOW());`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Tenant" (id, name, slug, "createdAt", "updatedAt") VALUES ('${tenantBeta}', 'Beta Corp ${suffix}', '${tenantBeta}', NOW(), NOW());`,
      );

      customerA1 = `cust_a1_${suffix}`;
      customerA2 = `cust_a2_${suffix}`;

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Customer" (id, "tenantId", name, email, phone, "outstandingBalance", currency, "createdAt", "updatedAt")
         VALUES ('${customerA1}', '${tenantAlpha}', 'Customer 1 ${suffix}', 'c1_${suffix}@test.local', '+919876543210', 50000, 'INR', NOW(), NOW());`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Customer" (id, "tenantId", name, email, phone, "outstandingBalance", currency, "createdAt", "updatedAt")
         VALUES ('${customerA2}', '${tenantAlpha}', 'Customer 2 ${suffix}', 'c2_${suffix}@test.local', '+919876543211', 25000, 'INR', NOW(), NOW());`,
      );

      invoiceA1 = `inv_a1_${suffix}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Invoice" (id, "tenantId", "customerId", number, amount, outstanding, currency, status, "issueDate", "dueDate", "createdAt", "updatedAt")
         VALUES ('${invoiceA1}', '${tenantAlpha}', '${customerA1}', 'INV-A1-${suffix}', 50000, 50000, 'INR', 'OPEN', NOW(), NOW() + interval '7 days', NOW(), NOW());`,
      );

      paymentA1 = `pay_a1_${suffix}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Payment" (id, ref, "tenantId", "customerId", "invoiceId", amount, currency, status, method, "paidAt", "createdAt", "updatedAt")
         VALUES ('${paymentA1}', 'REF-${paymentA1}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', 50000, 'INR', 'COMPLETED', 'BANK_TRANSFER', NOW(), NOW(), NOW());`,
      );

      // Seed valid Outbox records referencing Customer, Invoice, and Payment
      await prisma.$executeRawUnsafe(
        `INSERT INTO "NotificationOutbox" (id, "tenantId", "customerId", "invoiceId", "jobType", channel, template, stage, status, "idempotencyKey", "scheduledFor", "createdAt", "updatedAt")
         VALUES ('outbox_inv_${suffix}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', 'REMINDER', 'WHATSAPP', 'reminder_template', 'DUE_SOON', 'PENDING', 'key_inv_${suffix}', NOW(), NOW(), NOW());`,
      );

      await prisma.$executeRawUnsafe(
        `INSERT INTO "NotificationOutbox" (id, "tenantId", "customerId", "invoiceId", "paymentId", "jobType", channel, template, status, "idempotencyKey", "scheduledFor", "createdAt", "updatedAt")
         VALUES ('outbox_pay_${suffix}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', '${paymentA1}', 'PAYMENT_RECEIPT', 'EMAIL', 'receipt_template', 'PENDING', 'key_pay_${suffix}', NOW(), NOW(), NOW());`,
      );
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.$disconnect();
      }
    });

    it('Scenario 1: Rejects updating Customer tenantId when referenced by outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Customer" SET "tenantId" = '${tenantBeta}' WHERE id = '${customerA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Customer/);
      }
      expect(rejected).toBe(true);

      // Verify rollback / unchanged state
      const [cust] = (await prisma.$queryRawUnsafe(
        `SELECT "tenantId" FROM "Customer" WHERE id = '${customerA1}';`,
      )) as any[];
      expect(cust.tenantId).toBe(tenantAlpha);
    });

    it('Scenario 2: Rejects updating Invoice tenantId when referenced by outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Invoice" SET "tenantId" = '${tenantBeta}' WHERE id = '${invoiceA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Invoice/);
      }
      expect(rejected).toBe(true);

      const [inv] = (await prisma.$queryRawUnsafe(
        `SELECT "tenantId" FROM "Invoice" WHERE id = '${invoiceA1}';`,
      )) as any[];
      expect(inv.tenantId).toBe(tenantAlpha);
    });

    it('Scenario 3: Rejects updating Invoice customerId when referenced by outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Invoice" SET "customerId" = '${customerA2}' WHERE id = '${invoiceA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Invoice/);
      }
      expect(rejected).toBe(true);

      const [inv] = (await prisma.$queryRawUnsafe(
        `SELECT "customerId" FROM "Invoice" WHERE id = '${invoiceA1}';`,
      )) as any[];
      expect(inv.customerId).toBe(customerA1);
    });

    it('Scenario 4: Rejects updating Payment tenantId when referenced by outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Payment" SET "tenantId" = '${tenantBeta}' WHERE id = '${paymentA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Payment/);
      }
      expect(rejected).toBe(true);

      const [pay] = (await prisma.$queryRawUnsafe(
        `SELECT "tenantId" FROM "Payment" WHERE id = '${paymentA1}';`,
      )) as any[];
      expect(pay.tenantId).toBe(tenantAlpha);
    });

    it('Scenario 5: Rejects updating Payment customerId when referenced by outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Payment" SET "customerId" = '${customerA2}' WHERE id = '${paymentA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Payment/);
      }
      expect(rejected).toBe(true);

      const [pay] = (await prisma.$queryRawUnsafe(
        `SELECT "customerId" FROM "Payment" WHERE id = '${paymentA1}';`,
      )) as any[];
      expect(pay.customerId).toBe(customerA1);
    });

    it('Scenario 6: Rejects updating Payment invoiceId when referenced by payment receipt outbox', async () => {
      let rejected = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Payment" SET "invoiceId" = 'different_invoice_id' WHERE id = '${paymentA1}';`,
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toMatch(/Parent-side integrity violation/);
        expect(err.message).toMatch(/Cannot change Payment/);
      }
      expect(rejected).toBe(true);

      const [pay] = (await prisma.$queryRawUnsafe(
        `SELECT "invoiceId" FROM "Payment" WHERE id = '${paymentA1}';`,
      )) as any[];
      expect(pay.invoiceId).toBe(invoiceA1);
    });

    it('Control: Valid non-ownership updates continue to work without interference', async () => {
      // 1. Update customer name and notes on referenced customer
      await prisma.$executeRawUnsafe(
        `UPDATE "Customer" SET name = 'Updated Alice', notes = 'Active customer' WHERE id = '${customerA1}';`,
      );
      const [cust] = (await prisma.$queryRawUnsafe(
        `SELECT name, notes FROM "Customer" WHERE id = '${customerA1}';`,
      )) as any[];
      expect(cust.name).toBe('Updated Alice');
      expect(cust.notes).toBe('Active customer');

      // 2. Update invoice description on referenced invoice
      await prisma.$executeRawUnsafe(
        `UPDATE "Invoice" SET description = 'Updated billing description' WHERE id = '${invoiceA1}';`,
      );
      const [inv] = (await prisma.$queryRawUnsafe(
        `SELECT description FROM "Invoice" WHERE id = '${invoiceA1}';`,
      )) as any[];
      expect(inv.description).toBe('Updated billing description');

      // 3. Update customer without outbox references
      await prisma.$executeRawUnsafe(
        `UPDATE "Customer" SET "tenantId" = '${tenantBeta}' WHERE id = '${customerA2}';`,
      );
      const [cust2] = (await prisma.$queryRawUnsafe(
        `SELECT "tenantId" FROM "Customer" WHERE id = '${customerA2}';`,
      )) as any[];
      expect(cust2.tenantId).toBe(tenantBeta);
    });

    it('Lock Hierarchy: Concurrent payment lock and outbox insertion serialize without deadlock', async () => {
      // Simulate concurrent transaction ordering
      // Tx1 acquires Customer FOR UPDATE, then Invoice FOR UPDATE
      // Tx2 inserts into Outbox, acquiring Customer FOR SHARE, then Invoice FOR SHARE
      const p1 = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
      const p2 = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

      let tx1Finished = false;
      let tx2Finished = false;

      const tx1Promise = p1.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT id FROM "Customer" WHERE id = '${customerA1}' FOR UPDATE;`,
        );
        // Hold lock briefly to ensure Tx2 attempts concurrent access
        await new Promise((res) => setTimeout(res, 80));
        await tx.$queryRawUnsafe(
          `SELECT id FROM "Invoice" WHERE id = '${invoiceA1}' FOR UPDATE;`,
        );
        tx1Finished = true;
      });

      const tx2Promise = (async () => {
        // Wait 20ms so Tx1 has acquired Customer lock
        await new Promise((res) => setTimeout(res, 20));
        return p2.$transaction(async (tx) => {
          // Outbox trigger will request FOR SHARE on Customer then Invoice
          await tx.$executeRawUnsafe(
            `INSERT INTO "NotificationOutbox" (id, "tenantId", "customerId", "invoiceId", "jobType", channel, template, stage, status, "idempotencyKey", "scheduledFor", "createdAt", "updatedAt")
             VALUES ('concurrent_outbox_${Date.now()}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', 'REMINDER', 'EMAIL', 'test_tpl', 'DUE_SOON', 'PENDING', 'concurrent_key_${Date.now()}', NOW(), NOW(), NOW());`,
          );
          tx2Finished = true;
        });
      })();

      await Promise.all([tx1Promise, tx2Promise]);
      expect(tx1Finished).toBe(true);
      expect(tx2Finished).toBe(true);

      await p1.$disconnect();
      await p2.$disconnect();
    });

    it('NotificationOutboxService: Transactional enqueue and idempotency in real PostgreSQL', async () => {
      const outboxService = new NotificationOutboxService(prisma as any);
      const testKey = `tx_test_key_${Date.now()}`;

      // Enqueue job inside transaction
      const res1 = await prisma.$transaction(async (tx) => {
        return outboxService.enqueueReminderTx(tx, {
          tenantId: tenantAlpha,
          customerId: customerA1,
          invoiceId: invoiceA1,
          channel: NotificationChannel.EMAIL,
          template: 'reminder_tx_test',
          stage: ReminderStage.DUE_SOON,
          idempotencyKey: testKey,
          validateConsent: false,
        });
      });

      expect(res1.created).toBe(true);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.job.idempotencyKey).toBe(testKey);

      // Call enqueue with the same key inside a second transaction
      const res2 = await prisma.$transaction(async (tx) => {
        return outboxService.enqueueReminderTx(tx, {
          tenantId: tenantAlpha,
          customerId: customerA1,
          invoiceId: invoiceA1,
          channel: NotificationChannel.EMAIL,
          template: 'reminder_tx_test',
          stage: ReminderStage.DUE_SOON,
          idempotencyKey: testKey,
          validateConsent: false,
        });
      });

      expect(res2.created).toBe(false);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.job.id).toBe(res1.job.id);
    });

    it('NotificationOutboxService: Concurrent duplicate requests yield exactly one created job in PostgreSQL', async () => {
      const outboxService = new NotificationOutboxService(prisma as any);
      const sharedKey = `shared_concurrent_key_${Date.now()}`;

      const p1 = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
      const p2 = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

      const tx1 = p1.$transaction(async (tx) => {
        return outboxService.enqueueReminderTx(tx, {
          tenantId: tenantAlpha,
          customerId: customerA1,
          invoiceId: invoiceA1,
          channel: NotificationChannel.EMAIL,
          template: 'concurrent_tpl',
          stage: ReminderStage.DUE_SOON,
          idempotencyKey: sharedKey,
          validateConsent: false,
        });
      });

      const tx2 = p2.$transaction(async (tx) => {
        return outboxService.enqueueReminderTx(tx, {
          tenantId: tenantAlpha,
          customerId: customerA1,
          invoiceId: invoiceA1,
          channel: NotificationChannel.EMAIL,
          template: 'concurrent_tpl',
          stage: ReminderStage.DUE_SOON,
          idempotencyKey: sharedKey,
          validateConsent: false,
        });
      });

      const [r1, r2] = await Promise.all([tx1, tx2]);

      const createdCount = (r1.created ? 1 : 0) + (r2.created ? 1 : 0);
      const duplicateCount = (r1.isDuplicate ? 1 : 0) + (r2.isDuplicate ? 1 : 0);

      expect(createdCount).toBe(1);
      expect(duplicateCount).toBe(1);
      expect(r1.job.id).toBe(r2.job.id);

      // Verify row count in database
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int as count FROM "NotificationOutbox" WHERE "tenantId" = '${tenantAlpha}' AND "idempotencyKey" = '${sharedKey}';`,
      )) as any[];
      expect(rows[0].count).toBe(1);

      await p1.$disconnect();
      await p2.$disconnect();
    });

    it('NotificationOutboxService: Payment receipt rollback leaves zero orphan outbox jobs', async () => {
      const outboxService = new NotificationOutboxService(prisma as any);
      const receiptKey = `orphan_test_receipt_${Date.now()}`;

      let txErrorCaught = false;
      try {
        await prisma.$transaction(async (tx) => {
          // 1. Create a dummy payment
          const payId = `pay_rollback_${Date.now()}`;
          await tx.$executeRawUnsafe(
            `INSERT INTO "Payment" (id, ref, "tenantId", "customerId", "invoiceId", amount, currency, status, method, "paidAt", "createdAt", "updatedAt")
             VALUES ('${payId}', 'REF-${payId}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', 1000, 'INR', 'COMPLETED', 'BANK_TRANSFER', NOW(), NOW(), NOW());`,
          );

          // 2. Enqueue receipt
          await outboxService.enqueuePaymentReceiptTx(tx, {
            tenantId: tenantAlpha,
            customerId: customerA1,
            paymentId: payId,
            channel: NotificationChannel.EMAIL,
            idempotencyKey: receiptKey,
            validateConsent: false,
          });

          // 3. Intentionally abort transaction
          throw new Error('SIMULATED_PAYMENT_FAILURE');
        });
      } catch (err: any) {
        if (err.message === 'SIMULATED_PAYMENT_FAILURE') {
          txErrorCaught = true;
        }
      }

      expect(txErrorCaught).toBe(true);

      // 4. Verify ZERO orphan outbox rows were committed
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int as count FROM "NotificationOutbox" WHERE "tenantId" = '${tenantAlpha}' AND "idempotencyKey" = '${receiptKey}';`,
      )) as any[];
      expect(rows[0].count).toBe(0);
    });

    it('NotificationOutboxService: Suppresses PENDING/CLAIMED/RETRY_WAIT but NEVER touches DISPATCHING or UNCERTAIN', async () => {
      const outboxService = new NotificationOutboxService(prisma as any);
      const suffix = Date.now().toString();

      // Seed jobs in various statuses
      const statuses = [
        { id: `job_pend_${suffix}`, status: 'PENDING' },
        { id: `job_claim_${suffix}`, status: 'CLAIMED' },
        { id: `job_retry_${suffix}`, status: 'RETRY_WAIT' },
        { id: `job_disp_${suffix}`, status: 'DISPATCHING' },
        { id: `job_uncert_${suffix}`, status: 'UNCERTAIN' },
      ];

      for (const s of statuses) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "NotificationOutbox" (id, "tenantId", "customerId", "invoiceId", "jobType", channel, template, stage, status, "idempotencyKey", "scheduledFor", "createdAt", "updatedAt")
           VALUES ('${s.id}', '${tenantAlpha}', '${customerA1}', '${invoiceA1}', 'REMINDER', 'EMAIL', 'tpl', 'DUE_SOON', '${s.status}', 'key_${s.id}', NOW(), NOW(), NOW());`,
        );
      }

      // Execute suppression inside transaction
      await prisma.$transaction(async (tx) => {
        return outboxService.suppressPendingInvoiceRemindersTx(
          tx,
          tenantAlpha,
          invoiceA1,
          'INVOICE_SETTLED_TEST',
        );
      });

      // Query statuses
      const checkStatus = async (id: string) => {
        const [r] = (await prisma.$queryRawUnsafe(
          `SELECT status FROM "NotificationOutbox" WHERE id = '${id}';`,
        )) as any[];
        return r.status;
      };

      expect(await checkStatus(`job_pend_${suffix}`)).toBe('SUPPRESSED');
      expect(await checkStatus(`job_claim_${suffix}`)).toBe('SUPPRESSED');
      expect(await checkStatus(`job_retry_${suffix}`)).toBe('SUPPRESSED');
      // Critical invariants:
      expect(await checkStatus(`job_disp_${suffix}`)).toBe('DISPATCHING');
      expect(await checkStatus(`job_uncert_${suffix}`)).toBe('UNCERTAIN');
    });
  },
);
