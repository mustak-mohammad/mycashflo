import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import type { RemindersRunSummary } from './reminders.types.js';

describe('RemindersController', () => {
  let controller: RemindersController;
  let mockRemindersService: any;

  const mockUser: AuthUser = {
    userId: 'usr_admin_demo',
    tenantId: 'tenant_demo_1',
    role: 'ADMIN',
  };

  beforeEach(() => {
    mockRemindersService = {
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      previewReminders: vi.fn(),
      triggerRun: vi.fn(),
      sendTestReminder: vi.fn(),
      getStats: vi.fn(),
      getHistory: vi.fn(),
    };

    controller = new RemindersController(mockRemindersService as unknown as RemindersService);
  });

  describe('previewReminders (GET /api/reminders/preview)', () => {
    it('returns successful preview with evaluated invoices, eligibility and channels', async () => {
      const mockSummary: RemindersRunSummary = {
        tenantId: 'tenant_demo_1',
        evaluatedCount: 2,
        eligibleCount: 1,
        dispatchedCount: 0,
        suppressedCount: 1,
        failedCount: 0,
        isDryRun: true,
        globalEnabled: false,
        timestamp: new Date().toISOString(),
        totalTenantInvoices: 5,
        settledInvoicesCount: 3,
        items: [
          {
            invoiceId: 'inv_1',
            invoiceNumber: 'INV-2026-001',
            customerId: 'cust_1',
            customerName: 'Acme Corp',
            customerEmail: 'acme@test.in',
            customerPhone: '+919876543210',
            outstandingAmount: 15000,
            dueDate: new Date().toISOString(),
            daysOverdue: 5,
            stage: 'OVERDUE_STAGE_1',
            channel: 'EMAIL',
            idempotencyKey: 'rem_1',
            isEligible: true,
            dispatchStatus: 'SIMULATED',
            messagePreview: {
              subject: 'Notice from Demo Corp',
              message: 'Courtesy reminder for invoice INV-2026-001',
              template: 'PAYMENT_REMINDER_OVERDUE',
            },
          },
          {
            invoiceId: 'inv_2',
            invoiceNumber: 'INV-2026-002',
            customerId: 'cust_2',
            customerName: 'Inactive Client',
            customerEmail: 'inactive@test.in',
            customerPhone: '+919876543211',
            outstandingAmount: 20000,
            dueDate: new Date().toISOString(),
            daysOverdue: 12,
            stage: 'OVERDUE_STAGE_2',
            channel: 'WHATSAPP',
            idempotencyKey: 'rem_2',
            isEligible: false,
            suppressionReason: 'CUSTOMER_INACTIVE',
          },
        ],
      };

      mockRemindersService.previewReminders.mockResolvedValueOnce(mockSummary);

      const result = await controller.previewReminders(mockUser);

      expect(mockRemindersService.previewReminders).toHaveBeenCalledWith(mockUser);
      expect(result.evaluatedCount).toBe(2);
      expect(result.eligibleCount).toBe(1);
      expect(result.suppressedCount).toBe(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].isEligible).toBe(true);
      expect(result.items[0].messagePreview?.subject).toBe('Notice from Demo Corp');
      expect(result.items[1].isEligible).toBe(false);
      expect(result.items[1].suppressionReason).toBe('CUSTOMER_INACTIVE');
    });

    it('returns meaningful empty state summary when zero invoices qualify', async () => {
      const mockEmptySummary: RemindersRunSummary = {
        tenantId: 'tenant_demo_1',
        evaluatedCount: 0,
        eligibleCount: 0,
        dispatchedCount: 0,
        suppressedCount: 0,
        failedCount: 0,
        isDryRun: true,
        globalEnabled: false,
        timestamp: new Date().toISOString(),
        totalTenantInvoices: 8,
        settledInvoicesCount: 8,
        items: [],
      };

      mockRemindersService.previewReminders.mockResolvedValueOnce(mockEmptySummary);

      const result = await controller.previewReminders(mockUser);

      expect(mockRemindersService.previewReminders).toHaveBeenCalledWith(mockUser);
      expect(result.evaluatedCount).toBe(0);
      expect(result.eligibleCount).toBe(0);
      expect(result.items).toHaveLength(0);
      expect(result.totalTenantInvoices).toBe(8);
      expect(result.settledInvoicesCount).toBe(8);
    });

    it('propagates NotFoundException when tenant is not found', async () => {
      mockRemindersService.previewReminders.mockRejectedValueOnce(
        new NotFoundException('Tenant not found'),
      );

      await expect(controller.previewReminders(mockUser)).rejects.toThrow(NotFoundException);
    });

    it('propagates InternalServerErrorException on unexpected database failures', async () => {
      mockRemindersService.previewReminders.mockRejectedValueOnce(
        new InternalServerErrorException('Database connection failed'),
      );

      await expect(controller.previewReminders(mockUser)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('triggerRun (POST /api/reminders/trigger)', () => {
    it('calls triggerRun with requested dryRun parameter', async () => {
      mockRemindersService.triggerRun.mockResolvedValueOnce({
        tenantId: 'tenant_demo_1',
        evaluatedCount: 0,
        eligibleCount: 0,
        dispatchedCount: 0,
        suppressedCount: 0,
        failedCount: 0,
        isDryRun: true,
        globalEnabled: false,
        timestamp: new Date().toISOString(),
        items: [],
      });

      const res = await controller.triggerRun(mockUser, { dryRun: true });

      expect(mockRemindersService.triggerRun).toHaveBeenCalledWith(mockUser, true);
      expect(res.isDryRun).toBe(true);
    });
  });
});
