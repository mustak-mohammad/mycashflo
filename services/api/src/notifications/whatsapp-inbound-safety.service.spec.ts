import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentState } from '@prisma/client';
import {
  WhatsAppInboundSafetyService,
  phonesMatch,
  isOptOutMessage,
  isPaymentClaimMessage,
} from './whatsapp-inbound-safety.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { InboundMessageEvent } from '../integrations/interfaces/messaging-provider.interface.js';

describe('WhatsAppInboundSafetyService', () => {
  let service: WhatsAppInboundSafetyService;
  let mockPrisma: any;
  let mockAuditLogs: any;

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      invoice: {
        update: vi.fn(),
      },
      payment: {
        create: vi.fn(),
      },
      paymentPromise: {
        create: vi.fn(),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_1' }),
    };

    service = new WhatsAppInboundSafetyService(
      mockPrisma as unknown as PrismaService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Phone Normalization & Matching Utility Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Phone Matching & Normalization', () => {
    it('matches identical raw numbers', () => {
      expect(phonesMatch('919618954429', '919618954429')).toBe(true);
    });

    it('matches numbers across international formats, spaces, and country code prefixes', () => {
      expect(phonesMatch('+91 96189 54429', '919618954429')).toBe(true);
      expect(phonesMatch('+919618954429', '9618954429')).toBe(true);
      expect(phonesMatch('09618954429', '+919618954429')).toBe(true);
    });

    it('rejects mismatching numbers safely', () => {
      expect(phonesMatch('919618954429', '919618954420')).toBe(false);
      expect(phonesMatch('', '919618954429')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Keyword Classification Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Keyword Detection (Opt-Out & Payment Claim)', () => {
    it('detects standard opt-out keywords with boundary awareness', () => {
      expect(isOptOutMessage('STOP')).toBe(true);
      expect(isOptOutMessage('stop')).toBe(true);
      expect(isOptOutMessage('unsubscribe')).toBe(true);
      expect(isOptOutMessage('UNSUBSCRIBE')).toBe(true);
      expect(isOptOutMessage('dnd')).toBe(true);
      expect(isOptOutMessage('optout')).toBe(true);
      expect(isOptOutMessage('opt-out')).toBe(true);
      expect(isOptOutMessage('opt out')).toBe(true);
      expect(isOptOutMessage('Please add me to DND')).toBe(true);
      expect(isOptOutMessage('Please stop messaging me')).toBe(true);
      expect(isOptOutMessage('do not contact')).toBe(true);
    });

    it('does not falsely trigger opt-out on conversational words like "bus stop"', () => {
      expect(isOptOutMessage('I am currently waiting at the bus stop and will pay tonight')).toBe(false);
      expect(isOptOutMessage('We offer nonstop customer service')).toBe(false);
    });

    it('detects payment claim intent accurately', () => {
      expect(isPaymentClaimMessage('I have already paid this invoice')).toBe(true);
      expect(isPaymentClaimMessage('Payment made via GooglePay UPI ref 9876543210')).toBe(true);
      expect(isPaymentClaimMessage('transferred 5000 via NEFT today')).toBe(true);
      expect(isPaymentClaimMessage('UTR 1234567890')).toBe(true);
      expect(isPaymentClaimMessage('When is the invoice due?')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Tenant-Safe Sender Resolution
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Tenant-Safe Sender Resolution', () => {
    it('resolves an unambiguous 1:1 match for a single customer in a single tenant', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_101',
          name: 'Ramesh Sharma',
          phone: '+91 96189 54429',
          notes: 'Regular client',
          tenantId: 'tenant_alpha',
        },
      ]);

      const res = await service.resolveSender('919618954429');
      expect(res.resolution).toBe('RESOLVED');
      expect(res.tenantId).toBe('tenant_alpha');
      expect(res.customer?.id).toBe('cust_101');
      expect(res.customer?.name).toBe('Ramesh Sharma');
    });

    it('returns UNKNOWN_SENDER when phone does not match any active customer', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const res = await service.resolveSender('919999999999');
      expect(res.resolution).toBe('UNKNOWN_SENDER');
      expect(res.tenantId).toBeUndefined();
      expect(res.customer).toBeUndefined();
    });

    it('preserves multi-tenant isolation: flags AMBIGUOUS_TENANT and never guesses a tenant when phone matches across tenants', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_alpha',
          name: 'Client Alpha',
          phone: '+91 96189 54429',
          tenantId: 'tenant_A',
        },
        {
          id: 'cust_beta',
          name: 'Client Beta',
          phone: '+91 96189 54429',
          tenantId: 'tenant_B',
        },
      ]);

      const res = await service.resolveSender('919618954429');
      expect(res.resolution).toBe('AMBIGUOUS_TENANT');
      expect(res.tenantId).toBeUndefined();
      expect(res.customer).toBeUndefined();
      expect(res.candidateTenants).toEqual(expect.arrayContaining(['tenant_A', 'tenant_B']));
    });

    it('flags AMBIGUOUS_CUSTOMER when multiple records exist within the SAME tenant', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_1',
          name: 'Account 1',
          phone: '+91 96189 54429',
          tenantId: 'tenant_A',
        },
        {
          id: 'cust_2',
          name: 'Account 2',
          phone: '+91 96189 54429',
          tenantId: 'tenant_A',
        },
      ]);

      const res = await service.resolveSender('919618954429');
      expect(res.resolution).toBe('AMBIGUOUS_CUSTOMER');
      expect(res.tenantId).toBe('tenant_A');
      expect(res.customer).toBeUndefined();
      expect(res.candidateCustomerIds).toEqual(['cust_1', 'cust_2']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Opt-Out Protection Enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Opt-Out Protection', () => {
    it('registers DND on resolved customer notes and creates audit log', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_opt_1',
          name: 'Vikram Patel',
          phone: '+91 96189 54429',
          notes: 'Customer preferences: prefers morning calls',
          tenantId: 'tenant_1',
        },
      ]);
      mockPrisma.customer.update.mockResolvedValue({ id: 'cust_opt_1' });

      const event: InboundMessageEvent = {
        messageId: 'wamid.optout_1',
        senderPhone: '919618954429',
        type: 'text',
        text: 'STOP',
        timestamp: new Date('2026-10-26T14:00:00Z'),
      };

      const result = await service.processInboundMessage(event);

      expect(result.classification).toBe('OPT_OUT');
      expect(result.optOutEnforced).toBe(true);
      expect(result.resolution).toBe('RESOLVED');

      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust_opt_1' },
          data: expect.objectContaining({
            whatsappConsent: ConsentState.OPTED_OUT,
            whatsappConsentSource: 'INBOUND_WHATSAPP_STOP',
            notes: expect.stringContaining('[DND:NO_CONTACT - WhatsApp Opt-Out'),
          }),
        }),
      );
      const updateData = mockPrisma.customer.update.mock.calls[0][0].data;
      expect(updateData.emailConsent).toBeUndefined();
      expect(updateData.smsConsent).toBeUndefined();

      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_1',
          userId: 'SYSTEM',
          action: 'customer.dnd_registered',
          entityId: 'cust_opt_1',
        }),
      );
    });

    it('does not duplicate DND tag if customer already has DND in notes', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_opt_2',
          name: 'Vikram Patel',
          phone: '+91 96189 54429',
          notes: '[DND:NO_CONTACT - WhatsApp Opt-Out on 2026-10-25T10:00:00Z]',
          tenantId: 'tenant_1',
        },
      ]);

      const event: InboundMessageEvent = {
        messageId: 'wamid.optout_2',
        senderPhone: '919618954429',
        type: 'text',
        text: 'UNSUBSCRIBE',
        timestamp: new Date(),
      };

      const result = await service.processInboundMessage(event);

      expect(result.classification).toBe('OPT_OUT');
      expect(result.optOutEnforced).toBe(true);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('does NOT modify customer records when opt-out sender is unknown or ambiguous', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]); // Unknown sender

      const event: InboundMessageEvent = {
        messageId: 'wamid.optout_unknown_3',
        senderPhone: '919888877777',
        type: 'text',
        text: 'STOP',
        timestamp: new Date(),
      };

      const result = await service.processInboundMessage(event);

      expect(result.classification).toBe('OPT_OUT');
      expect(result.optOutEnforced).toBe(false);
      expect(result.resolution).toBe('UNKNOWN_SENDER');
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(result.summary).toContain('Customer records left untouched for operator review');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Financial Safety (Payment Claim Protection)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Financial Safety (Payment Claim Protection)', () => {
    it('classifies payment claim for review and NEVER alters invoices, payments or balances', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_pay_claim',
          name: 'Mehta Traders',
          phone: '+91 96189 54429',
          tenantId: 'tenant_finance_1',
        },
      ]);

      const event: InboundMessageEvent = {
        messageId: 'wamid.pay_claim_1',
        senderPhone: '919618954429',
        type: 'text',
        text: 'I have already paid ₹15,000 via UPI UTR 998877665544 today',
        timestamp: new Date(),
      };

      const result = await service.processInboundMessage(event);

      expect(result.classification).toBe('PAYMENT_CLAIM');
      expect(result.paymentClaimDetected).toBe(true);

      // Financial Safety Assertions:
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();

      // Verified: Audit log flagged for operator review
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_finance_1',
          action: 'inbound_message.payment_claim_flagged',
          metadata: expect.objectContaining({
            reviewStatus: 'PENDING_OPERATOR_VERIFICATION',
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Inbound Idempotency & Concurrency Protection
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Inbound Idempotency & Concurrency Lock', () => {
    it('suppresses exact duplicate message deliveries without repeating actions', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_idemp',
          name: 'Anil Gupta',
          phone: '+91 96189 54429',
          tenantId: 'tenant_1',
        },
      ]);

      const event: InboundMessageEvent = {
        messageId: 'wamid.dup_delivery_1',
        senderPhone: '919618954429',
        type: 'text',
        text: 'STOP',
        timestamp: new Date(),
      };

      const res1 = await service.processInboundMessage(event);
      expect(res1.isDuplicate).toBe(false);
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);

      // Duplicate delivery replay of same wamid
      const res2 = await service.processInboundMessage(event);
      expect(res2.isDuplicate).toBe(true);

      // Side-effects must NOT be executed twice
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);
    });

    it('suppresses duplicate delivery across process restarts via persistent database webhookReplay', async () => {
      const storedReplays = new Set<string>();
      mockPrisma.webhookReplay = {
        create: vi.fn().mockImplementation(async ({ data }) => {
          if (storedReplays.has(data.replayKey)) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          storedReplays.add(data.replayKey);
          return { id: 'rep_1', ...data };
        }),
        deleteMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where?.expiresAt?.lte) {
            // Active unexpired keys are NOT deleted
            return { count: 0 };
          }
          if (where?.replayKey) storedReplays.delete(where.replayKey);
          return { count: 1 };
        }),
      };

      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_restart',
          name: 'Restart Test Corp',
          phone: '+91 96189 54429',
          tenantId: 'tenant_1',
          whatsappConsent: 'UNKNOWN',
        },
      ]);
      mockPrisma.customer.findUnique = vi.fn().mockResolvedValue({
        id: 'cust_restart',
        name: 'Restart Test Corp',
        phone: '+91 96189 54429',
        tenantId: 'tenant_1',
        whatsappConsent: 'UNKNOWN',
      });
      mockPrisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockPrisma));

      const event: InboundMessageEvent = {
        messageId: 'wamid.persistent_restart_01',
        senderPhone: '919618954429',
        type: 'text',
        text: 'STOP',
        timestamp: new Date(),
      };

      // 1. Initial delivery succeeds and claims persistent key
      const res1 = await service.processInboundMessage(event);
      expect(res1.isDuplicate).toBe(false);
      expect(storedReplays.has('wa_in_wamid.persistent_restart_01')).toBe(true);
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);

      // 2. Simulate complete process restart (clearing in-memory cache)
      service.clearCache();

      // 3. Re-delivery arrives in new process
      const res2 = await service.processInboundMessage(event);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.summary).toContain('persistent replay guard');

      // Zero extra database update or audit log
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
    });

    it('ensures concurrent duplicate STOP events produce exactly one consent transition and one audit log', async () => {
      const storedReplays = new Set<string>();
      mockPrisma.webhookReplay = {
        create: vi.fn().mockImplementation(async ({ data }) => {
          if (storedReplays.has(data.replayKey)) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          storedReplays.add(data.replayKey);
          return { id: 'rep_1', ...data };
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      };

      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_concurrent_stop',
          name: 'Concurrent Corp',
          phone: '+91 96189 54429',
          tenantId: 'tenant_1',
          whatsappConsent: 'UNKNOWN',
        },
      ]);
      mockPrisma.customer.findUnique = vi.fn().mockResolvedValue({
        id: 'cust_concurrent_stop',
        name: 'Concurrent Corp',
        phone: '+91 96189 54429',
        tenantId: 'tenant_1',
        whatsappConsent: 'UNKNOWN',
      });
      mockPrisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockPrisma));

      const event1: InboundMessageEvent = {
        messageId: 'wamid.concurrent_stop_01',
        senderPhone: '919618954429',
        type: 'text',
        text: 'STOP',
        timestamp: new Date(),
      };
      const event2: InboundMessageEvent = { ...event1 };

      const [r1, r2] = await Promise.all([
        service.processInboundMessage(event1),
        service.processInboundMessage(event2),
      ]);

      const duplicates = [r1, r2].filter((r) => r.isDuplicate);
      const successes = [r1, r2].filter((r) => !r.isDuplicate);

      expect(successes).toHaveLength(1);
      expect(duplicates).toHaveLength(1);
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);
    });

    it('rolls back persistent replay claim on unexpected transaction failure so retries succeed', async () => {
      const storedReplays = new Set<string>();
      mockPrisma.webhookReplay = {
        create: vi.fn().mockImplementation(async ({ data }) => {
          storedReplays.add(data.replayKey);
          return { id: 'rep_1', ...data };
        }),
        deleteMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where?.expiresAt?.lte) {
            // Active unexpired keys are NOT deleted
            return { count: 0 };
          }
          if (where?.replayKey) storedReplays.delete(where.replayKey);
          return { count: 1 };
        }),
      };

      mockPrisma.customer.findMany.mockRejectedValueOnce(new Error('Database connection lost'));

      const event: InboundMessageEvent = {
        messageId: 'wamid.retry_after_fail',
        senderPhone: '919618954429',
        type: 'text',
        text: 'STOP',
        timestamp: new Date(),
      };

      await expect(service.processInboundMessage(event)).rejects.toThrow('Database connection lost');

      // Verified: Replay key was pruned so legitimate retry is not blocked
      expect(storedReplays.has('wa_in_wamid.retry_after_fail')).toBe(false);

      // Now recovery retry succeeds cleanly
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_recovered',
          name: 'Recovered Corp',
          phone: '+91 96189 54429',
          tenantId: 'tenant_1',
          whatsappConsent: 'UNKNOWN',
        },
      ]);
      mockPrisma.customer.findUnique = vi.fn().mockResolvedValue({
        id: 'cust_recovered',
        name: 'Recovered Corp',
        phone: '+91 96189 54429',
        tenantId: 'tenant_1',
        whatsappConsent: 'UNKNOWN',
      });
      mockPrisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockPrisma));

      const recoveryRes = await service.processInboundMessage(event);
      expect(recoveryRes.isDuplicate).toBe(false);
      expect(storedReplays.has('wa_in_wamid.retry_after_fail')).toBe(true);
      expect(mockPrisma.customer.update).toHaveBeenCalledTimes(1);
    });
  });
});
