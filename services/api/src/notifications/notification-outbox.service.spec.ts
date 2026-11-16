import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service.js';
import {
  NotificationChannel,
  OutboxJobStatus,
  OutboxJobType,
  ReminderStage,
} from './notification-outbox.types.js';
import { ConsentState } from '@prisma/client';

describe('NotificationOutboxService (Unit & Transactional Logic)', () => {
  let service: NotificationOutboxService;
  let mockPrisma: any;
  let mockTx: any;

  const tenantId = 'tenant_demo';
  const customerId = 'cust_123';
  const invoiceId = 'inv_456';
  const paymentId = 'pay_789';

  beforeEach(() => {
    mockPrisma = {};
    service = new NotificationOutboxService(mockPrisma);

    // Mock Prisma Transaction Client (notice tx.$transaction is undefined)
    mockTx = {
      customer: {
        findFirst: vi.fn(),
      },
      invoice: {
        findFirst: vi.fn(),
      },
      payment: {
        findFirst: vi.fn(),
      },
      notificationOutbox: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
  });

  describe('assertTransactionClient & Scope Boundaries', () => {
    it('throws BadRequestException if tx client is missing', async () => {
      await expect(
        service.enqueueJobTx(null as any, {
          tenantId,
          customerId,
          jobType: OutboxJobType.REMINDER,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if root PrismaClient is passed instead of transaction client', async () => {
      const rootPrismaMock = { $transaction: vi.fn() };
      await expect(
        service.enqueueJobTx(rootPrismaMock as any, {
          tenantId,
          customerId,
          jobType: OutboxJobType.REMINDER,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Check Constraint & Business Relationship Validation', () => {
    it('rejects REMINDER job without invoiceId', async () => {
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.REMINDER,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
          stage: ReminderStage.DUE_SOON,
        }),
      ).rejects.toThrow('invoiceId is required for REMINDER jobs');
    });

    it('rejects REMINDER job with paymentId', async () => {
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.REMINDER,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
          invoiceId,
          paymentId,
          stage: ReminderStage.DUE_SOON,
        }),
      ).rejects.toThrow('paymentId must be null for REMINDER jobs');
    });

    it('rejects REMINDER job without stage', async () => {
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.REMINDER,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
          invoiceId,
        }),
      ).rejects.toThrow('stage is required for REMINDER jobs');
    });

    it('rejects PAYMENT_RECEIPT job without paymentId', async () => {
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.PAYMENT_RECEIPT,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow('paymentId is required for PAYMENT_RECEIPT jobs');
    });

    it('rejects PAYMENT_RECEIPT job with stage', async () => {
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.PAYMENT_RECEIPT,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
          paymentId,
          stage: ReminderStage.DUE_SOON,
        }),
      ).rejects.toThrow('stage must be null for PAYMENT_RECEIPT jobs');
    });

    it('rejects when customer does not belong to specified tenant', async () => {
      mockTx.customer.findFirst.mockResolvedValue(null);
      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          jobType: OutboxJobType.CUSTOM_NOTIFICATION,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow(/Customer cust_123 does not exist in tenant/);
    });

    it('rejects when invoice belongs to a different customer', async () => {
      mockTx.customer.findFirst.mockResolvedValue({ id: customerId, status: 'ACTIVE' });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId: 'different_cust' });

      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          invoiceId,
          jobType: OutboxJobType.REMINDER,
          stage: ReminderStage.DUE_SOON,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow(/belongs to customer different_cust, but Outbox specifies customer cust_123/);
    });

    it('rejects when payment is associated with a different invoice', async () => {
      mockTx.customer.findFirst.mockResolvedValue({ id: customerId, status: 'ACTIVE' });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.payment.findFirst.mockResolvedValue({
        id: paymentId,
        customerId,
        invoiceId: 'different_inv',
      });

      await expect(
        service.enqueueJobTx(mockTx, {
          tenantId,
          customerId,
          invoiceId,
          paymentId,
          jobType: OutboxJobType.PAYMENT_RECEIPT,
          channel: NotificationChannel.EMAIL,
          template: 't1',
          idempotencyKey: 'k1',
        }),
      ).rejects.toThrow(/Payment pay_789 is associated with invoice different_inv, but Outbox specifies invoice inv_456/);
    });
  });

  describe('Deterministic Idempotency & Collision Protection', () => {
    it('creates a new job when idempotency key is unseen', async () => {
      mockTx.customer.findFirst.mockResolvedValue({ id: customerId, status: 'ACTIVE' });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockResolvedValue({
        id: 'job_new',
        tenantId,
        customerId,
        idempotencyKey: 'key_1',
        status: OutboxJobStatus.PENDING,
      });

      const res = await service.enqueueJobTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        jobType: OutboxJobType.REMINDER,
        stage: ReminderStage.DUE_SOON,
        channel: NotificationChannel.EMAIL,
        template: 't1',
        idempotencyKey: 'key_1',
      });

      expect(res.created).toBe(true);
      expect(res.isDuplicate).toBe(false);
      expect(res.job.id).toBe('job_new');
      expect(mockTx.notificationOutbox.create).toHaveBeenCalledTimes(1);
    });

    it('returns existing job deterministically when idempotency collision occurs', async () => {
      mockTx.customer.findFirst.mockResolvedValue({ id: customerId, status: 'ACTIVE' });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue({
        id: 'job_existing',
        tenantId,
        customerId,
        idempotencyKey: 'key_1',
        status: OutboxJobStatus.COMPLETED,
      });

      const res = await service.enqueueJobTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        jobType: OutboxJobType.REMINDER,
        stage: ReminderStage.DUE_SOON,
        channel: NotificationChannel.EMAIL,
        template: 't1',
        idempotencyKey: 'key_1',
      });

      expect(res.created).toBe(false);
      expect(res.isDuplicate).toBe(true);
      expect(res.job.id).toBe('job_existing');
      expect(res.job.status).toBe(OutboxJobStatus.COMPLETED);
      // Ensures previously completed job was NOT recreated or mutated
      expect(mockTx.notificationOutbox.create).not.toHaveBeenCalled();
      expect(mockTx.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('handles concurrent P2002 race condition gracefully', async () => {
      mockTx.customer.findFirst.mockResolvedValue({ id: customerId, status: 'ACTIVE' });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      // Initially findUnique returns null
      mockTx.notificationOutbox.findUnique
        .mockResolvedValueOnce(null)
        // Then on P2002 race fallback it returns the newly created job
        .mockResolvedValueOnce({
          id: 'job_raced',
          tenantId,
          idempotencyKey: 'key_race',
          status: OutboxJobStatus.PENDING,
        });

      mockTx.notificationOutbox.create.mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`tenantId`,`idempotencyKey`)',
      });

      const res = await service.enqueueJobTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        jobType: OutboxJobType.REMINDER,
        stage: ReminderStage.DUE_SOON,
        channel: NotificationChannel.EMAIL,
        template: 't1',
        idempotencyKey: 'key_race',
      });

      expect(res.created).toBe(false);
      expect(res.isDuplicate).toBe(true);
      expect(res.job.id).toBe('job_raced');
    });
  });

  describe('Reminder Enqueue & Channel-Specific Consent Evaluation', () => {
    it('enqueues as PENDING when customer has explicit OPTED_IN consent for EMAIL', async () => {
      mockTx.customer.findFirst.mockResolvedValue({
        id: customerId,
        status: 'ACTIVE',
        email: 'alice@example.test',
        phone: '+919876543210',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.UNKNOWN,
      });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'job_email', ...data }),
      );

      const res = await service.enqueueReminderTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        channel: NotificationChannel.EMAIL,
        template: 'reminder_email',
        stage: ReminderStage.DUE_SOON,
      });

      expect(res.job.status).toBe(OutboxJobStatus.PENDING);
      expect(res.job.idempotencyKey).toBe(`rem:${tenantId}:${invoiceId}:DUE_SOON:EMAIL`);
    });

    it('enqueues as SUPPRESSED when customer has UNKNOWN consent for WHATSAPP', async () => {
      mockTx.customer.findFirst.mockResolvedValue({
        id: customerId,
        status: 'ACTIVE',
        email: 'alice@example.test',
        phone: '+919876543210',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.UNKNOWN,
      });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'job_wa', ...data }),
      );

      const res = await service.enqueueReminderTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        channel: NotificationChannel.WHATSAPP,
        template: 'reminder_wa',
        stage: ReminderStage.DUE_SOON,
      });

      expect(res.job.status).toBe(OutboxJobStatus.SUPPRESSED);
      expect(res.job.lastError).toMatch(/SUPPRESSED: Customer has not explicitly opted into WHATSAPP communications/);
      expect(res.job.idempotencyKey).toBe(`rem:${tenantId}:${invoiceId}:DUE_SOON:WHATSAPP`);
    });

    it('enqueues as SUPPRESSED when customer status is INACTIVE', async () => {
      mockTx.customer.findFirst.mockResolvedValue({
        id: customerId,
        status: 'INACTIVE',
        email: 'inactive@example.test',
        emailConsent: ConsentState.OPTED_IN,
      });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'job_inactive', ...data }),
      );

      const res = await service.enqueueReminderTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        channel: NotificationChannel.EMAIL,
        template: 'reminder_email',
        stage: ReminderStage.DUE_SOON,
      });

      expect(res.job.status).toBe(OutboxJobStatus.SUPPRESSED);
      expect(res.job.lastError).toMatch(/Customer status is INACTIVE/);
    });

    it('enqueues as SUPPRESSED when recipient email is invalid or missing', async () => {
      mockTx.customer.findFirst.mockResolvedValue({
        id: customerId,
        status: 'ACTIVE',
        email: 'invalid-email-string',
        emailConsent: ConsentState.OPTED_IN,
      });
      mockTx.invoice.findFirst.mockResolvedValue({ id: invoiceId, customerId });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'job_bad_email', ...data }),
      );

      const res = await service.enqueueReminderTx(mockTx, {
        tenantId,
        customerId,
        invoiceId,
        channel: NotificationChannel.EMAIL,
        template: 'reminder_email',
        stage: ReminderStage.DUE_SOON,
      });

      expect(res.job.status).toBe(OutboxJobStatus.SUPPRESSED);
      expect(res.job.lastError).toMatch(/missing or invalid email address/);
    });
  });

  describe('Payment Receipt Enqueue', () => {
    it('enqueues a receipt tied to payment transaction with stable idempotency key', async () => {
      mockTx.payment.findFirst.mockResolvedValue({
        id: paymentId,
        customerId,
        invoiceId,
        amount: 25000,
        currency: 'INR',
        paidAt: new Date('2026-11-16T12:00:00Z'),
      });
      mockTx.customer.findFirst.mockResolvedValue({
        id: customerId,
        status: 'ACTIVE',
        emailConsent: ConsentState.OPTED_IN,
      });
      mockTx.invoice.findFirst.mockResolvedValue({
        id: invoiceId,
        customerId,
      });
      mockTx.notificationOutbox.findUnique.mockResolvedValue(null);
      mockTx.notificationOutbox.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'job_receipt', ...data }),
      );

      const res = await service.enqueuePaymentReceiptTx(mockTx, {
        tenantId,
        customerId,
        paymentId,
        channel: NotificationChannel.EMAIL,
      });

      expect(res.created).toBe(true);
      expect(res.job.jobType).toBe(OutboxJobType.PAYMENT_RECEIPT);
      expect(res.job.paymentId).toBe(paymentId);
      expect(res.job.invoiceId).toBe(invoiceId);
      expect(res.job.stage).toBeNull();
      expect(res.job.idempotencyKey).toBe(`receipt:${tenantId}:${paymentId}:EMAIL`);
    });
  });

  describe('Suppression & Cancellation Safeguards', () => {
    it('suppresses PENDING, CLAIMED, and RETRY_WAIT reminders upon invoice settlement', async () => {
      mockTx.notificationOutbox.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.suppressPendingInvoiceRemindersTx(
        mockTx,
        tenantId,
        invoiceId,
        'INVOICE_PAID_SETTLEMENT',
      );

      expect(result.count).toBe(3);
      expect(result.reason).toBe('INVOICE_PAID_SETTLEMENT');
      expect(mockTx.notificationOutbox.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          invoiceId,
          jobType: OutboxJobType.REMINDER,
          status: {
            in: [
              OutboxJobStatus.PENDING,
              OutboxJobStatus.CLAIMED,
              OutboxJobStatus.RETRY_WAIT,
            ],
          },
        },
        data: expect.objectContaining({
          status: OutboxJobStatus.SUPPRESSED,
          lastError: 'SUPPRESSED: INVOICE_PAID_SETTLEMENT',
        }),
      });
    });

    it('cancelPendingJobByIdTx rejects cancelling a job that is currently in DISPATCHING', async () => {
      mockTx.notificationOutbox.findFirst.mockResolvedValue({
        id: 'job_dispatching',
        tenantId,
        status: OutboxJobStatus.DISPATCHING,
      });

      await expect(
        service.cancelPendingJobByIdTx(mockTx, tenantId, 'job_dispatching'),
      ).rejects.toThrow('Cannot cancel job job_dispatching: job is currently in DISPATCHING status');
    });

    it('cancelPendingJobByIdTx successfully cancels a PENDING job', async () => {
      mockTx.notificationOutbox.findFirst.mockResolvedValue({
        id: 'job_pending',
        tenantId,
        status: OutboxJobStatus.PENDING,
      });
      mockTx.notificationOutbox.update.mockResolvedValue({
        id: 'job_pending',
        tenantId,
        status: OutboxJobStatus.SUPPRESSED,
        lastError: 'CANCELLED: USER_REQUEST',
      });

      const res = await service.cancelPendingJobByIdTx(
        mockTx,
        tenantId,
        'job_pending',
        'USER_REQUEST',
      );

      expect(res.cancelled).toBe(true);
      expect(res.job.status).toBe(OutboxJobStatus.SUPPRESSED);
    });

    it('cancelPendingJobByIdTx leaves already-terminal jobs untouched', async () => {
      mockTx.notificationOutbox.findFirst.mockResolvedValue({
        id: 'job_terminal',
        tenantId,
        status: OutboxJobStatus.COMPLETED,
      });

      const res = await service.cancelPendingJobByIdTx(
        mockTx,
        tenantId,
        'job_terminal',
      );

      expect(res.cancelled).toBe(false);
      expect(res.message).toMatch(/already in terminal status COMPLETED/);
      expect(mockTx.notificationOutbox.update).not.toHaveBeenCalled();
    });
  });
});
