import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollectionsOrchestrator } from './collections.orchestrator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotificationChannel } from '@prisma/client';

describe('CollectionsOrchestrator', () => {
  let orchestrator: CollectionsOrchestrator;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockNotifications: any;

  let customers: any[];
  let invoices: any[];
  let cases: any[];
  let tasks: any[];
  let notifications: any[];

  const mockUser: AuthUser = {
    userId: 'user_orch_01',
    tenantId: 'tenant_orch_01',
    role: 'ADMIN',
  };

  beforeEach(() => {
    customers = [
      {
        id: 'cust_001',
        tenantId: 'tenant_orch_01',
        name: 'Gupta Enterprises',
        phone: '+919876543210',
        email: 'gupta@enterprises.in',
        notes: '',
        status: 'ACTIVE',
      },
      {
        id: 'cust_dnd',
        tenantId: 'tenant_orch_01',
        name: 'Do Not Contact Corp',
        phone: '+919876500000',
        email: 'dnd@corp.in',
        notes: '[DND:NO_CONTACT - Requested on 2026-10-15T10:00:00Z]',
        status: 'ACTIVE',
      },
    ];

    invoices = [];
    cases = [];
    tasks = [];
    notifications = [];

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_orch_001' }),
    };

    mockNotifications = {
      dispatch: vi.fn().mockImplementation(async (user, dto) => {
        const notif = {
          id: `notif_${Date.now()}`,
          tenantId: user.tenantId,
          customerId: dto.customerId,
          channel: dto.channel,
          payload: { providerMessageId: `wamid.orch.${Date.now()}` },
          createdAt: new Date(),
        };
        notifications.push(notif);
        return notif;
      }),
    };

    mockPrisma = {
      invoice: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return invoices.filter((inv) => {
            if (inv.tenantId !== where.tenantId) return false;
            if (where.status?.in && !where.status.in.includes(inv.status)) return false;
            return true;
          });
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const inv = invoices.find((i) => i.id === where.id);
          if (inv) Object.assign(inv, data);
          return inv;
        }),
      },
      collectionCase: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const c = { id: `case_${Date.now()}_${Math.random()}`, ...data };
          cases.push(c);
          return c;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const c = cases.find((item) => item.id === where.id);
          if (c) Object.assign(c, data);
          return c;
        }),
      },
      followUpTask: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const t = { id: `task_${Date.now()}`, ...data };
          tasks.push(t);
          return t;
        }),
      },
      notification: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            notifications.find(
              (n) =>
                n.tenantId === where.tenantId &&
                n.customerId === where.customerId &&
                (where.createdAt?.gte ? n.createdAt >= where.createdAt.gte : true),
            ) || null
          );
        }),
      },
    };

    orchestrator = new CollectionsOrchestrator(
      mockPrisma,
      mockAuditLogs,
      mockNotifications,
    );
  });

  describe('Overdue Detection & Priority Assignment', () => {
    it('detects overdue invoice, assigns URGENT priority for > 60 days, and dispatches reminder', async () => {
      const pastDue = new Date(Date.now() - 75 * 86400000); // 75 days overdue
      invoices.push({
        id: 'inv_urgent_01',
        number: 'INV-URGENT-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 150000,
        outstanding: 150000,
        dueDate: pastDue,
        status: 'OPEN',
        collectionCases: [],
        paymentPromises: [],
      });

      const report = await orchestrator.orchestrate(mockUser);

      expect(report.totalInvoicesEvaluated).toBe(1);
      expect(report.overdueDetected).toBe(1);
      expect(report.remindersDispatched).toBe(1);
      expect(report.items[0].priority).toBe('URGENT');
      expect(report.items[0].action).toBe('DISPATCHED');

      // Verify follow-up task created
      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toContain('Automated reminder dispatched');

      // Verify audit log emitted
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collections.orchestrated' }),
      );
    });
  });

  describe('Payment Recheck Before Action', () => {
    it('re-checks live payment status and resolves case when balance is zero', async () => {
      const existingCase = {
        id: 'case_existing_01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        status: 'OPEN',
      };
      cases.push(existingCase);

      invoices.push({
        id: 'inv_paid_01',
        number: 'INV-PAID-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 50000,
        outstanding: 0, // Fully paid!
        dueDate: new Date(Date.now() - 10 * 86400000),
        status: 'OPEN',
        collectionCases: [existingCase],
        paymentPromises: [],
      });

      const report = await orchestrator.orchestrate(mockUser);

      expect(report.resolvedPaid).toBe(1);
      expect(report.remindersDispatched).toBe(0);
      expect(report.items[0].action).toBe('RESOLVED_PAID');
      expect(report.items[0].reason).toContain('Live payment recheck confirmed balance is zero');
      expect(existingCase.status).toBe('RESOLVED');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('Contact Permissions & DND Compliance', () => {
    it('strictly suppresses all collection outreach for customers with active [DND:NO_CONTACT]', async () => {
      invoices.push({
        id: 'inv_dnd_01',
        number: 'INV-DND-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_dnd',
        customer: customers[1], // Has [DND:NO_CONTACT]
        amount: 80000,
        outstanding: 80000,
        dueDate: new Date(Date.now() - 20 * 86400000),
        status: 'OVERDUE',
        collectionCases: [],
        paymentPromises: [],
      });

      const report = await orchestrator.orchestrate(mockUser);

      expect(report.suppressedDnd).toBe(1);
      expect(report.remindersDispatched).toBe(0);
      expect(report.items[0].action).toBe('SUPPRESSED_DND');
      expect(report.items[0].reason).toContain('[DND:NO_CONTACT]');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();

      // Audit log records suppression
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'collections.contact_suppressed_dnd' }),
      );
    });
  });

  describe('Promise to Pay (PTP) Grace Period', () => {
    it('pauses collection outreach when customer has an active pending Promise to Pay', async () => {
      const futurePromiseDate = new Date(Date.now() + 5 * 86400000); // Promised 5 days from now
      invoices.push({
        id: 'inv_promise_01',
        number: 'INV-PROMISE-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 60000,
        outstanding: 60000,
        dueDate: new Date(Date.now() - 15 * 86400000),
        status: 'OVERDUE',
        collectionCases: [],
        paymentPromises: [{ status: 'PENDING', promisedDate: futurePromiseDate }],
      });

      const report = await orchestrator.orchestrate(mockUser);

      expect(report.suppressedPromises).toBe(1);
      expect(report.remindersDispatched).toBe(0);
      expect(report.items[0].action).toBe('SUPPRESSED_PROMISE');
      expect(report.items[0].reason).toContain('Collection paused during grace period');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('Duplicate Prevention / Cooldown Window', () => {
    it('suppresses outreach if customer was contacted within last 24 hours', async () => {
      // Simulate notification sent 2 hours ago
      notifications.push({
        id: 'notif_recent_01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      });

      invoices.push({
        id: 'inv_cooldown_01',
        number: 'INV-COOLDOWN-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 40000,
        outstanding: 40000,
        dueDate: new Date(Date.now() - 10 * 86400000),
        status: 'OVERDUE',
        collectionCases: [],
        paymentPromises: [],
      });

      const report = await orchestrator.orchestrate(mockUser, { cooldownHours: 24 });

      expect(report.suppressedCooldown).toBe(1);
      expect(report.remindersDispatched).toBe(0);
      expect(report.items[0].action).toBe('SUPPRESSED_COOLDOWN');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });

    it('overrides cooldown when forceCooldown is true', async () => {
      notifications.push({
        id: 'notif_recent_01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        createdAt: new Date(Date.now() - 2 * 3600 * 1000),
      });

      invoices.push({
        id: 'inv_cooldown_02',
        number: 'INV-COOLDOWN-02',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 40000,
        outstanding: 40000,
        dueDate: new Date(Date.now() - 10 * 86400000),
        status: 'OVERDUE',
        collectionCases: [],
        paymentPromises: [],
      });

      const report = await orchestrator.orchestrate(mockUser, { forceCooldown: true });

      expect(report.suppressedCooldown).toBe(0);
      expect(report.remindersDispatched).toBe(1);
      expect(mockNotifications.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dry Run Preview', () => {
    it('evaluates rules and returns preview without mutating database or dispatching', async () => {
      invoices.push({
        id: 'inv_dry_01',
        number: 'INV-DRY-01',
        tenantId: 'tenant_orch_01',
        customerId: 'cust_001',
        customer: customers[0],
        amount: 70000,
        outstanding: 70000,
        dueDate: new Date(Date.now() - 35 * 86400000),
        status: 'OPEN',
        collectionCases: [],
        paymentPromises: [],
      });

      const preview = await orchestrator.orchestrate(mockUser, { dryRun: true });

      expect(preview.dryRun).toBe(true);
      expect(preview.remindersDispatched).toBe(1);
      expect(preview.items[0].reason).toContain('Preview');
      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
      expect(cases.length).toBe(0); // No DB records created
      expect(tasks.length).toBe(0);
    });
  });
});
