import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotificationChannel, NotifStatus, PaymentMethod, PaymentStatus, ConsentState } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  const mockUser: AuthUser = {
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'ADMIN',
  };

  const optedInCustomer = (overrides: any = {}) => ({
    id: 'cust_1',
    name: 'Raj Enterprises',
    phone: '+91 98765 43210',
    email: 'billing@rajent.in',
    notes: 'Standard enterprise client',
    emailConsent: ConsentState.OPTED_IN,
    whatsappConsent: ConsentState.OPTED_IN,
    smsConsent: ConsentState.OPTED_IN,
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cust_1',
          name: 'Raj Enterprises',
          phone: '+91 98765 43210',
          email: 'billing@rajent.in',
          notes: 'Standard enterprise client',
          emailConsent: ConsentState.OPTED_IN,
          whatsappConsent: ConsentState.OPTED_IN,
          smsConsent: ConsentState.OPTED_IN,
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tenant_1',
          name: 'Demo Corp Pvt Ltd',
        }),
      },
      notification: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      invoice: {
        findMany: vi.fn(),
        findFirst: vi.fn().mockImplementation(async (args?: any) => {
          if (args?.where?.id === 'inv_101') {
            return {
              id: 'inv_101',
              number: 'INV-2024-999',
              outstanding: 125000,
              dueDate: new Date('2024-11-30'),
              customerId: 'cust_1',
              tenantId: 'tenant_1',
            };
          }
          return null;
        }),
      },
      payment: {
        findFirst: vi.fn(),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    mockIntegrations = {
      email: {
        send: vi.fn().mockResolvedValue({
          success: true,
          messageId: 'msg_resend_mock_123',
          status: NotifStatus.DELIVERED,
          isSimulated: false,
          provider: 'RESEND',
        }),
        verifyWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhook: vi.fn().mockReturnValue([]),
      },
      whatsapp: {
        send: vi.fn().mockResolvedValue({
          messageId: 'wamid.mock.123',
          provider: 'WHATSAPP_CLOUD',
          status: 'SENT',
          isSimulated: false,
        }),
        verifyWebhookChallenge: vi.fn().mockImplementation((mode, token, challenge, configured) => (token === configured ? challenge : null)),
        verifyWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhook: vi.fn().mockReturnValue([]),
      },
      sms: {
        send: vi.fn().mockResolvedValue({
          messageId: 'sms_live_123',
          provider: 'SMS_GATEWAY',
          status: 'SENT',
          isSimulated: false,
        }),
        verifyWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhook: vi.fn().mockReturnValue([]),
      },
      getRawConfig: vi.fn().mockImplementation(async (tenantId: string, provider: string) => {
        if (provider === 'COMPANY_PROFILE') return { phone: '+919876500000' };
        return {};
      }),
    };

    service = new NotificationsService(
      mockPrisma as PrismaService,
      mockAuditLogs as AuditLogsService,
      mockIntegrations as any,
    );
  });

  describe('Template Catalog', () => {
    it('returns supported templates with channel definitions', () => {
      const templates = service.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(4);
      expect(templates.find((t) => t.id === 'PAYMENT_REMINDER_OVERDUE')).toBeDefined();
    });

    it('defines exact 6 variables in order for PAYMENT_REMINDER_OVERDUE', () => {
      const templates = service.getTemplates();
      const overdue = templates.find((t) => t.id === 'PAYMENT_REMINDER_OVERDUE');
      expect(overdue).toBeDefined();
      expect(overdue?.variables).toEqual([
        'customerName',
        'companyName',
        'invoiceNumber',
        'amount',
        'dueDate',
        'companyContactNumber',
      ]);
    });
  });

  describe('Multi-Channel Dispatch & Real Email Delivery', () => {
    it('dispatches an EMAIL notification via Resend adapter and persists providerMessageId', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer());
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant_1',
        name: 'Demo Corp Pvt Ltd',
      });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'notif_email_1',
          ...data,
        }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2024-001',
          amount: 85000,
          dueDate: '2024-08-15',
        },
      });

      expect(result.status).toBe(NotifStatus.DELIVERED);
      expect(mockIntegrations.email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'billing@rajent.in',
          subject: expect.stringContaining('INV-2024-001'),
          html: expect.stringContaining('Please remit via standard bank transfer'),
        }),
        expect.any(Object),
      );
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: NotificationChannel.EMAIL,
            template: 'PAYMENT_REMINDER_OVERDUE',
            tenantId: 'tenant_1',
            status: NotifStatus.DELIVERED,
            payload: expect.objectContaining({
              providerMessageId: 'msg_resend_mock_123',
              provider: 'RESEND',
            }),
          }),
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.dispatched' }),
      );
    });

    it('marks notification as FAILED if customer has invalid channel contact info', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_2',
        name: 'No Phone Corp',
        phone: '',
        email: 'test@corp.com',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'notif_fail',
          ...data,
        }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_2',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
      });

      expect(result.status).toBe(NotifStatus.FAILED);
      expect(result.failReason).toContain('invalid or missing phone');
    });

    it('marks email as FAILED if customer has invalid or missing email address', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_no_email',
        name: 'No Email Corp',
        phone: '+91 99999 88888',
        email: 'invalid-email-address',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'notif_fail_email',
          ...data,
        }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_no_email',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
      });

      expect(result.status).toBe(NotifStatus.FAILED);
      expect(result.failReason).toContain('invalid or missing email address');
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
    });
  });

  describe('Contact-Permission & Opt-Out Guard (DND:NO_CONTACT)', () => {
    it('throws BadRequestException and suppresses outreach if customer has DND:NO_CONTACT in notes', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_optout',
        name: 'Cease Contact Corp',
        email: 'optout@corp.in',
        phone: '+91 91234 56789',
        notes: 'Requested stop. [DND:NO_CONTACT: requested stop calling on 2026-10-15]',
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_optout',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency & Duplicate-Send Protection', () => {
    it('returns existing notification without re-sending when idempotencyKey matches', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Raj Enterprises',
        email: 'billing@rajent.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });

      const existingRecord = {
        id: 'notif_existing_idemp',
        tenantId: 'tenant_1',
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        status: NotifStatus.DELIVERED,
      };
      mockPrisma.notification.findFirst.mockResolvedValueOnce(existingRecord);

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          idempotencyKey: 'remind-inv-001-attempt-1',
        },
      });

      expect(result.id).toBe('notif_existing_idemp');
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('returns existing notification when an overdue reminder for same invoice was sent in last 24h', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Raj Enterprises',
        email: 'billing@rajent.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });

      // No match for idempotencyKey, but match for 24h duplicate invoice
      mockPrisma.notification.findFirst
        .mockResolvedValueOnce(null) // no idempotencyKey match
        .mockResolvedValueOnce({
          id: 'notif_duplicate_24h',
          tenantId: 'tenant_1',
          status: NotifStatus.SENT,
        });

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceId: 'inv_101',
          idempotencyKey: 'idemp-2',
        },
      });

      expect(result.id).toBe('notif_duplicate_24h');
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('Verified Invoice & Approved Payment Link Lookup', () => {
    it('reads verified invoice data and approved payment link without mutating payment records', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Raj Enterprises',
        email: 'billing@rajent.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_101',
        number: 'INV-2024-999',
        outstanding: 125000,
        dueDate: new Date('2024-11-30'),
        tenantId: 'tenant_1',
        customerId: 'cust_1',
      });

      mockPrisma.payment.findFirst.mockResolvedValue({
        id: 'pay_link_1',
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.PENDING,
        notes: 'https://rzp.io/i/approved_link_abc',
      });

      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_with_verified', ...data }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceId: 'inv_101',
        },
      });

      expect(result.payload.invoiceNumber).toBe('INV-2024-999');
      expect(result.payload.amount).toBe(125000);
      expect(result.payload.paymentLink).toBe('https://rzp.io/i/approved_link_abc');
      expect(mockIntegrations.email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('https://rzp.io/i/approved_link_abc'),
        }),
        expect.any(Object),
      );
    });

    it('throws NotFoundException if invoiceId belongs to a different tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Raj Enterprises',
        email: 'billing@rajent.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      mockPrisma.invoice.findFirst.mockResolvedValue(null); // not found in tenant

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_1',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_foreign_tenant',
          },
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Webhook Status Handling', () => {
    it('updates notification status to DELIVERED when email.delivered webhook received', async () => {
      mockIntegrations.email.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.email.parseWebhook.mockReturnValue([
        {
          event: 'email.delivered',
          messageId: 'msg_resend_999',
          recipient: 'test@resend.dev',
          status: 'DELIVERED',
          timestamp: new Date().toISOString(),
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif_webhook_1',
          tenantId: 'tenant_1',
          payload: { providerMessageId: 'msg_resend_999' },
          failReason: null,
        },
      ]);
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_webhook_1',
        status: NotifStatus.DELIVERED,
      });

      const res = await service.handleEmailWebhook({ type: 'email.delivered' }, 'valid_signature');

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_webhook_1' },
          data: expect.objectContaining({ status: NotifStatus.DELIVERED }),
        }),
      );
    });

    it('updates notification status to FAILED when email.bounced webhook received', async () => {
      mockIntegrations.email.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.email.parseWebhook.mockReturnValue([
        {
          event: 'email.bounced',
          messageId: 'msg_resend_bounce',
          recipient: 'bounced@resend.dev',
          status: 'FAILED',
          error: 'Email bounced: Mailbox unavailable',
          timestamp: new Date().toISOString(),
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif_webhook_2',
          tenantId: 'tenant_1',
          payload: { providerMessageId: 'msg_resend_bounce' },
          failReason: null,
        },
      ]);
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_webhook_2',
        status: NotifStatus.FAILED,
      });

      const res = await service.handleEmailWebhook({ type: 'email.bounced' }, 'valid_signature');

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_webhook_2' },
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            failReason: 'Email bounced: Mailbox unavailable',
          }),
        }),
      );
    });

    it('verifies Meta WhatsApp webhook challenge successfully', () => {
      const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN || 'mycashflo_whatsapp_verify_token';
      const challenge = service.verifyWhatsAppWebhook(
        'subscribe',
        configuredToken,
        'hub_challenge_sample_123',
      );
      expect(challenge).toBe('hub_challenge_sample_123');
    });

    it('rejects WhatsApp webhook challenge on token mismatch', () => {
      expect(() =>
        service.verifyWhatsAppWebhook(
          'subscribe',
          'wrong_token',
          'hub_challenge_sample_123',
        ),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when WhatsApp webhook signature is invalid', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        service.handleWhatsAppWebhook({ entry: [] }, 'sha256=invalid_hash'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates notification status to DELIVERED when WhatsApp delivered webhook is received', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_live_deliv_1==',
          status: 'DELIVERED',
          timestamp: new Date('2026-10-25T14:00:00Z'),
          recipientPhone: '919618954429',
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_1',
        tenantId: 'tenant_1',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_live_deliv_1==' },
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_wa_1',
        status: NotifStatus.DELIVERED,
      });

      const res = await service.handleWhatsAppWebhook(
        { entry: [] },
        'sha256=valid_hash',
      );

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_wa_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
            payload: expect.objectContaining({
              deliveryStatus: 'DELIVERED',
            }),
          }),
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'notification.status_updated',
          entityId: 'notif_wa_1',
        }),
      );
    });

    it('records READ status without downgrading when WhatsApp read webhook is received', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_live_read_1==',
          status: 'READ',
          timestamp: new Date('2026-10-25T14:05:00Z'),
          recipientPhone: '919618954429',
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_read_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_live_read_1==',
          deliveryStatus: 'DELIVERED',
        },
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_wa_read_1',
        status: NotifStatus.DELIVERED,
      });

      const res = await service.handleWhatsAppWebhook(
        { entry: [] },
        'sha256=valid_hash',
      );

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_wa_read_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
            payload: expect.objectContaining({
              deliveryStatus: 'READ',
              readAt: '2026-10-25T14:05:00.000Z',
            }),
          }),
        }),
      );
    });

    it('idempotently ignores duplicate WhatsApp delivered/read webhooks', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_idemp_1==',
          status: 'READ',
          timestamp: new Date('2026-10-25T14:05:00Z'),
        },
      ]);

      // Already marked as READ in payload
      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_idemp_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_idemp_1==',
          deliveryStatus: 'READ',
          readAt: '2026-10-25T14:05:00.000Z',
        },
      });

      mockPrisma.notification.update.mockClear();
      mockAuditLogs.log.mockClear();

      const res = await service.handleWhatsAppWebhook(
        { entry: [] },
        'sha256=valid_hash',
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(1);
      expect(res.updated).toBe(0);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).not.toHaveBeenCalled();
    });

    it('updates status to FAILED with sanitized error message when WhatsApp delivery fails', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_fail_1==',
          status: 'FAILED',
          timestamp: new Date('2026-10-25T14:02:00Z'),
          error: 'Bearer EAAG12345 secret token rejected due to inactive phone',
          errorCode: 131026,
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_fail_1',
        tenantId: 'tenant_1',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_fail_1==' },
      });

      const res = await service.handleWhatsAppWebhook(
        { entry: [] },
        'sha256=valid_hash',
      );

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_wa_fail_1' },
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            // Access token must be redacted
            failReason: expect.not.stringContaining('EAAG12345'),
          }),
        }),
      );
    });

    it('handles unknown message ID safely without throwing', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_unknown_msg_id==',
          status: 'DELIVERED',
          timestamp: new Date(),
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.update.mockClear();
      mockAuditLogs.log.mockClear();

      const res = await service.handleWhatsAppWebhook(
        { entry: [] },
        'sha256=valid_hash',
      );

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(1);
      expect(res.updated).toBe(0);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).not.toHaveBeenCalled();
    });

    it('idempotently ignores duplicate DELIVERED status replay when notification is already DELIVERED', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_dup_deliv_1==',
          status: 'DELIVERED',
          timestamp: new Date('2026-10-25T14:10:00Z'),
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_dup_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_dup_deliv_1==',
          deliveryStatus: 'DELIVERED',
          deliveredAt: '2026-10-25T14:10:00.000Z',
        },
      });

      mockPrisma.notification.update.mockClear();
      mockAuditLogs.log.mockClear();

      const res = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(1);
      expect(res.updated).toBe(0);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).not.toHaveBeenCalled();
    });

    it('prevents status regression if an out-of-order SENT event arrives after DELIVERED', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_ooo_sent_1==',
          status: 'SENT',
          timestamp: new Date('2026-10-25T14:00:00Z'),
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_ooo_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_ooo_sent_1==',
          deliveryStatus: 'DELIVERED',
        },
      });

      mockPrisma.notification.update.mockClear();

      const res = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(res.status).toBe('ok');
      expect(res.processed).toBe(1);
      expect(res.updated).toBe(0);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('does not downgrade DELIVERED notification to FAILED if a late FAILED webhook event arrives', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_late_fail_1==',
          status: 'FAILED',
          timestamp: new Date('2026-10-25T14:12:00Z'),
          error: 'Late delivery error report',
          errorCode: 131050,
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_late_fail_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_late_fail_1==',
          deliveryStatus: 'DELIVERED',
        },
      });

      mockPrisma.notification.update.mockClear();

      const res = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_wa_late_fail_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
            failReason: 'Late delivery error report',
          }),
        }),
      );
    });

    it('matches providerMessageId using fallback scan when findFirst with JSON path returns null', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_fallback_scan_1==',
          status: 'DELIVERED',
          timestamp: new Date('2026-10-25T14:15:00Z'),
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif_wa_fallback_1',
          tenantId: 'tenant_1',
          status: NotifStatus.SENT,
          payload: { providerMessageId: 'wamid.HBgL_fallback_scan_1==' },
        },
      ]);
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_wa_fallback_1',
        status: NotifStatus.DELIVERED,
      });

      const res = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_wa_fallback_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
          }),
        }),
      );
    });

    it('advances notification status sequentially from QUEUED -> SENT -> DELIVERED -> READ', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);

      // Step 1: Webhook SENT advances QUEUED -> SENT
      mockIntegrations.whatsapp.parseWebhook.mockReturnValueOnce([
        {
          messageId: 'wamid.HBgL_seq_1==',
          status: 'SENT',
          timestamp: new Date('2026-10-25T14:00:00Z'),
          recipientPhone: '919618954429',
        },
      ]);
      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'notif_seq_1',
        tenantId: 'tenant_1',
        status: NotifStatus.QUEUED,
        payload: { providerMessageId: 'wamid.HBgL_seq_1==' },
      });
      mockPrisma.notification.update.mockResolvedValueOnce({
        id: 'notif_seq_1',
        status: NotifStatus.SENT,
      });

      const resSent = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');
      expect(resSent.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'notif_seq_1' },
          data: expect.objectContaining({
            status: NotifStatus.SENT,
            payload: expect.objectContaining({ deliveryStatus: 'SENT' }),
          }),
        }),
      );

      // Step 2: Webhook DELIVERED advances SENT -> DELIVERED
      mockIntegrations.whatsapp.parseWebhook.mockReturnValueOnce([
        {
          messageId: 'wamid.HBgL_seq_1==',
          status: 'DELIVERED',
          timestamp: new Date('2026-10-25T14:02:00Z'),
          recipientPhone: '919618954429',
        },
      ]);
      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'notif_seq_1',
        tenantId: 'tenant_1',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_seq_1==', deliveryStatus: 'SENT' },
      });
      mockPrisma.notification.update.mockResolvedValueOnce({
        id: 'notif_seq_1',
        status: NotifStatus.DELIVERED,
      });

      const resDeliv = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');
      expect(resDeliv.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'notif_seq_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
            payload: expect.objectContaining({
              deliveryStatus: 'DELIVERED',
              deliveredAt: '2026-10-25T14:02:00.000Z',
            }),
          }),
        }),
      );

      // Step 3: Webhook READ advances DELIVERED -> READ (in payload, status remains DELIVERED)
      mockIntegrations.whatsapp.parseWebhook.mockReturnValueOnce([
        {
          messageId: 'wamid.HBgL_seq_1==',
          status: 'READ',
          timestamp: new Date('2026-10-25T14:05:00Z'),
          recipientPhone: '919618954429',
        },
      ]);
      mockPrisma.notification.findFirst.mockResolvedValueOnce({
        id: 'notif_seq_1',
        tenantId: 'tenant_1',
        status: NotifStatus.DELIVERED,
        payload: {
          providerMessageId: 'wamid.HBgL_seq_1==',
          deliveryStatus: 'DELIVERED',
          deliveredAt: '2026-10-25T14:02:00.000Z',
        },
      });
      mockPrisma.notification.update.mockResolvedValueOnce({
        id: 'notif_seq_1',
        status: NotifStatus.DELIVERED,
      });

      const resRead = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');
      expect(resRead.updated).toBe(1);
      expect(mockPrisma.notification.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'notif_seq_1' },
          data: expect.objectContaining({
            status: NotifStatus.DELIVERED,
            payload: expect.objectContaining({
              deliveryStatus: 'READ',
              readAt: '2026-10-25T14:05:00.000Z',
            }),
          }),
        }),
      );
    });

    it('preserves multi-tenant isolation so Tenant A webhook never modifies Tenant B records', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_tenant_A==',
          status: 'DELIVERED',
          timestamp: new Date('2026-10-25T14:20:00Z'),
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_tenant_A',
        tenantId: 'tenant_alpha',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_tenant_A==' },
      });
      mockPrisma.notification.update.mockResolvedValue({
        id: 'notif_tenant_A',
        status: NotifStatus.DELIVERED,
      });

      mockAuditLogs.log.mockClear();
      mockPrisma.notification.update.mockClear();

      const res = await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(res.status).toBe('ok');
      expect(res.updated).toBe(1);

      // Verify ONLY Tenant A's notification was updated
      expect(mockPrisma.notification.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_tenant_A' },
        }),
      );

      // Verify audit log is recorded strictly under Tenant Alpha
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_alpha',
          entityId: 'notif_tenant_A',
          action: 'notification.status_updated',
        }),
      );
    });

    it('guarantees webhook processing never initiates outbound WhatsApp messages or calls', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.send.mockClear();

      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_deliv_no_outbound==',
          status: 'DELIVERED',
          timestamp: new Date(),
        },
        {
          messageId: 'wamid.HBgL_failed_no_outbound==',
          status: 'FAILED',
          timestamp: new Date(),
          error: 'User unreachable',
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_wa_safe',
        tenantId: 'tenant_1',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_deliv_no_outbound==' },
      });

      await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
    });

    it('records failure details safely and stores providerErrorCode without exposing secrets', async () => {
      mockIntegrations.whatsapp.verifyWebhookSignature.mockReturnValue(true);
      mockIntegrations.whatsapp.parseWebhook.mockReturnValue([
        {
          messageId: 'wamid.HBgL_fail_err_code==',
          status: 'FAILED',
          timestamp: new Date('2026-10-25T14:30:00Z'),
          error: 'Invalid OAuth access token EAAGabcdef1234567890z for recipient',
          errorCode: 131031,
        },
      ]);

      mockPrisma.notification.findFirst.mockResolvedValue({
        id: 'notif_fail_err',
        tenantId: 'tenant_1',
        status: NotifStatus.SENT,
        payload: { providerMessageId: 'wamid.HBgL_fail_err_code==' },
      });

      await service.handleWhatsAppWebhook({ entry: [] }, 'sha256=valid_hash');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_fail_err' },
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            failReason: expect.not.stringContaining('EAAGabcdef1234567890z'),
            payload: expect.objectContaining({
              deliveryStatus: 'FAILED',
              providerErrorCode: 131031,
            }),
          }),
        }),
      );
    });
  });

  describe('Automated Overdue Reminders Engine', () => {
    it('evaluates overdue invoices and dispatches reminders matching ageing rules', async () => {
      const pastDate = new Date(Date.now() - 40 * 86400000); // 40 days overdue -> WhatsApp
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_101',
          number: 'INV-2024-101',
          customerId: 'cust_1',
          outstanding: 50000,
          dueDate: pastDate,
          customer: { id: 'cust_1', name: 'Raj Enterprises', phone: '+91 98765 43210', email: 'billing@raj.in', whatsappConsent: ConsentState.OPTED_IN },
        },
      ]);
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        name: 'Raj Enterprises',
        phone: '+91 98765 43210',
        email: 'billing@raj.in',
        whatsappConsent: ConsentState.OPTED_IN,
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_101',
        number: 'INV-2024-101',
        outstanding: 50000,
        dueDate: pastDate,
      });
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_auto', ...data }),
      );

      const res = await service.triggerAutomatedReminders(mockUser);
      expect(res.evaluatedInvoices).toBe(1);
      expect(res.dispatchedCount).toBe(1);
      expect(res.details[0].channel).toBe(NotificationChannel.WHATSAPP);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notifications.automated_trigger' }),
      );
    });

    it('skips invoices whose customers have DND:NO_CONTACT preference in notes', async () => {
      const pastDate = new Date(Date.now() - 10 * 86400000);
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_dnd',
          number: 'INV-2024-DND',
          customerId: 'cust_dnd',
          outstanding: 15000,
          dueDate: pastDate,
          customer: {
            id: 'cust_dnd',
            name: 'Opted Out Corp',
            phone: '+91 98765 43210',
            email: 'billing@dnd.in',
            notes: '[DND:NO_CONTACT: opted out]',
          },
        },
      ]);

      const res = await service.triggerAutomatedReminders(mockUser);
      expect(res.evaluatedInvoices).toBe(1);
      expect(res.dispatchedCount).toBe(0);
      expect(res.details[0].skipped).toBe(true);
      expect(res.details[0].reason).toContain('DND:NO_CONTACT');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('Tenant Contact Number Resolution & Overdue Safety Guards', () => {
    it('resolves contact number from COMPANY_PROFILE phone', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (tenantId === 'tenant_1' && provider === 'COMPANY_PROFILE') return { phone: '+919618954429' };
        return {};
      });
      const num = await service.getTenantContactNumber('tenant_1');
      expect(num).toBe('+919618954429');
    });

    it('falls back to WHATSAPP_CLOUD when COMPANY_PROFILE has no phone', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (provider === 'WHATSAPP_CLOUD') return { companyContactNumber: '+919876543210' };
        return {};
      });
      const num = await service.getTenantContactNumber('tenant_1');
      expect(num).toBe('+919876543210');
    });

    it('falls back to AUTOMATED_REMINDERS when other providers have no contact number', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (provider === 'AUTOMATED_REMINDERS') return { companyContactNumber: '+919123456789' };
        return {};
      });
      const num = await service.getTenantContactNumber('tenant_1');
      expect(num).toBe('+919123456789');
    });

    it('enforces multi-tenant isolation: Tenant B cannot access Tenant A contact number', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (tenantId === 'tenant_A' && provider === 'COMPANY_PROFILE') return { phone: '+919999911111' };
        if (tenantId === 'tenant_B') return {};
        return {};
      });

      const numA = await service.getTenantContactNumber('tenant_A');
      const numB = await service.getTenantContactNumber('tenant_B');

      expect(numA).toBe('+919999911111');
      expect(numB).toBeNull();
    });

    it('dispatches PAYMENT_REMINDER_OVERDUE on WHATSAPP with tenant contact number in payload and message', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (provider === 'COMPANY_PROFILE') return { phone: '+919618954429' };
        return {};
      });
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_wa_success', ...data }),
      );

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-999',
          amount: 45000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.SENT);
      expect(mockIntegrations.whatsapp.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: expect.objectContaining({
            companyContactNumber: '+919618954429',
          }),
        }),
        expect.anything(),
      );
    });

    it('fails safely without calling WhatsApp adapter when tenant contact number is missing', async () => {
      mockIntegrations.getRawConfig.mockResolvedValue({}); // No contact configured
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_wa_fail', ...data }),
      );

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-999',
          amount: 45000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect((notif.payload as any)?.failReason).toContain('missing');
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
    });

    it('fails safely when tenant contact number matches customer recipient phone', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async () => ({
        phone: '+919876543210', // Same as customer phone
      }));
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_wa_same', ...data }),
      );

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-999',
          amount: 45000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect((notif.payload as any)?.failReason).toContain('cannot match customer phone number');
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
    });

    it('allows non-WhatsApp channels and other templates to succeed without companyContactNumber', async () => {
      mockIntegrations.getRawConfig.mockResolvedValue({}); // No contact number configured
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_email_ok', ...data }),
      );

      // Email dispatch for overdue reminder does NOT require companyContactNumber
      const emailNotif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-999',
          amount: 45000,
          dueDate: '2026-10-15',
        },
      });
      expect(emailNotif.status).not.toBe(NotifStatus.FAILED);

      // WhatsApp dispatch for UPCOMING template does NOT require companyContactNumber
      const upcomingNotif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_UPCOMING',
        payload: {
          invoiceNumber: 'INV-2026-999',
          amount: 45000,
          dueDate: '2026-10-30',
        },
      });
      expect(upcomingNotif.status).not.toBe(NotifStatus.FAILED);
    });

    it('persists FAILED and failure reason when WhatsApp adapter dispatch fails (e.g. Meta API 4xx/5xx)', async () => {
      mockIntegrations.getRawConfig.mockImplementation(async (tenantId: string, provider: string) => {
        if (provider === 'COMPANY_PROFILE') return { phone: '+919618954429' };
        return {};
      });
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_wa_failed', ...data }),
      );

      mockIntegrations.whatsapp.send.mockResolvedValue({
        messageId: 'wamid.failed.12345',
        provider: 'WHATSAPP_CLOUD',
        status: 'FAILED',
        isSimulated: false,
        error: 'WhatsApp Cloud API returned 404 (code: 132001): Template name does not exist',
      });

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-FAIL',
          amount: 50000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect(notif.failReason).toContain('Template name does not exist');
      expect(notif.sentAt).toBeNull();
      expect((notif.payload as any)?.failReason).toContain('Template name does not exist');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            failReason: expect.stringContaining('Template name does not exist'),
            sentAt: null,
          }),
        }),
      );
    });

    it('persists FAILED and failure reason when Email delivery is disabled by safety policy', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_email_disabled', ...data }),
      );

      mockIntegrations.email.send.mockResolvedValue({
        messageId: 'msg_disabled_12345',
        provider: 'RESEND',
        status: 'FAILED',
        isSimulated: true,
        error: 'Email delivery is disabled by safety policy (EMAIL_DELIVERY_ENABLED is false)',
      });

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-EMAIL-OFF',
          amount: 25000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect(notif.failReason).toContain('disabled by safety policy');
      expect(notif.sentAt).toBeNull();
      expect((notif.payload as any)?.failReason).toContain('disabled by safety policy');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            failReason: expect.stringContaining('disabled by safety policy'),
            sentAt: null,
          }),
        }),
      );
    });

    it('persists FAILED and failure reason when SMS delivery is disabled', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_sms_disabled', ...data }),
      );

      mockIntegrations.sms.send.mockResolvedValue({
        messageId: 'sms_disabled_12345',
        provider: 'SMS_GATEWAY',
        status: 'FAILED',
        isSimulated: true,
        error: 'SMS delivery is disabled by safety policy (SMS_DELIVERY_ENABLED is false)',
      });

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-SMS-OFF',
          amount: 15000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect(notif.failReason).toContain('SMS delivery is disabled');
      expect(notif.sentAt).toBeNull();
      expect(mockIntegrations.sms.send).toHaveBeenCalled();
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotifStatus.FAILED,
            failReason: expect.stringContaining('SMS delivery is disabled'),
            sentAt: null,
          }),
        }),
      );
    });

    it('persists FAILED and failure reason when SMS provider credentials are missing', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_sms_no_creds', ...data }),
      );

      mockIntegrations.sms.send.mockResolvedValue({
        messageId: 'sms_no_creds_12345',
        provider: 'TWILIO',
        status: 'FAILED',
        isSimulated: false,
        error: 'SMS provider credentials are missing (accountSid and authToken required)',
      });

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-SMS-NOCREDS',
          amount: 15000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.FAILED);
      expect(notif.failReason).toContain('credentials are missing');
      expect(notif.sentAt).toBeNull();
    });

    it('persists SENT and valid sentAt timestamp when live SMS provider succeeds', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({
        id: 'cust_1',
        name: 'Sharma Logistics',
        phone: '+91 98765 43210',
        email: 'sharma@logistics.in',
      }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo Finance' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_sms_sent', ...data }),
      );

      mockIntegrations.sms.send.mockResolvedValue({
        messageId: 'sms_live_88888',
        provider: 'TWILIO',
        status: 'SENT',
        isSimulated: false,
      });

      const notif = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2026-SMS-SENT',
          amount: 15000,
          dueDate: '2026-10-15',
        },
      });

      expect(notif.status).toBe(NotifStatus.SENT);
      expect(notif.failReason).toBeNull();
      expect(notif.sentAt).toBeInstanceOf(Date);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotifStatus.SENT,
            sentAt: expect.any(Date),
            failReason: null,
          }),
        }),
      );
    });

    it('increments failedCount and does not increment dispatchedCount for non-delivery states in automated reminders', async () => {
      const overdueInvoice = {
        id: 'inv_overdue_1',
        number: 'INV-FAIL-COUNT',
        customerId: 'cust_1',
        outstanding: 25000,
        dueDate: new Date(Date.now() - 35 * 24 * 3600 * 1000), // 35 days overdue -> WHATSAPP
        customer: { name: 'Late Payer Inc', whatsappConsent: ConsentState.OPTED_IN },
      };
      mockPrisma.invoice.findMany.mockResolvedValue([overdueInvoice]);
      mockPrisma.invoice.findFirst.mockResolvedValue(overdueInvoice);
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        name: 'Late Payer Inc',
        phone: '+91 98765 43210',
        email: 'late@payer.in',
        whatsappConsent: ConsentState.OPTED_IN,
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'myCashflo' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_fail_count', ...data }),
      );

      // WhatsApp adapter fails
      mockIntegrations.whatsapp.send.mockResolvedValue({
        messageId: 'wamid.failed.count',
        provider: 'WHATSAPP_CLOUD',
        status: 'FAILED',
        isSimulated: false,
        error: 'Rate limit exceeded',
      });

      const results = await service.triggerAutomatedReminders(mockUser);

      expect(results.evaluatedInvoices).toBe(1);
      expect(results.failedCount).toBe(1);
      expect(results.dispatchedCount).toBe(0);
      expect(results.details[0].status).toBe(NotifStatus.FAILED);
    });
  });

  describe('Structured Customer Consent & SUPPRESSED Status (Phase 1C)', () => {
    it('blocks manual dispatch and throws BadRequestException when customer consent is UNKNOWN', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_unknown',
        name: 'Unknown Consent Corp',
        email: 'unknown@corp.in',
        phone: '+91 98765 43210',
        emailConsent: ConsentState.UNKNOWN,
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_unknown',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('blocks manual dispatch and throws BadRequestException when customer consent is OPTED_OUT', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_optout_wa',
        name: 'WhatsApp OptOut Corp',
        phone: '+91 98765 43210',
        email: 'wa@corp.in',
        whatsappConsent: ConsentState.OPTED_OUT,
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_optout_wa',
          channel: NotificationChannel.WHATSAPP,
          template: 'PAYMENT_REMINDER_OVERDUE',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
    });

    it('persists SUPPRESSED notification with sentAt null and suppressionReason when persistSuppressed is true', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_suppressed',
        name: 'Suppressed Corp',
        phone: '+91 98765 43210',
        smsConsent: ConsentState.OPTED_OUT,
      });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_suppressed_1', ...data }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_suppressed',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          persistSuppressed: true,
          invoiceNumber: 'INV-SUP-01',
        },
      });

      expect(result.status).toBe(NotifStatus.SUPPRESSED);
      expect(result.sentAt).toBeNull();
      expect((result.payload as any)?.suppressionReason).toContain('explicitly opted out of SMS');
      expect(mockIntegrations.sms.send).not.toHaveBeenCalled();
    });

    it('isolates channel consent: customer opted out of WhatsApp can still receive Email if opted in', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_multi',
        name: 'Multi Channel Corp',
        email: 'billing@multicorp.in',
        phone: '+91 98765 43210',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_OUT,
      });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_email_allowed', ...data }),
      );

      // Email dispatch succeeds
      const emailRes = await service.dispatch(mockUser, {
        customerId: 'cust_multi',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: { invoiceNumber: 'INV-EMAIL-01', amount: 30000, dueDate: '2026-10-01' },
      });
      expect(emailRes.status).toBe(NotifStatus.DELIVERED);

      // WhatsApp dispatch is blocked
      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_multi',
          channel: NotificationChannel.WHATSAPP,
          template: 'PAYMENT_REMINDER_OVERDUE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('automated reminders increment suppressedCount (not dispatchedCount or failedCount) when consent is UNKNOWN or OPTED_OUT', async () => {
      const pastDate = new Date(Date.now() - 40 * 86400000); // 40 days overdue -> WhatsApp
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_unknown_consent',
          number: 'INV-UNKNOWN-01',
          customerId: 'cust_unk',
          outstanding: 75000,
          dueDate: pastDate,
          customer: {
            id: 'cust_unk',
            name: 'Unknown Consent Customer',
            phone: '+91 98765 43210',
            email: 'unk@customer.in',
            whatsappConsent: ConsentState.UNKNOWN,
          },
        },
      ]);

      const res = await service.triggerAutomatedReminders(mockUser);
      expect(res.evaluatedInvoices).toBe(1);
      expect(res.dispatchedCount).toBe(0);
      expect(res.failedCount).toBe(0);
      expect(res.suppressedCount).toBe(1);
      expect(res.details[0].skipped).toBe(true);
      expect(res.details[0].status).toBe(NotifStatus.SUPPRESSED);
      expect(res.details[0].reason).toContain('consent state: UNKNOWN');
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
    });
  });

  describe('Tenant Isolation & Referential Integrity Remediation (SEC-TENANT-001)', () => {
    it('Scenario 1: Notification dispatch succeeds when customer and invoice belong to the tenant and each other', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_valid_01' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_valid_01',
        number: 'INV-VALID-01',
        outstanding: 50000,
        dueDate: new Date('2026-12-31'),
        customerId: 'cust_valid_01',
        tenantId: 'tenant_1',
      });
      mockPrisma.notification.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'notif_sec_01', ...data }),
      );

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_valid_01',
        channel: NotificationChannel.EMAIL,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceId: 'inv_valid_01',
          invoiceNumber: 'INV-VALID-01',
          amount: 50000,
        },
      });

      expect(result.id).toBe('notif_sec_01');
      expect(result.payload.invoiceNumber).toBe('INV-VALID-01');
      expect(result.payload.amount).toBe(50000);
      expect(mockIntegrations.email.send).toHaveBeenCalled();
    });

    it('Scenario 2: Notification dispatch fails when invoice belongs to another customer in the same tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_attacker' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_victim',
        number: 'INV-VICTIM-99',
        outstanding: 999999,
        dueDate: new Date('2026-12-31'),
        customerId: 'cust_victim',
        tenantId: 'tenant_1',
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_attacker',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_victim',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('Scenario 3: Notification dispatch fails when invoice belongs to another tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_valid_01' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      // Invoice findFirst returns null because tenantId query does not match foreign tenant invoice
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_valid_01',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_foreign_tenant',
          },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('Scenario 4: Notification dispatch fails when customer belongs to another tenant', async () => {
      // Customer findFirst returns null because customer does not exist in user.tenantId
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_foreign_tenant',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_valid_01',
          },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
    });

    it('Scenario 5: Notification dispatch fails when invoice number in payload contradicts the referenced invoice', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_valid_01' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_valid_01',
        number: 'INV-REAL-123',
        outstanding: 50000,
        dueDate: new Date('2026-12-31'),
        customerId: 'cust_valid_01',
        tenantId: 'tenant_1',
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_valid_01',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_valid_01',
            invoiceNumber: 'INV-CONTRADICTING-999',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('Scenario 5b: Notification dispatch fails when amount in payload contradicts referenced invoice outstanding balance', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_valid_01' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_valid_01',
        number: 'INV-REAL-123',
        outstanding: 50000,
        dueDate: new Date('2026-12-31'),
        customerId: 'cust_valid_01',
        tenantId: 'tenant_1',
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_valid_01',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_valid_01',
            amount: 999999, // Mismatch
          },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('Scenario 5c: Notification dispatch fails when payment link belongs to another customer', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(optedInCustomer({ id: 'cust_valid_01' }));
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp Pvt Ltd' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_valid_01',
        number: 'INV-REAL-123',
        outstanding: 50000,
        dueDate: new Date('2026-12-31'),
        customerId: 'cust_valid_01',
        tenantId: 'tenant_1',
      });
      mockPrisma.payment.findFirst.mockResolvedValue({
        id: 'pay_other',
        customerId: 'cust_other_victim',
        invoiceId: 'inv_other',
        notes: 'https://rzp.io/i/victim_link',
      });

      await expect(
        service.dispatch(mockUser, {
          customerId: 'cust_valid_01',
          channel: NotificationChannel.EMAIL,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: 'inv_valid_01',
            paymentLink: 'https://rzp.io/i/victim_link',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });
});
