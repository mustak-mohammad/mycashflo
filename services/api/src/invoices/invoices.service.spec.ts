import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import {
  InvoiceStatus,
  PaymentStatus,
  OrderIntentStatus,
  RefundStatus,
  CaseStatus,
  PromiseStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('InvoicesService — Safe Invoice Cancellation & Financial Integrity', () => {
  let service: InvoicesService;
  let mockPrisma: any;
  let mockAuditLogs: any;

  const adminUser: AuthUser = {
    userId: 'user_admin_01',
    email: 'admin@democorp.in',
    tenantId: 'tenant_01',
    role: 'ADMIN',
  };

  const agentUser: AuthUser = {
    userId: 'user_agent_01',
    email: 'agent@democorp.in',
    tenantId: 'tenant_01',
    role: 'AGENT',
  };

  let mockInvoices: any[];
  let mockCustomers: any[];
  let lockCalls: string[];

  beforeEach(() => {
    lockCalls = [];

    mockCustomers = [
      {
        id: 'cust_01',
        name: 'ABC Tech',
        tenantId: 'tenant_01',
        outstandingBalance: 40000,
      },
      {
        id: 'cust_02',
        name: 'Cross Tenant Client',
        tenantId: 'tenant_02',
        outstandingBalance: 50000,
      },
    ];

    mockInvoices = [
      {
        id: 'inv_01',
        number: 'INV-2026-001',
        customerId: 'cust_01',
        tenantId: 'tenant_01',
        amount: 25000,
        outstanding: 25000,
        status: InvoiceStatus.OPEN,
        dueDate: new Date(Date.now() + 86400000 * 10),
        payments: [],
        paymentOrderIntents: [],
        paymentRefunds: [],
        collectionCases: [],
        paymentPromises: [],
      },
      {
        id: 'inv_02',
        number: 'INV-2026-002',
        customerId: 'cust_01',
        tenantId: 'tenant_01',
        amount: 15000,
        outstanding: 15000,
        status: InvoiceStatus.OPEN,
        dueDate: new Date(Date.now() + 86400000 * 20),
        payments: [],
        paymentOrderIntents: [],
        paymentRefunds: [],
        collectionCases: [],
        paymentPromises: [],
      },
      {
        id: 'inv_other_tenant',
        number: 'INV-OTHER-999',
        customerId: 'cust_02',
        tenantId: 'tenant_02',
        amount: 50000,
        outstanding: 50000,
        status: InvoiceStatus.OPEN,
        dueDate: new Date(Date.now() + 86400000 * 10),
        payments: [],
        paymentOrderIntents: [],
        paymentRefunds: [],
        collectionCases: [],
        paymentPromises: [],
      },
    ];

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_log_01' }),
    };

    mockPrisma = {
      invoice: {
        findFirst: vi.fn().mockImplementation(async (args) => {
          const inv = mockInvoices.find((i) => {
            if (args.where?.id && i.id !== args.where.id) return false;
            if (args.where?.tenantId && i.tenantId !== args.where.tenantId) return false;
            return true;
          });
          return inv ? { ...inv } : null;
        }),
        findMany: vi.fn().mockImplementation(async (args) => {
          return mockInvoices.filter((i) => {
            if (args.where?.tenantId && i.tenantId !== args.where.tenantId) return false;
            if (args.where?.customerId && i.customerId !== args.where.customerId) return false;
            if (args.where?.status?.in && !args.where.status.in.includes(i.status)) return false;
            return true;
          });
        }),
        update: vi.fn().mockImplementation(async (args) => {
          const inv = mockInvoices.find((i) => i.id === args.where.id);
          if (!inv) throw new Error('Invoice not found in mock');
          Object.assign(inv, args.data);
          return { ...inv };
        }),
      },
      customer: {
        findFirst: vi.fn().mockImplementation(async (args) => {
          return mockCustomers.find((c) => c.id === args.where.id && c.tenantId === args.where.tenantId) ?? null;
        }),
        update: vi.fn().mockImplementation(async (args) => {
          const cust = mockCustomers.find((c) => c.id === args.where.id);
          if (!cust) throw new Error('Customer not found in mock');
          Object.assign(cust, args.data);
          return { ...cust };
        }),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        const invoicesSnapshot = mockInvoices.map((i) => ({ ...i }));
        const customersSnapshot = mockCustomers.map((c) => ({ ...c }));
        try {
          const tx = {
            $queryRaw: vi.fn().mockImplementation(async (strings: any, ...values: any[]) => {
              const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
              if (sql.includes('"Customer"')) {
                lockCalls.push(`Customer:${values[0]}`);
              } else if (sql.includes('"Invoice"')) {
                lockCalls.push(`Invoice:${values[0]}`);
              }
            }),
            invoice: {
              findFirst: vi.fn().mockImplementation(async (args) => {
                const inv = mockInvoices.find((i) => {
                  if (args.where?.id && i.id !== args.where.id) return false;
                  if (args.where?.tenantId && i.tenantId !== args.where.tenantId) return false;
                  return true;
                });
                return inv ? { ...inv } : null;
              }),
              findMany: vi.fn().mockImplementation(async (args) => {
                return mockInvoices.filter((i) => {
                  if (args.where?.tenantId && i.tenantId !== args.where.tenantId) return false;
                  if (args.where?.customerId && i.customerId !== args.where.customerId) return false;
                  if (args.where?.status?.in && !args.where.status.in.includes(i.status)) return false;
                  return true;
                });
              }),
              update: vi.fn().mockImplementation(async (args) => {
                const inv = mockInvoices.find((i) => i.id === args.where.id);
                if (!inv) throw new Error('Invoice not found in mock');
                Object.assign(inv, args.data);
                return { ...inv };
              }),
            },
            customer: {
              update: vi.fn().mockImplementation(async (args) => {
                const cust = mockCustomers.find((c) => c.id === args.where.id);
                if (!cust) throw new Error('Customer not found in mock');
                Object.assign(cust, args.data);
                return { ...cust };
              }),
            },
          };
          return await cb(tx);
        } catch (err) {
          // Restore snapshots to simulate transaction rollback
          mockInvoices.splice(0, mockInvoices.length, ...invoicesSnapshot);
          mockCustomers.splice(0, mockCustomers.length, ...customersSnapshot);
          throw err;
        }
      }),
    };

    service = new InvoicesService(mockPrisma as any, mockAuditLogs as any);
  });

  describe('1. Successful Cancellation & Financial Recalculation', () => {
    it('cancels an unpaid invoice and recalculates customer balance from active invoices only', async () => {
      const result = await service.update('inv_02', adminUser, {
        status: InvoiceStatus.CANCELLED,
      });

      expect(result.status).toBe(InvoiceStatus.CANCELLED);
      // Historical amounts MUST be preserved byte-for-byte
      expect(result.amount).toBe(15000);
      expect(result.outstanding).toBe(15000);

      // Customer balance must be recalculated to only active invoices (inv_01: 25,000)
      const customer = mockCustomers.find((c) => c.id === 'cust_01');
      expect(customer.outstandingBalance).toBe(25000);

      // Audit log must be emitted
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'invoice.cancelled',
          entityType: 'Invoice',
          entityId: 'inv_02',
          metadata: expect.objectContaining({
            previousStatus: InvoiceStatus.OPEN,
            newStatus: InvoiceStatus.CANCELLED,
            recalculatedCustomerBalance: 25000,
          }),
        }),
      );
    });

    it('sets customer outstanding balance to 0 when all customer invoices are settled or cancelled', async () => {
      mockInvoices[0].status = InvoiceStatus.PAID;
      mockInvoices[0].outstanding = 0;

      await service.update('inv_02', adminUser, {
        status: InvoiceStatus.CANCELLED,
      });

      const customer = mockCustomers.find((c) => c.id === 'cust_01');
      expect(customer.outstandingBalance).toBe(0);
    });

    it('enforces strict Customer-then-Invoice FOR UPDATE lock order', async () => {
      await service.update('inv_02', adminUser, {
        status: InvoiceStatus.CANCELLED,
      });

      expect(lockCalls).toEqual(['Customer:cust_01', 'Invoice:inv_02']);
    });
  });

  describe('2. Payment & Financial Safeguards (Unsafe Cancellation Prevention)', () => {
    it('rejects cancellation if completed payment records exist', async () => {
      mockInvoices[1].payments = [
        { id: 'pay_01', status: PaymentStatus.COMPLETED, amount: 15000 },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: completed payment records exist');

      // Database state and balances must remain untouched
      expect(mockInvoices[1].status).toBe(InvoiceStatus.OPEN);
      expect(mockCustomers[0].outstandingBalance).toBe(40000);
    });

    it('rejects cancellation if invoice is already marked as PAID', async () => {
      mockInvoices[1].status = InvoiceStatus.PAID;
      mockInvoices[1].outstanding = 0;

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel an invoice marked as PAID');
    });

    it('rejects cancellation if pending payments or unverified claims exist', async () => {
      mockInvoices[1].payments = [
        { id: 'pay_pending_01', status: PaymentStatus.PENDING, amount: 15000 },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: pending payment operations or claims exist');
    });

    it('rejects cancellation if active payment order intent exists', async () => {
      mockInvoices[1].paymentOrderIntents = [
        { id: 'poi_01', status: OrderIntentStatus.CREATED, activeClaimKey: 'lock:key' },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: active payment intent in progress');
    });

    it('rejects cancellation if pending refunds exist', async () => {
      mockInvoices[1].paymentRefunds = [
        { id: 'rfnd_01', status: RefundStatus.PENDING, amount: 5000 },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: pending refund operations exist');
    });

    it('rejects cancellation if active collection cases exist', async () => {
      mockInvoices[1].collectionCases = [
        { id: 'case_01', status: CaseStatus.OPEN },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: active collection case in progress');
    });

    it('rejects cancellation if pending payment promise exists', async () => {
      mockInvoices[1].paymentPromises = [
        { id: 'ptp_01', status: PromiseStatus.PENDING },
      ];

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Cannot cancel invoice: pending payment promise exists');
    });
  });

  describe('3. Tenant Isolation & RBAC Rules', () => {
    it('throws NotFoundException when trying to cancel an invoice from another tenant', async () => {
      await expect(
        service.update('inv_other_tenant', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when an AGENT tries to update or cancel an invoice', async () => {
      await expect(
        service.update('inv_01', agentUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.update('inv_01', agentUser, { description: 'Updated notes' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('4. Status Transition & Ordinary Updates', () => {
    it('rejects direct status modification to PAID via update()', async () => {
      await expect(
        service.update('inv_01', adminUser, { status: InvoiceStatus.PAID }),
      ).rejects.toThrow('Direct transition to PAID is not permitted');
    });

    it('rejects direct status modification to PARTIALLY_PAID via update()', async () => {
      await expect(
        service.update('inv_01', adminUser, { status: InvoiceStatus.PARTIALLY_PAID }),
      ).rejects.toThrow('Direct transition to PARTIALLY_PAID is not permitted');
    });

    it('rejects modifying an invoice that is already CANCELLED', async () => {
      mockInvoices[0].status = InvoiceStatus.CANCELLED;

      await expect(
        service.update('inv_01', adminUser, { status: InvoiceStatus.OPEN }),
      ).rejects.toThrow('Cannot modify status of a CANCELLED invoice');

      await expect(
        service.update('inv_01', adminUser, { description: 'New description' }),
      ).rejects.toThrow('Cannot modify an invoice marked as CANCELLED');
    });

    it('updates ordinary fields (description, dueDate) without triggering customer balance recalculation', async () => {
      const initialBalance = mockCustomers[0].outstandingBalance;

      const updated = await service.update('inv_01', adminUser, {
        description: 'New maintenance agreement description',
      });

      expect(updated.description).toBe('New maintenance agreement description');
      expect(mockCustomers[0].outstandingBalance).toBe(initialBalance);
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.updated' }),
      );
    });
  });

  describe('5. Transactional Integrity & Rollback Protection', () => {
    it('rolls back transaction if customer balance recalculation fails', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          $queryRaw: vi.fn(),
          invoice: {
            findFirst: vi.fn().mockResolvedValue({ ...mockInvoices[1] }),
            update: vi.fn().mockResolvedValue({ ...mockInvoices[1], status: InvoiceStatus.CANCELLED }),
            findMany: vi.fn().mockResolvedValue([{ outstanding: 25000 }]),
          },
          customer: {
            update: vi.fn().mockRejectedValue(new Error('Database disk error during balance update')),
          },
        };
        return cb(tx);
      });

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Database disk error during balance update');

      // The uncommitted mutation should not survive
      expect(mockInvoices[1].status).toBe(InvoiceStatus.OPEN);
    });

    it('rolls back transaction if audit logging fails during cancellation', async () => {
      mockAuditLogs.log.mockRejectedValueOnce(new Error('Audit log storage unavailable'));

      await expect(
        service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED }),
      ).rejects.toThrow('Audit log storage unavailable');

      // State remains OPEN
      expect(mockInvoices[1].status).toBe(InvoiceStatus.OPEN);
    });
  });

  describe('6. Concurrency Safety Simulation', () => {
    it('serializes concurrent operations using Customer -> Invoice locking', async () => {
      // Concurrently attempt two cancellations for the same customer
      const p1 = service.update('inv_01', adminUser, { status: InvoiceStatus.CANCELLED });
      const p2 = service.update('inv_02', adminUser, { status: InvoiceStatus.CANCELLED });

      await Promise.all([p1, p2]);

      expect(mockInvoices[0].status).toBe(InvoiceStatus.CANCELLED);
      expect(mockInvoices[1].status).toBe(InvoiceStatus.CANCELLED);
      expect(mockCustomers[0].outstandingBalance).toBe(0);

      // Verify locks were acquired for both operations
      expect(lockCalls).toContain('Customer:cust_01');
      expect(lockCalls).toContain('Invoice:inv_01');
      expect(lockCalls).toContain('Invoice:inv_02');
    });
  });
});
