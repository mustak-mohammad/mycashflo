import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentStatus, InvoiceStatus, PaymentMethod } from '@prisma/client';

describe('PaymentsService - Webhook Idempotency & Reconciliation Regression Tests', () => {
  let service: PaymentsService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  // In-memory test state to simulate DB rows
  let testInvoice: any;
  let testCustomer: any;
  let testPayments: any[];
  let testAuditLogs: any[];

  beforeEach(() => {
    testCustomer = {
      id: 'cust_01',
      name: 'Sharma Industries',
      outstandingBalance: 10000,
      tenantId: 'tenant_01',
    };

    testInvoice = {
      id: 'inv_01',
      number: 'INV-TEST-1001',
      amount: 10000,
      outstanding: 10000,
      currency: 'INR',
      status: InvoiceStatus.OPEN,
      customerId: 'cust_01',
      tenantId: 'tenant_01',
      customer: testCustomer,
      tenant: { id: 'tenant_01' },
    };

    testPayments = [];
    testAuditLogs = [];

    // Transaction mock that executes the callback using mock tx object
    const createTx = () => ({
      $queryRaw: vi.fn().mockResolvedValue([{ id: testInvoice.id }]),
      invoice: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.number === testInvoice.number) {
            return { ...testInvoice, customer: { ...testCustomer }, tenant: { id: 'tenant_01' } };
          }
          return null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          if (where.id === testInvoice.id) {
            Object.assign(testInvoice, data);
            return { ...testInvoice };
          }
          return null;
        }),
      },
      customer: {
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          if (where.id === testCustomer.id) {
            Object.assign(testCustomer, data);
            return { ...testCustomer };
          }
          return null;
        }),
      },
      payment: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.OR) {
            for (const cond of where.OR) {
              const matched = testPayments.find((p) => {
                if (cond.providerRef && p.providerRef === cond.providerRef) return true;
                if (cond.ref && p.ref === cond.ref) return true;
                if (cond.notes?.contains && p.notes && p.notes.includes(cond.notes.contains)) return true;
                return false;
              });
              if (matched && (!where.status || matched.status === where.status)) {
                return matched;
              }
            }
          }
          if (where.providerRef && where.status) {
            return testPayments.find(
              (p) => p.providerRef === where.providerRef && p.status === where.status,
            ) || null;
          }
          return null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const p = testPayments.find((item) => item.id === where.id);
          if (p) {
            Object.assign(p, data);
            return { ...p };
          }
          return null;
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          for (const p of testPayments) {
            if (where.tenantId && p.tenantId !== where.tenantId) continue;
            Object.assign(p, data);
            count++;
          }
          return { count };
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          // Check uniqueness on ref
          if (testPayments.some((p) => p.ref === data.ref)) {
            const err: any = new Error(`Unique constraint failed on the fields: (ref)`);
            err.code = 'P2002';
            throw err;
          }
          const newPayment = {
            id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            ...data,
          };
          testPayments.push(newPayment);
          return newPayment;
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user_admin_01', role: 'ADMIN' }),
      },
    });

    mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = createTx();
        return await cb(tx);
      }),
      invoice: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === testInvoice.id && (where.tenantId === undefined || where.tenantId === testInvoice.tenantId)) {
            return { ...testInvoice, customer: { ...testCustomer } };
          }
          return null;
        }),
        findMany: vi.fn().mockImplementation(async () => [testInvoice]),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          if (where.id === testInvoice.id) {
            Object.assign(testInvoice, data);
            return { ...testInvoice };
          }
          return null;
        }),
      },
      customer: {
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          if (where.id === testCustomer.id) {
            Object.assign(testCustomer, data);
            return { ...testCustomer };
          }
          return null;
        }),
      },
      payment: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.ref) {
            const p = testPayments.find((item) => item.ref === where.ref);
            if (p) return { ...p, invoice: { ...testInvoice } };
          }
          return null;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newPayment = {
            id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            ...data,
          };
          testPayments.push(newPayment);
          return newPayment;
        }),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockImplementation(async (entry) => {
        testAuditLogs.push(entry);
        return entry;
      }),
    };

    mockIntegrations = {
      razorpay: {
        verifyWebhook: vi.fn(),
      },
      stripe: {
        verifyWebhook: vi.fn(),
      },
    };

    service = new PaymentsService(mockPrisma, mockAuditLogs, mockIntegrations);
  });

  // 1. First valid payment webhook
  it('1. should process the first valid payment webhook and reconcile balances', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_001',
      paymentLinkId: 'plink_001',
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    const result = await service.handleWebhook(
      'razorpay',
      { event: 'payment_link.paid' },
      { 'x-razorpay-signature': 'valid_sig' },
    );

    expect(result.processed).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
    expect(testInvoice.outstanding).toBe(0);
    expect(testInvoice.status).toBe(InvoiceStatus.PAID);
    expect(testCustomer.outstandingBalance).toBe(0);
    expect(testPayments.length).toBe(1);
    expect(testPayments[0].status).toBe(PaymentStatus.COMPLETED);
    expect(testPayments[0].providerRef).toBe('pay_rzp_001');
  });

  // 2. Exact duplicate webhook
  it('2. should idempotently handle an exact duplicate webhook without double deductions', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_002',
      paymentLinkId: 'plink_002',
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    // First call
    const firstResult = await service.handleWebhook(
      'razorpay',
      { event: 'payment_link.paid' },
      { 'x-razorpay-signature': 'valid_sig' },
    );
    expect(firstResult.idempotent).toBe(false);
    expect(testCustomer.outstandingBalance).toBe(0);

    // Duplicate call with exact same payload
    const duplicateResult = await service.handleWebhook(
      'razorpay',
      { event: 'payment_link.paid' },
      { 'x-razorpay-signature': 'valid_sig' },
    );

    expect(duplicateResult.processed).toBe(true);
    expect(duplicateResult.idempotent).toBe(true);
    expect(duplicateResult.paymentId).toBe(firstResult.paymentId);
    expect(testPayments.length).toBe(1); // No second payment record
    expect(testCustomer.outstandingBalance).toBe(0); // Balance NOT deducted twice
    expect(testInvoice.outstanding).toBe(0);
  });

  // 3. Duplicate webhook with the same provider payment ID
  it('3. should deduplicate by stable provider payment ID across different events', async () => {
    // First event: payment_link.paid
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_shared_tx_999',
      paymentLinkId: 'plink_shared_999',
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    await service.handleWebhook(
      'razorpay',
      { event: 'payment_link.paid' },
      { 'x-razorpay-signature': 'valid_sig' },
    );

    // Second event: payment.captured with same providerPaymentId but different event/format
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment.captured',
      providerPaymentId: 'pay_shared_tx_999',
      paymentLinkId: null,
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    const secondResult = await service.handleWebhook(
      'razorpay',
      { event: 'payment.captured' },
      { 'x-razorpay-signature': 'valid_sig' },
    );

    expect(secondResult.idempotent).toBe(true);
    expect(testPayments.length).toBe(1);
    expect(testCustomer.outstandingBalance).toBe(0);
  });

  // 4. Concurrent duplicate delivery
  it('4. should handle concurrent duplicate webhook deliveries safely without duplicate inserts', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_concurrent_123',
      paymentLinkId: 'plink_concurrent_123',
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    // Simulate two concurrent webhook requests arriving simultaneously
    const [res1, res2] = await Promise.all([
      service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' }),
      service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' }),
    ]);

    // One succeeds with idempotent: false, the other completes as idempotent: true or both succeed cleanly
    const idempotentFlags = [res1.idempotent, res2.idempotent];
    expect(idempotentFlags).toContain(false);
    expect(idempotentFlags).toContain(true);
    expect(testPayments.length).toBe(1);
    expect(testCustomer.outstandingBalance).toBe(0);
  });

  // 5. Invalid signature
  it('5. should reject webhook with invalid signature before making any financial modifications', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: false,
    });

    await expect(
      service.handleWebhook(
        'razorpay',
        { event: 'payment_link.paid' },
        { 'x-razorpay-signature': 'forged_signature' },
      ),
    ).rejects.toThrow(BadRequestException);

    // Balances and payments must remain completely untouched
    expect(testInvoice.outstanding).toBe(10000);
    expect(testCustomer.outstandingBalance).toBe(10000);
    expect(testPayments.length).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // 6. Two distinct legitimate payments
  it('6. should successfully process two distinct legitimate payments on the same invoice', async () => {
    // First payment: 4,000 INR
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_part_1',
      paymentLinkId: 'plink_part_1',
      invoiceNumber: 'INV-TEST-1001',
      amount: 4000,
    });

    const res1 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res1.idempotent).toBe(false);
    expect(res1.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(testInvoice.outstanding).toBe(6000);
    expect(testCustomer.outstandingBalance).toBe(6000);

    // Second legitimate distinct payment: 6,000 INR
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_part_2',
      paymentLinkId: 'plink_part_2',
      invoiceNumber: 'INV-TEST-1001',
      amount: 6000,
    });

    const res2 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res2.idempotent).toBe(false);
    expect(res2.invoiceStatus).toBe(InvoiceStatus.PAID);
    expect(testInvoice.outstanding).toBe(0);
    expect(testCustomer.outstandingBalance).toBe(0);
    expect(testPayments.length).toBe(2);
    expect(testPayments[0].providerRef).toBe('pay_part_1');
    expect(testPayments[1].providerRef).toBe('pay_part_2');
  });

  // 6b. Multiple distinct legitimate partial payments sharing the SAME payment link ID
  it('6b. should process multiple distinct legitimate partial payments on the SAME payment link without dropping the second as duplicate', async () => {
    const sharedLinkId = 'plink_shared_partial_001';

    // First partial payment: 3,000 INR on shared link
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_part_alpha',
      paymentLinkId: sharedLinkId,
      invoiceNumber: 'INV-TEST-1001',
      amount: 3000,
    });

    const res1 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res1.idempotent).toBe(false);
    expect(res1.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(testInvoice.outstanding).toBe(7000);
    expect(testCustomer.outstandingBalance).toBe(7000);
    expect(testPayments.length).toBe(1);

    // Second partial payment: 4,000 INR on the SAME shared link but distinct providerPaymentId
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_part_beta',
      paymentLinkId: sharedLinkId,
      invoiceNumber: 'INV-TEST-1001',
      amount: 4000,
    });

    const res2 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res2.idempotent).toBe(false);
    expect(res2.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(testInvoice.outstanding).toBe(3000);
    expect(testCustomer.outstandingBalance).toBe(3000);
    expect(testPayments.length).toBe(2);
    expect(testPayments[0].providerRef).toBe('pay_rzp_part_alpha');
    expect(testPayments[1].providerRef).toBe('pay_rzp_part_beta');

    // Replay of second partial payment should be caught as idempotent replay
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValueOnce({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_part_beta',
      paymentLinkId: sharedLinkId,
      invoiceNumber: 'INV-TEST-1001',
      amount: 4000,
    });

    const replayRes = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(replayRes.idempotent).toBe(true);
    expect(testPayments.length).toBe(2); // no third payment created
    expect(testInvoice.outstanding).toBe(3000); // no extra deduction
    expect(testCustomer.outstandingBalance).toBe(3000);
  });

  // 6c. Upgrading existing PENDING payment to COMPLETED and ensuring replay safety
  it('6c. should upgrade existing PENDING payment to COMPLETED and handle subsequent webhook replays idempotently', async () => {
    // Simulate pre-existing PENDING payment record created when link was generated
    testPayments.push({
      id: 'pay_pending_existing_01',
      ref: 'PLINK-INIT-001',
      tenantId: 'tenant_01',
      customerId: 'cust_01',
      invoiceId: 'inv_01',
      amount: 10000,
      currency: 'INR',
      method: PaymentMethod.PAYMENT_LINK,
      status: PaymentStatus.PENDING,
      providerRef: 'plink_pending_flow_01',
      notes: 'https://rzp.io/i/test',
    });

    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_rzp_flow_success_01',
      paymentLinkId: 'plink_pending_flow_01',
      invoiceNumber: 'INV-TEST-1001',
      amount: 10000,
    });

    // First webhook call: upgrades the PENDING payment
    const res1 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res1.idempotent).toBe(false);
    expect(res1.paymentId).toBe('pay_pending_existing_01');
    expect(testPayments.length).toBe(1);
    expect(testPayments[0].status).toBe(PaymentStatus.COMPLETED);
    expect(testPayments[0].ref).toBe('PAY-WH-pay_rzp_flow_success_01');
    expect(testInvoice.outstanding).toBe(0);
    expect(testInvoice.status).toBe(InvoiceStatus.PAID);

    // Second webhook call (replay): must be recognized as idempotent replay
    const res2 = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'sig' });
    expect(res2.idempotent).toBe(true);
    expect(res2.paymentId).toBe('pay_pending_existing_01');
    expect(testPayments.length).toBe(1);
    expect(testInvoice.outstanding).toBe(0);
    expect(testCustomer.outstandingBalance).toBe(0);
  });

  // 7. Partial payment
  it('7. should correctly record partial payments and update status to PARTIALLY_PAID', async () => {
    mockIntegrations.stripe.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'checkout.session.completed',
      providerPaymentId: 'pi_stripe_partial_555',
      paymentLinkId: 'cs_stripe_555',
      invoiceNumber: 'INV-TEST-1001',
      amount: 3500,
    });

    const res = await service.handleWebhook('stripe', {}, { 'stripe-signature': 'valid_sig' });

    expect(res.processed).toBe(true);
    expect(res.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(res.paidAmount).toBe(3500);
    expect(testInvoice.outstanding).toBe(6500);
    expect(testCustomer.outstandingBalance).toBe(6500);
  });

  // 8. Database failure during reconciliation
  it('8. should roll back and not persist partial modifications if database fails during reconciliation', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.paid',
      providerPaymentId: 'pay_fail_tx',
      invoiceNumber: 'INV-TEST-1001',
      amount: 5000,
    });

    // Mock Prisma transaction to fail during customer update
    mockPrisma.$transaction.mockImplementationOnce(async () => {
      // simulate partial failure
      throw new Error('Database connection reset during commit');
    });

    await expect(
      service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'valid_sig' }),
    ).rejects.toThrow('Database connection reset during commit');

    // In a rollback, state remains unmutated
    expect(testInvoice.outstanding).toBe(10000);
    expect(testCustomer.outstandingBalance).toBe(10000);
    expect(testPayments.length).toBe(0);
  });

  it('8b. should safely handle failed webhook event without altering invoice or customer balances', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment.failed',
      status: 'FAILED',
      providerPaymentId: 'pay_failed_101',
      invoiceNumber: 'INV-TEST-1001',
      amount: 5000,
      reason: 'insufficient_funds',
    });

    const res = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'valid_sig' });

    expect(res).toEqual({
      received: true,
      processed: true,
      status: 'FAILED',
      invoiceNumber: 'INV-TEST-1001',
      message: 'Payment failure recorded; invoice balance remains unchanged.',
    });
    expect(testInvoice.outstanding).toBe(10000);
    expect(testCustomer.outstandingBalance).toBe(10000);
    expect(testPayments.length).toBe(1);
    expect(testPayments[0].status).toBe(PaymentStatus.FAILED);
    expect(testAuditLogs.some((l) => l.action === 'payment.failed_via_webhook')).toBe(true);
  });

  it('8c. should safely handle cancelled and expired webhook events without altering invoice or customer balances', async () => {
    mockIntegrations.razorpay.verifyWebhook.mockResolvedValue({
      isValid: true,
      event: 'payment_link.cancelled',
      status: 'CANCELLED',
      paymentLinkId: 'plink_cancelled_102',
      invoiceNumber: 'INV-TEST-1001',
      amount: 5000,
    });

    const res = await service.handleWebhook('razorpay', {}, { 'x-razorpay-signature': 'valid_sig' });

    expect(res).toEqual({
      received: true,
      processed: true,
      status: 'CANCELLED',
      invoiceNumber: 'INV-TEST-1001',
      message: 'Payment link cancelled recorded; invoice balance remains unchanged.',
    });
    expect(testInvoice.outstanding).toBe(10000);
    expect(testCustomer.outstandingBalance).toBe(10000);
    expect(testPayments.length).toBe(0);
    expect(testAuditLogs.some((l) => l.action === 'payment.link_cancelled')).toBe(true);
  });

  describe('Manual Settlement Payment Recording', () => {
    const mockUser: any = { userId: 'usr_admin', tenantId: 'tenant_01', role: 'ADMIN' };

    it('9. should manually record a payment, update invoice outstanding balance, and audit log', async () => {
      const res = await service.recordPayment(mockUser, {
        invoiceId: 'inv_01',
        amount: 4000,
        paymentDate: '2026-10-18',
        reference: 'PAY-MANUAL-001',
        method: PaymentMethod.BANK_TRANSFER,
        notes: 'Direct RTGS settlement',
      });

      expect(res.success).toBe(true);
      expect(res.remainingOutstanding).toBe(6000);
      expect(res.newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(testInvoice.outstanding).toBe(6000);
      expect(testPayments.length).toBe(1);
      expect(testPayments[0].ref).toBe('PAY-MANUAL-001');
      expect(testAuditLogs.some((l) => l.action === 'payment.manually_recorded')).toBe(true);
    });

    it('10. should reject manual payment when amount exceeds remaining outstanding balance', async () => {
      await expect(
        service.recordPayment(mockUser, {
          invoiceId: 'inv_01',
          amount: 50000, // invoice outstanding is 10000
          paymentDate: '2026-10-18',
          reference: 'PAY-EXCEED-001',
        }),
      ).rejects.toThrow('cannot exceed remaining invoice outstanding balance');
    });

    it('11. should pass rawBody buffer to payment adapter verifyWebhook and reject if signature is invalid', async () => {
      mockIntegrations.stripe.verifyWebhook.mockResolvedValueOnce({
        isValid: false,
        event: 'unknown',
      });

      const rawBuffer = Buffer.from('{"type":"checkout.session.completed"}', 'utf8');
      await expect(
        service.handleWebhook(
          'stripe',
          JSON.parse(rawBuffer.toString('utf8')),
          { 'stripe-signature': 'invalid_sig' },
          rawBuffer,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.stripe.verifyWebhook).toHaveBeenCalledWith(
        expect.any(Object),
        'invalid_sig',
        undefined,
        rawBuffer,
      );
    });
  });
});
