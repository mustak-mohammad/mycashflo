import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportsService } from './reports.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('ReportsService - Ledger', () => {
  let service: ReportsService;
  let prisma: any;

  const mockUser = {
    id: 'user-1',
    email: 'admin@acme.com',
    role: 'ADMIN' as const,
    tenantId: 'tenant-123',
    name: 'Admin User',
  };

  beforeEach(() => {
    prisma = {
      invoice: {
        findMany: vi.fn(),
        aggregate: vi.fn(),
        count: vi.fn(),
      },
      payment: {
        findMany: vi.fn(),
        aggregate: vi.fn(),
        count: vi.fn(),
      },
      customer: {
        count: vi.fn(),
      },
      paymentPromise: {
        count: vi.fn(),
      },
    };

    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('should compute chronological running balance accurately for debits and credits', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-1',
        number: 'INV-001',
        customerId: 'cust-1',
        amount: 5000,
        issueDate: new Date('2026-01-05T00:00:00Z'),
        createdAt: new Date('2026-01-05T00:00:00Z'),
        description: 'Web development services',
        status: 'PARTIALLY_PAID',
        currency: 'INR',
        customer: { id: 'cust-1', name: 'Acme Client' },
      },
      {
        id: 'inv-2',
        number: 'INV-002',
        customerId: 'cust-1',
        amount: 3000,
        issueDate: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
        description: 'Server maintenance',
        status: 'OPEN',
        currency: 'INR',
        customer: { id: 'cust-1', name: 'Acme Client' },
      },
    ]);

    prisma.payment.findMany.mockResolvedValueOnce([
      {
        id: 'pmt-1',
        ref: 'PAY-001',
        customerId: 'cust-1',
        amount: 2000,
        paidAt: new Date('2026-01-10T00:00:00Z'),
        createdAt: new Date('2026-01-10T00:00:00Z'),
        method: 'UPI',
        status: 'COMPLETED',
        currency: 'INR',
        customer: { id: 'cust-1', name: 'Acme Client' },
        invoice: { number: 'INV-001' },
      },
    ]);

    const result = await service.getLedger(mockUser, { customerId: 'cust-1' });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-123', customerId: 'cust-1' }),
      }),
    );

    expect(result.data).toHaveLength(3);
    // Order: INV-001 (Jan 5), PAY-001 (Jan 10), INV-002 (Jan 15)
    expect(result.data[0].ref).toBe('INV-001');
    expect(result.data[0].debit).toBe(5000);
    expect(result.data[0].runningBalance).toBe(5000);

    expect(result.data[1].ref).toBe('PAY-001');
    expect(result.data[1].credit).toBe(2000);
    expect(result.data[1].runningBalance).toBe(3000);

    expect(result.data[2].ref).toBe('INV-002');
    expect(result.data[2].debit).toBe(3000);
    expect(result.data[2].runningBalance).toBe(6000);

    expect(result.summary.totalDebits).toBe(8000);
    expect(result.summary.totalCredits).toBe(2000);
    expect(result.summary.netBalance).toBe(6000);
  });

  it('should sanitize CSV outputs to protect against formula injection', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-malicious',
        number: '=1+1',
        customerId: 'cust-bad',
        amount: 100,
        issueDate: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        description: '@malicious_macro',
        status: 'OPEN',
        currency: 'INR',
        customer: { id: 'cust-bad', name: '+John Doe' },
      },
    ]);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const csv = await service.exportLedgerCsv(mockUser, {});
    expect(csv).toContain("'+John Doe");
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@malicious_macro");
  });
});
