import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RemindersService } from './reminders.service.js';
import { ConsentState, NotificationChannel, NotifStatus, InvoiceStatus } from '@prisma/client';

describe('RemindersService — Phase 2B Calendar Logic & BOTH-Channel Consent', () => {
  let service: RemindersService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockNotifications: any;
  let mockIntegrations: any;
  let mockPrompts: any;

  const mockUser: any = {
    userId: 'user_admin_1',
    tenantId: 'tenant_test_1',
    email: 'admin@mycashflo.io',
    role: 'ADMIN',
  };

  const createCustomer = (overrides: any = {}) => ({
    id: 'cust_1',
    name: 'Acme Logistics',
    email: 'billing@acme.in',
    phone: '+919876543210',
    status: 'ACTIVE',
    emailConsent: ConsentState.OPTED_IN,
    whatsappConsent: ConsentState.OPTED_IN,
    smsConsent: ConsentState.UNKNOWN,
    voiceConsent: ConsentState.UNKNOWN,
    notes: null,
    ...overrides,
  });

  const createInvoice = (dueDate: Date | string, overrides: any = {}) => ({
    id: 'inv_1',
    number: 'INV-2026-001',
    amount: 50000,
    outstanding: 50000,
    dueDate: typeof dueDate === 'string' ? new Date(dueDate) : dueDate,
    status: InvoiceStatus.OPEN,
    tenantId: 'tenant_test_1',
    customer: createCustomer(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tenant_test_1', name: 'Test Tenant Ltd' }),
      },
      integrationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          provider: 'AUTOMATED_REMINDERS',
          tenantId: 'tenant_test_1',
          config: {
            enabled: true,
            dryRun: false, // Live mode for dispatch testing
            channelPreference: 'BOTH',
            timezone: 'Asia/Kolkata',
            quietHours: { startHour: 23, endHour: 1 },
            maxDailyPerCustomer: 5,
            minDaysBetweenReminders: 3,
            companyContactNumber: '+919876500000',
          },
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            provider: 'COMPANY_PROFILE',
            tenantId: 'tenant_test_1',
            config: { phone: '+919876500000' },
          },
        ]),
      },
      invoice: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),
      },
      notification: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    mockAuditLogs = { log: vi.fn().mockResolvedValue({}) };
    mockNotifications = {
      dispatch: vi.fn(),
      getTenantContactNumber: vi.fn().mockResolvedValue('+919876500000'),
    };
    mockIntegrations = {};
    mockPrompts = {};

    service = new RemindersService(
      mockPrisma as any,
      mockAuditLogs as any,
      mockNotifications as any,
      mockIntegrations as any,
      mockPrompts as any,
    );

    // Mock global flag
    process.env.AUTOMATED_REMINDERS_ENABLED = 'true';
  });

  describe('1. Premature DUE_SOON Bug Elimination', () => {
    it('skips invoices due in 30, 60, or 180 days and does NOT dispatch or mark them DUE_SOON', async () => {
      const now = new Date('2026-11-16T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const invDueIn30Days = createInvoice('2026-12-16T00:00:00.000Z', { id: 'inv_30' });
      const invDueIn60Days = createInvoice('2027-01-15T00:00:00.000Z', { id: 'inv_60' });
      const invDueIn180Days = createInvoice('2027-05-15T00:00:00.000Z', { id: 'inv_180' });
      const invDueIn4Days = createInvoice('2026-11-20T00:00:00.000Z', { id: 'inv_4' });

      mockPrisma.invoice.findMany.mockResolvedValue([
        invDueIn30Days,
        invDueIn60Days,
        invDueIn180Days,
        invDueIn4Days,
      ]);

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      // Evaluated invoices returned from DB = 4, but eligible = 0 and dispatched = 0
      expect(summary.evaluatedCount).toBe(4);
      expect(summary.eligibleCount).toBe(0);
      expect(summary.dispatchedCount).toBe(0);
      expect(summary.items.length).toBe(0);
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('evaluates invoices due in 1, 2, or 3 days as DUE_SOON', async () => {
      const now = new Date('2026-11-16T10:00:00.000Z'); // 15:30 IST on Nov 16
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // In Asia/Kolkata, today is 2026-11-16.
      // Due on 2026-11-18 is due in 2 days -> DUE_SOON
      const invDueSoon = createInvoice('2026-11-18T00:00:00.000Z', { id: 'inv_soon' });
      mockPrisma.invoice.findMany.mockResolvedValue([invDueSoon]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invDueSoon);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_1', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.items.length).toBe(1);
      expect(summary.items[0].stage).toBe('DUE_SOON');
      expect(summary.dispatchedCount).toBe(1);

      vi.useRealTimers();
    });

    it('evaluates invoices due on the tenant calendar day as DUE_TODAY', async () => {
      const now = new Date('2026-11-16T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const invDueToday = createInvoice('2026-11-16T00:00:00.000Z', { id: 'inv_today' });
      mockPrisma.invoice.findMany.mockResolvedValue([invDueToday]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invDueToday);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_today', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.items[0].stage).toBe('DUE_TODAY');

      vi.useRealTimers();
    });
  });

  describe('2. BOTH-Channel Consent & Independent Channel Dispatch', () => {
    it('dispatches to EMAIL and skips WHATSAPP when customer is opted in to EMAIL but opted out of WHATSAPP', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_OUT,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_email', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.dispatchedCount).toBe(1);
      expect(summary.failedCount).toBe(0);

      // Verify notifications.dispatch was called EXACTLY ONCE, strictly for EMAIL
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
        }),
      );
      // Ensure WhatsApp provider was NEVER invoked
      expect(mockNotifications.dispatch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          channel: NotificationChannel.WHATSAPP,
        }),
      );
    });

    it('dispatches to WHATSAPP and skips EMAIL when customer is opted out of EMAIL but opted in to WHATSAPP', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_OUT,
        whatsappConsent: ConsentState.OPTED_IN,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_wa', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.dispatchedCount).toBe(1);
      expect(summary.failedCount).toBe(0);

      // Verify notifications.dispatch was called EXACTLY ONCE, strictly for WHATSAPP
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          channel: NotificationChannel.WHATSAPP,
        }),
      );
      expect(mockNotifications.dispatch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
        }),
      );
    });

    it('dispatches to BOTH channels when customer is opted in to both EMAIL and WHATSAPP', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_both', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.dispatchedCount).toBe(1);

      // Dispatched to both Email and WhatsApp
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(2);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ channel: NotificationChannel.EMAIL }),
      );
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ channel: NotificationChannel.WHATSAPP }),
      );
    });

    it('suppresses reminder when customer is opted out of both channels', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_OUT,
        whatsappConsent: ConsentState.OPTED_OUT,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(0);
      expect(summary.dispatchedCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toContain('OPTED_OUT');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('suppresses reminder when customer consent is UNKNOWN for both channels', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.UNKNOWN,
        whatsappConsent: ConsentState.UNKNOWN,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(0);
      expect(summary.dispatchedCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toContain('CONSENT_UNKNOWN');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('respects legacy channel-specific DND: blocks WhatsApp while dispatching Email', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        notes: 'Customer requested [DND:WHATSAPP] due to spam complaints',
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);
      mockNotifications.dispatch.mockResolvedValue({ id: 'notif_em', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.dispatchedCount).toBe(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ channel: NotificationChannel.EMAIL }),
      );
    });

    it('blocks all channels when customer has ambiguous or global DND directive', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        notes: 'Cease contact immediately [DND:NO_CONTACT]',
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(0);
      expect(summary.dispatchedCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('DND_NO_CONTACT');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('allows permitted channel to succeed when one provider fails in BOTH mode', async () => {
      const pastDue = new Date(Date.now() - 5 * 86400000);
      const customer = createCustomer({
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
      });
      const invoice = createInvoice(pastDue, { customer, status: InvoiceStatus.OVERDUE });

      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);

      // Email dispatch fails with provider error, but WhatsApp dispatch succeeds
      mockNotifications.dispatch
        .mockRejectedValueOnce(new Error('Resend provider 500 error'))
        .mockResolvedValueOnce({ id: 'notif_wa_ok', status: NotifStatus.SENT });

      const summary = await service.evaluateTenantReminders('tenant_test_1');

      expect(summary.eligibleCount).toBe(1);
      expect(summary.dispatchedCount).toBe(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(2);
      expect(summary.items[0].suppressionReason).toContain('Partial dispatch: EMAIL: Resend provider 500 error');
    });
  });
});
