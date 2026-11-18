import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuditLogsService } from './audit-logs/audit-logs.service.js';
import type { AuthUser } from './auth/current-user.decorator.js';

describe('AppController', () => {
  let appController: AppController;
  let mockPrisma: any;
  let mockAuditLogs: any;

  const mockUser: AuthUser = {
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'ADMIN',
  };

  beforeEach(async () => {
    mockPrisma = {
      invoice: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { outstanding: 150000 }, _count: 3 }),
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 50000 } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        count: vi.fn().mockResolvedValue(1),
      },
      collectionCase: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
      paymentPromise: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      callSession: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      integrationConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'cfg_1', config: {} }),
        update: vi.fn().mockResolvedValue({ id: 'cfg_1', config: {} }),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogs,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status', () => {
      const res = appController.health();
      expect(res.status).toBe('ok');
      expect(res.service).toBe('myCashflo API');
    });
  });

  describe('dashboard', () => {
    it('should return verified dashboard dataset scoped to tenant', async () => {
      const res = await appController.dashboard(mockUser, '30d', '30');
      expect(res).toBeDefined();
      expect(res.totalReceivables).toBe(150000);
      expect(res.openInvoiceCount).toBe(2);
      expect(res.agingBreakdown).toBeDefined();
      expect(res.recentOverdueInvoices).toEqual([]);
      expect(res.recentPayments).toEqual([]);
      expect(res.collectionPriorities).toEqual([]);
      expect(res.promisesToPay).toEqual([]);
      expect(res.pendingCallbacks).toEqual([]);
    });

    it('should map recentPayments, collectionPriorities, and hydrate pendingCallbacks customer name', async () => {
      const now = new Date();
      const pastDue = new Date(now.getTime() - 10 * 86_400_000);

      mockPrisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pmt-1',
          ref: 'PAY-100',
          amount: 2500,
          method: 'UPI',
          paidAt: now,
          customer: { name: 'Acme Corp' },
          invoice: { number: 'INV-100' },
        },
      ]);

      mockPrisma.collectionCase.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.id) return [];
        return [
          {
            id: 'case-1',
            caseNumber: 'CASE-001',
            priority: 'HIGH',
            status: 'OPEN',
            customer: { id: 'cust-1', name: 'Acme Corp', outstandingBalance: 15000 },
            invoice: { id: 'inv-1', dueDate: pastDue, outstanding: 12000 },
          },
        ];
      });

      mockPrisma.followUpTask = {
        findMany: vi.fn().mockResolvedValueOnce([
          {
            id: 'task-1',
            title: 'Call client',
            dueDate: now,
            priority: 'HIGH',
            customerId: 'cust-2',
            collectionCase: null,
          },
        ]),
      };

      mockPrisma.customer.findMany = vi.fn().mockResolvedValueOnce([
        { id: 'cust-2', name: 'Hydrated Customer Ltd' },
      ]);

      const res = await appController.dashboard(mockUser);
      expect(res.recentPayments[0]).toMatchObject({
        id: 'pmt-1',
        ref: 'PAY-100',
        reference: 'PAY-100',
        amount: 2500,
        currency: 'INR',
        paidAt: now,
        paymentDate: now,
        customerName: 'Acme Corp',
        invoiceNumber: 'INV-100',
      });

      expect(res.collectionPriorities[0]).toMatchObject({
        id: 'case-1',
        caseNumber: 'CASE-001',
        customerName: 'Acme Corp',
        outstandingBalance: 15000,
        overdueAmount: 12000,
        daysOverdue: 10,
      });

      expect(res.pendingCallbacks[0]).toMatchObject({
        id: 'task-1',
        title: 'Call client',
        customerName: 'Hydrated Customer Ltd',
      });
    });
  });

  describe('dashboard preferences', () => {
    it('returns default preferences if none exist', async () => {
      const prefs = await appController.getDashboardPreferences(mockUser);
      expect(prefs.dateRange).toBe('all');
      expect(prefs.agingThreshold).toBe(30);
      expect(prefs.visibleWidgets).toBeDefined();
      expect(prefs.visibleWidgets.totalReceivables).toBe(true);
      expect(prefs.visibleWidgets.recentPayments).toBe(true);
    });

    it('saves preferences per tenant and logs audit entry', async () => {
      mockPrisma.integrationConfig = {
        upsert: vi.fn().mockResolvedValue({
          id: 'cfg_1',
          config: { visibleWidgets: { recentPayments: false }, dateRange: '30d', agingThreshold: 45 },
        }),
      };

      const res = await appController.saveDashboardPreferences(mockUser, {
        visibleWidgets: { recentPayments: false },
        dateRange: '30d',
        agingThreshold: 45,
      });

      expect(res.success).toBe(true);
      expect(res.preferences.dateRange).toBe('30d');
      expect(res.preferences.agingThreshold).toBe(45);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'dashboard.preferences_updated' }),
      );
    });
  });
});

