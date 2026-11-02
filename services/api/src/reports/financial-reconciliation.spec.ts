import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppController } from '../app.controller.js';
import { ReportsService } from './reports.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('Financial Reconciliation: Dashboard vs Financial Reports', () => {
  let appController: AppController;
  let reportsService: ReportsService;
  let mockPrisma: any;

  const mockUser: AuthUser = {
    userId: 'user_admin',
    tenantId: 'tenant_demo_corp',
    role: 'ADMIN',
  };

  const now = new Date('2026-10-22T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  // Scenario 1: Fully Settled Tenant (Demo Corp Evidence Scenario)
  it('1. should prove Dashboard and Financial Reports agree 100% on a fully settled tenant', async () => {
    // Invoices: 8 invoices totaling 6,71,700 INR, all PAID with 0 outstanding
    const invoices = [
      { id: 'inv_1', number: 'INV-2024-001', amount: 85000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-09-13'), issueDate: new Date('2026-08-13'), tenantId: mockUser.tenantId },
      { id: 'inv_2', number: 'INV-2024-002', amount: 60000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-10-23'), issueDate: new Date('2026-09-23'), tenantId: mockUser.tenantId },
      { id: 'inv_3', number: 'INV-2024-003', amount: 89500, outstanding: 0, status: 'PAID', dueDate: new Date('2026-09-28'), issueDate: new Date('2026-08-28'), tenantId: mockUser.tenantId },
      { id: 'inv_4', number: 'INV-2024-004', amount: 200000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-10-08'), issueDate: new Date('2026-09-08'), tenantId: mockUser.tenantId },
      { id: 'inv_5', number: 'INV-2024-005', amount: 120000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-11-02'), issueDate: new Date('2026-10-02'), tenantId: mockUser.tenantId },
      { id: 'inv_6', number: 'INV-2024-006', amount: 50000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-10-03'), issueDate: new Date('2026-09-03'), tenantId: mockUser.tenantId },
      { id: 'inv_7', number: 'INV-2024-007', amount: 42000, outstanding: 0, status: 'PAID', dueDate: new Date('2026-09-23'), issueDate: new Date('2026-08-23'), tenantId: mockUser.tenantId },
      { id: 'inv_8', number: 'INV-2024-008', amount: 25200, outstanding: 0, status: 'PAID', dueDate: new Date('2026-11-07'), issueDate: new Date('2026-10-07'), tenantId: mockUser.tenantId },
    ];

    // Payments: Completed payments totaling 6,71,700 INR
    const payments = [
      { id: 'pay_1', amount: 671700, status: 'COMPLETED', paidAt: new Date('2026-10-15'), tenantId: mockUser.tenantId },
    ];

    // Collection Cases: 3 historical cases for settled invoices
    const cases = [
      { id: 'case_1', invoiceId: 'inv_1', status: 'OPEN', priority: 'HIGH', tenantId: mockUser.tenantId, invoice: invoices[0] },
      { id: 'case_2', invoiceId: 'inv_4', status: 'IN_PROGRESS', priority: 'URGENT', tenantId: mockUser.tenantId, invoice: invoices[3] },
      { id: 'case_3', invoiceId: 'inv_7', status: 'OPEN', priority: 'MEDIUM', tenantId: mockUser.tenantId, invoice: invoices[6] },
    ];

    mockPrisma = {
      collectionCase: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where?.status?.in && where.OR) {
            // Stale cases query
            return cases.filter((c) => c.status === 'OPEN' || c.status === 'IN_PROGRESS');
          }
          return [];
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          for (const c of cases) {
            if (where.id?.in?.includes(c.id)) {
              Object.assign(c, data);
            }
          }
          return { count: cases.length };
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return cases.filter((c) => {
            if (where.status?.in) return where.status.in.includes(c.status);
            return true;
          }).length;
        }),
      },
      invoice: {
        aggregate: vi.fn().mockImplementation(async ({ where, _sum }) => {
          const filtered = invoices.filter((i) => {
            if (where.tenantId && i.tenantId !== where.tenantId) return false;
            if (where.status?.notIn && where.status.notIn.includes(i.status)) return false;
            if (where.status?.not && i.status === where.status.not) return false;
            if (where.status === 'OVERDUE' && i.status !== 'OVERDUE') return false;
            if (where.outstanding?.gt !== undefined && !(i.outstanding > where.outstanding.gt)) return false;
            return true;
          });
          const sumAmt = filtered.reduce((s, i) => s + i.amount, 0);
          const sumOut = filtered.reduce((s, i) => s + i.outstanding, 0);
          return {
            _sum: {
              amount: _sum?.amount ? sumAmt : undefined,
              outstanding: _sum?.outstanding ? sumOut : undefined,
            },
            _count: filtered.length,
          };
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          return invoices.filter((i) => {
            if (where.tenantId && i.tenantId !== where.tenantId) return false;
            if (where.status?.in && !where.status.in.includes(i.status)) return false;
            if (where.outstanding?.gt !== undefined && !(i.outstanding > where.outstanding.gt)) return false;
            return true;
          }).length;
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        aggregate: vi.fn().mockImplementation(async ({ where, _sum }) => {
          const filtered = payments.filter((p) => {
            if (where.tenantId && p.tenantId !== where.tenantId) return false;
            if (where.status && p.status !== where.status) return false;
            return true;
          });
          return { _sum: { amount: filtered.reduce((s, p) => s + p.amount, 0) } };
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        count: vi.fn().mockResolvedValue(0),
      },
      paymentPromise: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    appController = new AppController(mockPrisma as unknown as PrismaService);
    reportsService = new ReportsService(mockPrisma as unknown as PrismaService);

    const [dashStats, repSummary] = await Promise.all([
      appController.dashboard(mockUser),
      reportsService.getSummary(mockUser),
    ]);

    // Financial Totals Alignment
    expect(dashStats.totalReceivables).toBe(0);
    expect(repSummary.totalReceivables).toBe(0);

    expect(dashStats.totalBilled).toBe(671700);
    expect(repSummary.totalBilled).toBe(671700);

    expect(dashStats.totalCollected).toBe(671700);
    expect(repSummary.totalCollected).toBe(671700);

    expect(dashStats.overdueAmount).toBe(0);
    expect(repSummary.totalOverdue).toBe(0);

    // True Collection Rate: 100% on BOTH pages
    expect(dashStats.collectionRate).toBe(100);
    expect(repSummary.collectionRate).toBe(100);

    // Open Invoices: 0 on BOTH pages
    expect(dashStats.openInvoiceCount).toBe(0);
    expect(repSummary.openInvoices).toBe(0);

    // Overdue Customers: 0 on BOTH pages
    expect(dashStats.overdueCustomerCount).toBe(0);
    expect(repSummary.overdueCustomers).toBe(0);

    // Active Collection Cases auto-reconciled: 0
    expect(dashStats.openCaseCount).toBe(0);
    expect(cases.every((c) => c.status === 'RESOLVED')).toBe(true);
  });

  // Scenario 2: Partially Paid Tenant
  it('2. should maintain consistency between Dashboard and Reports for partial payments', async () => {
    const invoices = [
      { id: 'inv_part', number: 'INV-PART-01', amount: 100000, outstanding: 60000, status: 'PARTIALLY_PAID', dueDate: new Date('2026-11-15'), issueDate: new Date('2026-10-01'), tenantId: mockUser.tenantId },
    ];
    const payments = [
      { id: 'pay_part', amount: 40000, status: 'COMPLETED', paidAt: new Date('2026-10-10'), tenantId: mockUser.tenantId },
    ];

    mockPrisma = {
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      invoice: {
        aggregate: vi.fn().mockImplementation(async ({ where, _sum }) => {
          const filtered = invoices.filter((i) => {
            if (where.status?.notIn && where.status.notIn.includes(i.status)) return false;
            if (where.status?.not && i.status === where.status.not) return false;
            if (where.outstanding?.gt !== undefined && !(i.outstanding > where.outstanding.gt)) return false;
            return true;
          });
          return {
            _sum: {
              amount: _sum?.amount ? filtered.reduce((s, i) => s + i.amount, 0) : undefined,
              outstanding: _sum?.outstanding ? filtered.reduce((s, i) => s + i.outstanding, 0) : undefined,
            },
            _count: filtered.length,
          };
        }),
        count: vi.fn().mockImplementation(async () => 1),
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 40000 } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        count: vi.fn().mockResolvedValue(0),
      },
      paymentPromise: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    appController = new AppController(mockPrisma as unknown as PrismaService);
    reportsService = new ReportsService(mockPrisma as unknown as PrismaService);

    const [dashStats, repSummary] = await Promise.all([
      appController.dashboard(mockUser),
      reportsService.getSummary(mockUser),
    ]);

    expect(dashStats.totalReceivables).toBe(60000);
    expect(repSummary.totalReceivables).toBe(60000);

    expect(dashStats.totalBilled).toBe(100000);
    expect(repSummary.totalBilled).toBe(100000);

    expect(dashStats.totalCollected).toBe(40000);
    expect(repSummary.totalCollected).toBe(40000);

    // Collection rate: 40% on BOTH pages
    expect(dashStats.collectionRate).toBe(40);
    expect(repSummary.collectionRate).toBe(40);

    expect(dashStats.openInvoiceCount).toBe(1);
    expect(repSummary.openInvoices).toBe(1);
  });

  // Scenario 3: Overdue Invoices Reconciliation
  it('3. should agree on overdue amount and counts across Dashboard and Reports', async () => {
    const overdueInvoices = [
      { id: 'inv_od_1', number: 'INV-OD-01', amount: 50000, outstanding: 50000, status: 'OVERDUE', dueDate: new Date('2026-09-01'), issueDate: new Date('2026-08-01'), tenantId: mockUser.tenantId },
    ];

    mockPrisma = {
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
      },
      invoice: {
        aggregate: vi.fn().mockImplementation(async ({ where, _sum }) => {
          return {
            _sum: {
              amount: 50000,
              outstanding: 50000,
            },
            _count: 1,
          };
        }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue(overdueInvoices),
      },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        count: vi.fn().mockResolvedValue(1),
      },
      paymentPromise: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    appController = new AppController(mockPrisma as unknown as PrismaService);
    reportsService = new ReportsService(mockPrisma as unknown as PrismaService);

    const [dashStats, repSummary] = await Promise.all([
      appController.dashboard(mockUser),
      reportsService.getSummary(mockUser),
    ]);

    expect(dashStats.totalReceivables).toBe(50000);
    expect(repSummary.totalReceivables).toBe(50000);

    expect(dashStats.overdueAmount).toBe(50000);
    expect(repSummary.totalOverdue).toBe(50000);

    expect(dashStats.overdueCustomerCount).toBe(1);
    expect(repSummary.overdueCustomers).toBe(1);
    expect(dashStats.collectionRate).toBe(0);
    expect(repSummary.collectionRate).toBe(0);
  });
});
