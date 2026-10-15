import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotificationChannel, NotifStatus } from '@prisma/client';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockAuditLogs: any;

  const mockUser: AuthUser = {
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'ADMIN',
  };

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findFirst: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
      notification: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      invoice: {
        findMany: vi.fn(),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    service = new NotificationsService(
      mockPrisma as PrismaService,
      mockAuditLogs as AuditLogsService,
    );
  });

  describe('Template Catalog', () => {
    it('returns supported templates with channel definitions', () => {
      const templates = service.getTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(4);
      expect(templates.find((t) => t.id === 'PAYMENT_REMINDER_OVERDUE')).toBeDefined();
    });
  });

  describe('Multi-Channel Dispatch', () => {
    it('dispatches a WhatsApp notification and persists as DELIVERED', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        name: 'Raj Enterprises',
        phone: '+91 98765 43210',
        email: 'billing@rajent.in',
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant_1',
        name: 'Demo Corp Pvt Ltd',
      });
      mockPrisma.notification.create.mockImplementation(({ data }: any) => Promise.resolve({
        id: 'notif_1',
        ...data,
      }));

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_1',
        channel: NotificationChannel.WHATSAPP,
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          invoiceNumber: 'INV-2024-001',
          amount: 85000,
          dueDate: '2024-08-15',
        },
      });

      expect(result.status).toBe(NotifStatus.DELIVERED);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: NotificationChannel.WHATSAPP,
            template: 'PAYMENT_REMINDER_OVERDUE',
            tenantId: 'tenant_1',
            status: NotifStatus.DELIVERED,
          }),
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notification.dispatched' }),
      );
    });

    it('marks notification as FAILED if customer has invalid channel contact info', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_2',
        name: 'No Phone Corp',
        phone: '', // missing phone
        email: 'test@corp.com',
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) => Promise.resolve({
        id: 'notif_fail',
        ...data,
      }));

      const result = await service.dispatch(mockUser, {
        customerId: 'cust_2',
        channel: NotificationChannel.SMS,
        template: 'PAYMENT_REMINDER_OVERDUE',
      });

      expect(result.status).toBe(NotifStatus.FAILED);
      expect(result.failReason).toContain('invalid or missing phone');
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
          customer: { id: 'cust_1', name: 'Raj Enterprises', phone: '+91 98765 43210', email: 'billing@raj.in' },
        },
      ]);
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        name: 'Raj Enterprises',
        phone: '+91 98765 43210',
        email: 'billing@raj.in',
      });
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', name: 'Demo Corp' });
      mockPrisma.notification.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'notif_auto', ...data }));

      const res = await service.triggerAutomatedReminders(mockUser);
      expect(res.evaluatedInvoices).toBe(1);
      expect(res.dispatchedCount).toBe(1);
      expect(res.details[0].channel).toBe(NotificationChannel.WHATSAPP);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notifications.automated_trigger' }),
      );
    });
  });
});
