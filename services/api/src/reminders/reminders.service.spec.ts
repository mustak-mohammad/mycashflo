import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindersService } from './reminders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PromptsService } from '../prompts/prompts.service.js';
import { InvoiceStatus, NotificationChannel, NotifStatus, ConsentState } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('RemindersService (Automated Overdue Detection & Chotu Reminders)', () => {
  let service: RemindersService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockNotifications: any;
  let mockIntegrations: any;
  let mockPrompts: any;

  const mockUser: AuthUser = {
    userId: 'user_admin_1',
    tenantId: 'tenant_test_1',
    role: 'ADMIN',
  };

  const defaultTenant = {
    id: 'tenant_test_1',
    name: 'Acme Test Corp',
  };

  beforeEach(() => {
    mockPrisma = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue(defaultTenant),
        findMany: vi.fn().mockResolvedValue([defaultTenant]),
      },
      integrationConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      invoice: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      notification: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    mockNotifications = {
      dispatch: vi.fn().mockResolvedValue({
        id: 'notif_dispatched_1',
        status: NotifStatus.SENT,
      }),
      getTenantContactNumber: vi.fn().mockResolvedValue('+919876543210'),
    };

    mockIntegrations = {};

    mockPrompts = {
      substituteVariables: vi.fn().mockImplementation((text, vars) => {
        let res = text;
        for (const [k, v] of Object.entries(vars)) {
          res = res.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return res;
      }),
    };

    service = new RemindersService(
      mockPrisma as PrismaService,
      mockAuditLogs as AuditLogsService,
      mockNotifications as NotificationsService,
      mockIntegrations as IntegrationsService,
      mockPrompts as PromptsService,
    );

    delete process.env.AUTOMATED_REMINDERS_ENABLED;
  });

  describe('1. Automatic Overdue Detection & Due-Date Boundaries', () => {
    it('accurately maps due dates to reminder stages', () => {
      expect(service.calculateStage(-2)).toBe('DUE_SOON');
      expect(service.calculateStage(0)).toBe('DUE_TODAY');
      expect(service.calculateStage(3)).toBe('OVERDUE_STAGE_1');
      expect(service.calculateStage(10)).toBe('OVERDUE_STAGE_2');
      expect(service.calculateStage(25)).toBe('OVERDUE_STAGE_3');
    });

    it('identifies genuinely outstanding invoices and excludes settled or zero-balance records', async () => {
      const now = new Date();
      const pastDue = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days overdue

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_overdue_1',
          number: 'INV-2026-001',
          amount: 50000,
          outstanding: 50000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_1',
            name: 'Beta Industries',
            email: 'billing@beta.in',
            phone: '+919876543210',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
            notes: null,
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_overdue_1',
        number: 'INV-2026-001',
        amount: 50000,
        outstanding: 50000,
        dueDate: pastDue,
        status: InvoiceStatus.OVERDUE,
      });

      const summary = await service.previewReminders(mockUser);

      expect(summary.evaluatedCount).toBe(1);
      expect(summary.eligibleCount).toBe(1);
      expect(summary.items[0].invoiceNumber).toBe('INV-2026-001');
      expect(summary.items[0].stage).toBe('OVERDUE_STAGE_1');
      expect(summary.items[0].isEligible).toBe(true);
      expect(summary.items[0].outstandingAmount).toBe(50000);
      expect(summary.items[0].messagePreview?.message).toContain('Beta Industries');
      expect(summary.items[0].messagePreview?.message).toContain('₹50,000');
    });
  });

  describe('2. Immediate Payment Status Re-Check (Partial and Full Payment)', () => {
    it('suppresses reminder if invoice was settled right before dispatch', async () => {
      const pastDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_settled_race',
          number: 'INV-2026-002',
          amount: 25000,
          outstanding: 25000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_2',
            name: 'Delta Corp',
            email: 'delta@corp.in',
            phone: '+919876543211',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      // Fresh lookup right before dispatch returns PAID / 0 balance
      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_settled_race',
        number: 'INV-2026-002',
        amount: 25000,
        outstanding: 0,
        status: InvoiceStatus.PAID,
      });

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('INVOICE_SETTLED');
    });

    it('re-evaluates with updated outstanding balance after partial payment', async () => {
      const pastDue = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_partial',
          number: 'INV-2026-003',
          amount: 100000,
          outstanding: 100000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_3',
            name: 'Gamma Ltd',
            email: 'finance@gamma.in',
            phone: '+919876543212',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      // Fresh lookup right before dispatch reflects partial payment of 60,000, leaving 40,000
      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_partial',
        number: 'INV-2026-003',
        amount: 100000,
        outstanding: 40000,
        status: InvoiceStatus.PARTIALLY_PAID,
        dueDate: pastDue,
      });

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(1);
      expect(summary.items[0].messagePreview?.message).toContain('₹40,000');
      expect(summary.items[0].messagePreview?.message).not.toContain('₹1,00,000');
    });
  });

  describe('3. Customer Consent, Opt-Outs & DND:NO_CONTACT', () => {
    it('suppresses reminders when customer has active DND:NO_CONTACT preference', async () => {
      const pastDue = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_dnd',
          number: 'INV-2026-004',
          amount: 15000,
          outstanding: 15000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_dnd',
            name: 'Epsilon Tech',
            email: 'eps@tech.in',
            phone: '+919876543213',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
            notes: 'Customer requested DND:NO_CONTACT on 2026-10-15',
          },
        },
      ]);

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('DND_NO_CONTACT');
    });

    it('suppresses reminders when customer status is INACTIVE', async () => {
      const pastDue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_inactive_cust',
          number: 'INV-2026-005',
          amount: 30000,
          outstanding: 30000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_inact',
            name: 'Zeta Corp',
            email: 'zeta@corp.in',
            phone: '+919876543214',
            status: 'INACTIVE',
          },
        },
      ]);

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(0);
      expect(summary.items[0].suppressionReason).toBe('CUSTOMER_INACTIVE');
    });
  });

  describe('4. Timezones and Quiet Hours Enforcement', () => {
    it('detects overnight quiet hours correctly in specified timezone', () => {
      const quietHours = { startHour: 19, endHour: 9 }; // 7 PM to 9 AM

      // Test 8:00 AM UTC (1:30 PM IST -> business hour)
      const daytimeIST = new Date('2026-10-22T08:00:00Z');
      expect(service.isQuietHours('Asia/Kolkata', quietHours, daytimeIST)).toBe(false);

      // Test 2:00 AM IST (8:30 PM previous day UTC -> quiet hour)
      const nighttimeIST = new Date('2026-10-21T20:30:00Z');
      expect(service.isQuietHours('Asia/Kolkata', quietHours, nighttimeIST)).toBe(true);
    });

    it('suppresses scheduled runs during quiet hours unless forced preview', async () => {
      const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: {
          enabled: true,
          dryRun: true,
          channelPreference: 'EMAIL',
          timezone: 'Asia/Kolkata',
          quietHours: { startHour: 0, endHour: 23 }, // Force quiet hour for entire day in test
        },
      });

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_qh',
          number: 'INV-2026-006',
          amount: 10000,
          outstanding: 10000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_qh',
            name: 'Nighttime Client',
            email: 'client@night.in',
            phone: '+919876543215',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_qh',
        number: 'INV-2026-006',
        amount: 10000,
        outstanding: 10000,
        status: InvoiceStatus.OVERDUE,
        dueDate: pastDue,
      });

      // Scheduled run without force
      const runSummary = await service.evaluateTenantReminders('tenant_test_1', { force: false });
      expect(runSummary.suppressedCount).toBe(1);
      expect(runSummary.items[0].suppressionReason).toBe('QUIET_HOURS');

      // Manual preview with force
      const previewSummary = await service.previewReminders(mockUser);
      expect(previewSummary.eligibleCount).toBe(1);
    });
  });

  describe('5. Duplicate Prevention, Idempotency & Frequency Limits', () => {
    it('suppresses reminder when matching idempotency key already exists for today', async () => {
      const pastDue = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_dup',
          number: 'INV-2026-007',
          amount: 8000,
          outstanding: 8000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_dup',
            name: 'Same Day Co',
            email: 'dup@co.in',
            phone: '+919876543216',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      // Simulate existing notification with same idempotency key
      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'notif_existing_today',
        status: NotifStatus.SENT,
      });

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('ALREADY_SENT_FOR_STAGE_TODAY');
    });

    it('enforces maximum daily reminders per customer limit', async () => {
      const pastDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_freq',
          number: 'INV-2026-008',
          amount: 12000,
          outstanding: 12000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_freq',
            name: 'Frequent Customer',
            email: 'freq@co.in',
            phone: '+919876543217',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      // Mock recent customer notifications in last 24h >= maxDailyPerCustomer (1)
      mockPrisma.notification.count.mockResolvedValueOnce(1);

      const summary = await service.previewReminders(mockUser);

      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('FREQUENCY_LIMIT_DAILY');
    });
  });

  describe('6. Safety Defaults & Administrator Activation Workflow', () => {
    it('defaults to dryRun: true and AUTOMATED_REMINDERS_ENABLED: false', async () => {
      const settings = await service.getSettings('tenant_test_1');
      expect(settings.enabled).toBe(false);
      expect(settings.dryRun).toBe(true);
      expect(settings.globalEnabled).toBe(false);
    });

    it('prevents real dispatch when dryRun is true, returning simulated preview status', async () => {
      const pastDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: {
          enabled: true,
          dryRun: true,
          channelPreference: 'EMAIL',
          timezone: 'Asia/Kolkata',
          quietHours: { startHour: 23, endHour: 1 },
        },
      });

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_dry',
          number: 'INV-2026-009',
          amount: 20000,
          outstanding: 20000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_dry',
            name: 'Dry Run Ltd',
            email: 'dry@run.in',
            phone: '+919876543218',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_dry',
        number: 'INV-2026-009',
        amount: 20000,
        outstanding: 20000,
        status: InvoiceStatus.OVERDUE,
        dueDate: pastDue,
      });

      const result = await service.triggerRun(mockUser, true);

      expect(result.isDryRun).toBe(true);
      expect(result.dispatchedCount).toBe(1);
      expect(result.items[0].dispatchStatus).toBe('SIMULATED');
      // Verify real dispatch was NOT called
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('executes real dispatch only when admin explicitly enables tenant and global flag is true', async () => {
      process.env.AUTOMATED_REMINDERS_ENABLED = 'true';

      const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: {
          enabled: true,
          dryRun: false, // Explicitly set to false by admin
          channelPreference: 'EMAIL',
          timezone: 'Asia/Kolkata',
          quietHours: { startHour: 23, endHour: 1 }, // Non-quiet window for test
        },
      });

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_live',
          number: 'INV-2026-010',
          amount: 35000,
          outstanding: 35000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_live',
            name: 'Live Company',
            email: 'live@company.in',
            phone: '+919876543219',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_live',
        number: 'INV-2026-010',
        amount: 35000,
        outstanding: 35000,
        status: InvoiceStatus.OVERDUE,
        dueDate: pastDue,
      });

      const result = await service.triggerRun(mockUser, false);

      expect(result.isDryRun).toBe(false);
      expect(result.dispatchedCount).toBe(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant_test_1' }),
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: expect.objectContaining({
            invoiceNumber: 'INV-2026-010',
            amount: 35000,
            isDryRun: false,
          }),
        }),
      );
    });
  });

  describe('7. Test Reminder Workflow (Restricted Test Recipient)', () => {
    it('dispatches test reminder exclusively to configured test recipient', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_test_wf',
        number: 'INV-2026-011',
        amount: 18000,
        outstanding: 18000,
        dueDate: new Date(),
        tenantId: 'tenant_test_1',
        customer: {
          id: 'cust_test_wf',
          name: 'Real Customer (Must NOT Receive)',
          email: 'real_customer@external.com',
          phone: '+919999999999',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
          },
      });

      const result = await service.sendTestReminder(mockUser, {
        invoiceId: 'inv_test_wf',
        channel: 'EMAIL',
        recipient: 'qa-engineer@internal.test',
      });

      expect(result.success).toBe(true);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          channel: NotificationChannel.EMAIL,
          payload: expect.objectContaining({
            isTest: true,
            testRecipient: 'qa-engineer@internal.test',
            customSubject: expect.stringContaining('[TEST REMINDER]'),
          }),
        }),
      );
    });

    it('strictly blocks test reminder overrides to unauthorized customer email addresses', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_test_wf',
        number: 'INV-2026-011',
        amount: 18000,
        outstanding: 18000,
        dueDate: new Date(),
        tenantId: 'tenant_test_1',
        customer: {
          id: 'cust_test_wf',
          name: 'Real Customer',
          email: 'real_customer@external.com',
          phone: '+919999999999',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
          },
      });

      await expect(
        service.sendTestReminder(mockUser, {
          invoiceId: 'inv_test_wf',
          channel: 'EMAIL',
          recipient: 'unauthorized_customer@client.com',
        }),
      ).rejects.toThrow('blocked');
    });

    it('strictly blocks test reminder overrides to unauthorized customer phone numbers', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_test_wf',
        number: 'INV-2026-011',
        amount: 18000,
        outstanding: 18000,
        dueDate: new Date(),
        tenantId: 'tenant_test_1',
        customer: {
          id: 'cust_test_wf',
          name: 'Real Customer',
          email: 'real_customer@external.com',
          phone: '+919999999999',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
          },
      });

      await expect(
        service.sendTestReminder(mockUser, {
          invoiceId: 'inv_test_wf',
          channel: 'WHATSAPP',
          recipient: '918888888888',
        }),
      ).rejects.toThrow('blocked');
    });

    it('accurately reports provider failure when provider dispatch fails', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_test_wf',
        number: 'INV-2026-011',
        amount: 18000,
        outstanding: 18000,
        dueDate: new Date(),
        tenantId: 'tenant_test_1',
        customer: {
          id: 'cust_test_wf',
          name: 'Real Customer',
          email: 'real_customer@external.com',
          phone: '+919999999999',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
          },
      });

      mockNotifications.dispatch.mockResolvedValueOnce({
        id: 'notif_failed_1',
        status: NotifStatus.FAILED,
        failReason: 'Provider rejected delivery (domain unverified)',
      });

      const result = await service.sendTestReminder(mockUser, {
        invoiceId: 'inv_test_wf',
        channel: 'EMAIL',
        recipient: 'qa-engineer@internal.test',
      });

      expect(result.success).toBe(false);
      expect(result.notification.status).toBe(NotifStatus.FAILED);
      expect(result.notification.failReason).toContain('Provider rejected delivery');
    });

    it('enforces tenant isolation preventing test reminders for other tenants invoices', async () => {
      // findFirst returns null because tenantId does not match
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.sendTestReminder(mockUser, {
          invoiceId: 'inv_other_tenant',
          channel: 'EMAIL',
        }),
      ).rejects.toThrow('Invoice not found in tenant');
    });
  });

  describe('8. Scan & Preview (Dry-Run Ledger Evaluation & Reporting)', () => {
    it('returns preview with eligible invoices, message previews, channel preferences and suppression reasons', async () => {
      const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

      mockPrisma.invoice.count
        .mockResolvedValueOnce(3) // totalTenantInvoices
        .mockResolvedValueOnce(1); // settledInvoicesCount

      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_preview_1',
          number: 'INV-2026-PREV-1',
          amount: 25000,
          outstanding: 25000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_prev_1',
            name: 'Apex Solutions',
            email: 'apex@solutions.in',
            phone: '+919876543220',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
        {
          id: 'inv_preview_2',
          number: 'INV-2026-PREV-2',
          amount: 15000,
          outstanding: 15000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_prev_2',
            name: 'Inactive Client',
            email: 'inactive@solutions.in',
            phone: '+919876543221',
            status: 'INACTIVE',
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === 'inv_preview_1') {
          return {
            id: 'inv_preview_1',
            number: 'INV-2026-PREV-1',
            amount: 25000,
            outstanding: 25000,
            status: InvoiceStatus.OVERDUE,
            dueDate: pastDue,
          };
        }
        return null;
      });

      const preview = await service.previewReminders(mockUser);

      expect(preview.isDryRun).toBe(true);
      expect(preview.evaluatedCount).toBe(2);
      expect(preview.eligibleCount).toBe(1);
      expect(preview.suppressedCount).toBe(1);
      expect(preview.totalTenantInvoices).toBe(3);
      expect(preview.settledInvoicesCount).toBe(1);

      // Verify eligible item has generated Chotu AI message preview
      const eligibleItem = preview.items.find((i) => i.invoiceId === 'inv_preview_1');
      expect(eligibleItem).toBeDefined();
      expect(eligibleItem?.isEligible).toBe(true);
      expect(eligibleItem?.messagePreview).toBeDefined();
      expect(eligibleItem?.messagePreview?.message).toContain('INV-2026-PREV-1');
      expect(eligibleItem?.messagePreview?.message).toContain('₹25,000');
      expect(eligibleItem?.dispatchStatus).toBe('SIMULATED');

      // Verify suppressed item has clear suppression reason
      const suppressedItem = preview.items.find((i) => i.invoiceId === 'inv_preview_2');
      expect(suppressedItem).toBeDefined();
      expect(suppressedItem?.isEligible).toBe(false);
      expect(suppressedItem?.suppressionReason).toBe('CUSTOMER_INACTIVE');

      // Verify no live messages were dispatched
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('reports meaningful summary when zero invoices are eligible because all are settled', async () => {
      mockPrisma.invoice.count
        .mockResolvedValueOnce(8) // totalTenantInvoices: 8
        .mockResolvedValueOnce(8); // settledInvoicesCount: 8
      mockPrisma.invoice.findMany.mockResolvedValue([]); // 0 outstanding

      const preview = await service.previewReminders(mockUser);

      expect(preview.evaluatedCount).toBe(0);
      expect(preview.eligibleCount).toBe(0);
      expect(preview.suppressedCount).toBe(0);
      expect(preview.items).toHaveLength(0);
      expect(preview.totalTenantInvoices).toBe(8);
      expect(preview.settledInvoicesCount).toBe(8);
      expect(preview.isDryRun).toBe(true);
    });

    it('safely handles concurrent duplicate runs on the same tenant using tenant active lock', async () => {
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.invoice.findMany.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
      );

      // Start first evaluation
      const firstRunPromise = service.previewReminders(mockUser);

      // Concurrently attempt second evaluation for same tenant
      const concurrentResult = await service.previewReminders(mockUser);
      expect(concurrentResult.evaluatedCount).toBe(0);
      expect(concurrentResult.eligibleCount).toBe(0);
      expect(concurrentResult.items).toHaveLength(0);

      await firstRunPromise;
    });

    it('unconditionally forces dryRun: true during triggerRun when AUTOMATED_REMINDERS_ENABLED is false, preventing bulk live dispatch', async () => {
      process.env.AUTOMATED_REMINDERS_ENABLED = 'false';

      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        config: {
          enabled: true,
          dryRun: false,
          quietHours: { start: '00:00', end: '00:00' },
        },
      });

      mockPrisma.invoice.count.mockResolvedValue(1);
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_live_attempt',
          number: 'INV-LIVE-999',
          amount: 50000,
          outstanding: 50000,
          dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days overdue
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_real_target',
            name: 'Real Customer Co',
            email: 'real_cust@external.com',
            phone: '+919999999999',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv_live_attempt',
        number: 'INV-LIVE-999',
        amount: 50000,
        outstanding: 50000,
        status: InvoiceStatus.OVERDUE,
        dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      // Attempt triggerRun with explicit dryRunOverride = false
      const result = await service.triggerRun(mockUser, false);

      // Must be forced to dryRun: true because AUTOMATED_REMINDERS_ENABLED is false
      expect(result.isDryRun).toBe(true);
      expect(result.dispatchedCount).toBe(1); // Simulated count
      expect(result.items[0].dispatchStatus).toBe('SIMULATED');
      // Verify mockNotifications.dispatch was NEVER called for bulk invoices
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('defaults sendTestReminder strictly to configured test recipient and never contacts the customer', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        config: {
          testRecipientEmail: 'qa-tester@safe.test',
        },
      });

      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_test_isolation',
        number: 'INV-ISOLATION-001',
        amount: 25000,
        outstanding: 25000,
        dueDate: new Date(),
        tenantId: 'tenant_test_1',
        customer: {
          id: 'cust_isolation',
          name: 'Real Client Inc',
          email: 'real_ceo@client.com',
          phone: '+919876543210',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
          },
      });

      // Send test reminder without providing a recipient override
      const result = await service.sendTestReminder(mockUser, {
        invoiceId: 'inv_test_isolation',
        channel: 'EMAIL',
      });

      expect(result.success).toBe(true);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          payload: expect.objectContaining({
            isTest: true,
            testRecipient: 'qa-tester@safe.test',
          }),
        }),
      );
      // Ensure customer's email was not used as the test recipient
      expect(mockNotifications.dispatch).not.toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({
          payload: expect.objectContaining({
            testRecipient: 'real_ceo@client.com',
          }),
        }),
      );
    });

    it('throws NotFoundException if tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValueOnce(null);

      await expect(service.previewReminders(mockUser)).rejects.toThrow('not found');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Tenant Contact Number & WhatsApp Overdue Safety
  // ─────────────────────────────────────────────────────────────────────────────
  describe('9. Tenant Contact Number & WhatsApp Overdue Safety', () => {
    it('manages companyContactNumber in reminder settings', async () => {
      const defaults = service.getDefaultSettings();
      expect(defaults.companyContactNumber).toBeUndefined();

      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        config: {
          enabled: true,
          companyContactNumber: '+919876543210',
        },
      });

      const settings = await service.getSettings('tenant_test_1');
      expect(settings.companyContactNumber).toBe('+919876543210');

      mockPrisma.integrationConfig.upsert.mockResolvedValueOnce({
        config: {
          enabled: true,
          companyContactNumber: '+919123456789',
        },
      });

      const updated = await service.updateSettings(mockUser.tenantId, {
        companyContactNumber: '+919123456789',
      }, mockUser.userId);
      expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_tenantId: {
              provider: 'AUTOMATED_REMINDERS',
              tenantId: 'tenant_test_1',
            },
          },
          create: expect.objectContaining({
            config: expect.objectContaining({ companyContactNumber: '+919123456789' }),
          }),
        }),
      );
    });

    it('includes companyContactNumber in WhatsApp overdue message generation', () => {
      const msg = service.generateChotuReminderMessage({
        stage: 'OVERDUE_STAGE_1',
        channel: 'WHATSAPP',
        customerName: 'Test Customer',
        invoiceNumber: 'INV-001',
        amount: 50000,
        dueDate: new Date('2026-10-01'),
        daysOverdue: 15,
        companyName: 'Acme Corp',
        companyContactNumber: '+919876543210',
      });

      expect(msg.message).toContain('+919876543210');
      expect(msg.template).toBe('PAYMENT_REMINDER_OVERDUE');
    });

    it('suppresses overdue WhatsApp reminder with MISSING_OR_INVALID_COMPANY_CONTACT_NUMBER when contact number is missing', async () => {
      mockNotifications.getTenantContactNumber.mockResolvedValueOnce(null);
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        config: {
          enabled: true,
          channelPreference: 'WHATSAPP',
          channels: ['WHATSAPP'],
        },
      });

      const pastDue = new Date(Date.now() - 15 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_overdue_1',
          number: 'INV-OD-001',
          customerId: 'cust_1',
          outstanding: 25000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          customer: {
            id: 'cust_1',
            name: 'Overdue Client',
            phone: '+919876543210',
            email: 'client@overdue.com',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      const result = await service.previewReminders(mockUser);
      expect(result.evaluatedCount).toBe(1);
      expect(result.eligibleCount).toBe(0);
      expect(result.suppressedCount).toBe(1);
      expect(result.items[0].isEligible).toBe(false);
      expect(result.items[0].suppressionReason).toBe('MISSING_OR_INVALID_COMPANY_CONTACT_NUMBER');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('suppresses overdue WhatsApp reminder when company contact number matches recipient customer phone', async () => {
      mockNotifications.getTenantContactNumber.mockResolvedValueOnce('+919876543210');
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        config: {
          enabled: true,
          channelPreference: 'WHATSAPP',
          channels: ['WHATSAPP'],
        },
      });

      const pastDue = new Date(Date.now() - 15 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_overdue_2',
          number: 'INV-OD-002',
          customerId: 'cust_1',
          outstanding: 25000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          customer: {
            id: 'cust_1',
            name: 'Overdue Client',
            phone: '+919876543210',
            email: 'client@overdue.com',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);

      const result = await service.previewReminders(mockUser);
      expect(result.evaluatedCount).toBe(1);
      expect(result.eligibleCount).toBe(0);
      expect(result.suppressedCount).toBe(1);
      expect(result.items[0].isEligible).toBe(false);
      expect(result.items[0].suppressionReason).toBe('MISSING_OR_INVALID_COMPANY_CONTACT_NUMBER');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('passes tenant contact number in dispatch payload when valid', async () => {
      process.env.AUTOMATED_REMINDERS_ENABLED = 'true';
      mockNotifications.getTenantContactNumber.mockResolvedValueOnce('+919618954429');
      mockPrisma.integrationConfig.findUnique.mockResolvedValueOnce({
        config: {
          enabled: true,
          dryRun: false,
          channels: ['WHATSAPP'],
          channelPreference: 'WHATSAPP',
          quietHours: { startHour: 23, endHour: 1 },
        },
      });

      const pastDue = new Date(Date.now() - 15 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_overdue_3',
          number: 'INV-OD-003',
          customerId: 'cust_3',
          outstanding: 25000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          customer: {
            id: 'cust_3',
            name: 'Overdue Client 3',
            phone: '+919876543210',
            email: 'client3@overdue.com',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            smsConsent: ConsentState.OPTED_IN,
          },
        },
      ]);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv_overdue_3',
        number: 'INV-OD-003',
        customerId: 'cust_3',
        outstanding: 25000,
        dueDate: pastDue,
        status: InvoiceStatus.OVERDUE,
      });

      const result = await service.evaluateTenantReminders(defaultTenant.id, { dryRunOverride: false });
      expect(result.dispatchedCount).toBe(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: expect.objectContaining({
            companyContactNumber: '+919618954429',
          }),
        }),
      );
    });
  });

  describe('Structured Customer Consent Enforcement (Phase 1C)', () => {
    it('suppresses automated reminder when customer consent is UNKNOWN', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: { enabled: true, dryRun: true, channelPreference: 'EMAIL', quietHours: { startHour: 23, endHour: 1 } },
      });
      const pastDue = new Date(Date.now() - 5 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_unk',
          number: 'INV-UNK-01',
          amount: 20000,
          outstanding: 20000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_unk',
            name: 'Consent Unknown Corp',
            email: 'billing@unk.in',
            phone: '+919876543210',
            status: 'ACTIVE',
            emailConsent: ConsentState.UNKNOWN,
          },
        },
      ]);

      const summary = await service.previewReminders(mockUser);
      expect(summary.evaluatedCount).toBe(1);
      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('CONSENT_UNKNOWN_EMAIL');
    });

    it('suppresses automated reminder when customer consent is OPTED_OUT for the channel', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: { enabled: true, dryRun: true, channelPreference: 'WHATSAPP', quietHours: { startHour: 23, endHour: 1 } },
      });
      const pastDue = new Date(Date.now() - 5 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_optout',
          number: 'INV-OUT-01',
          amount: 20000,
          outstanding: 20000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_out',
            name: 'Opted Out Client',
            email: 'billing@out.in',
            phone: '+919876543210',
            status: 'ACTIVE',
            whatsappConsent: ConsentState.OPTED_OUT,
          },
        },
      ]);

      const summary = await service.previewReminders(mockUser);
      expect(summary.evaluatedCount).toBe(1);
      expect(summary.eligibleCount).toBe(0);
      expect(summary.suppressedCount).toBe(1);
      expect(summary.items[0].suppressionReason).toBe('OPTED_OUT_WHATSAPP');
    });

    it('isolates channel consent: customer opted out of WhatsApp is eligible on Email if opted in', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'AUTOMATED_REMINDERS',
        tenantId: 'tenant_test_1',
        config: { enabled: true, dryRun: true, channelPreference: 'EMAIL', quietHours: { startHour: 23, endHour: 1 } },
      });
      const pastDue = new Date(Date.now() - 5 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        {
          id: 'inv_iso',
          number: 'INV-ISO-01',
          amount: 20000,
          outstanding: 20000,
          dueDate: pastDue,
          status: InvoiceStatus.OVERDUE,
          tenantId: 'tenant_test_1',
          customer: {
            id: 'cust_iso',
            name: 'Isolated Consent Corp',
            email: 'billing@iso.in',
            phone: '+919876543210',
            status: 'ACTIVE',
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_OUT,
          },
        },
      ]);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv_iso',
        number: 'INV-ISO-01',
        amount: 20000,
        outstanding: 20000,
        dueDate: pastDue,
        status: InvoiceStatus.OVERDUE,
      });

      const summary = await service.previewReminders(mockUser);
      expect(summary.evaluatedCount).toBe(1);
      expect(summary.eligibleCount).toBe(1);
      expect(summary.suppressedCount).toBe(0);
      expect(summary.items[0].isEligible).toBe(true);
    });
  });
});
