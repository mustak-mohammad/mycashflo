import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChotuService } from './chotu.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { InvoiceStatus } from '@prisma/client';

describe('ChotuService — Application-Wide Chatbot', () => {
  let service: ChotuService;
  let mockPrisma: any;

  const mockAdminUser: AuthUser = {
    userId: 'user_admin_01',
    email: 'admin@democorp.in',
    tenantId: 'tenant_demo',
    role: 'ADMIN',
  };

  const mockAgentUser: AuthUser = {
    userId: 'user_agent_01',
    email: 'agent@democorp.in',
    tenantId: 'tenant_demo',
    role: 'AGENT',
  };

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      invoice: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
      },
      payment: {
        findMany: vi.fn(),
      },
      collectionCase: {
        findMany: vi.fn(),
      },
      followUpTask: {
        findMany: vi.fn(),
      },
      callSession: {
        findMany: vi.fn(),
      },
    };

    service = new ChotuService(mockPrisma);
  });

  describe('1. Read-Only Mutation Interception & Safety Guard', () => {
    it('should intercept payment settlement requests and refuse direct mutations', async () => {
      const res = await service.processChat(mockAdminUser, {
        message: 'Please mark invoice INV-1001 as paid and settle balance',
      });

      expect(res.reply).toContain('Read-Only Assistance Mode');
      expect(res.reply).toContain('cannot directly modify financial balances');
      expect(res.suggestedRoute).toBe('/payments');
    });

    it('should intercept customer outreach attempts and refuse unauthorized communications', async () => {
      const res = await service.processChat(mockAgentUser, {
        message: 'Send a WhatsApp reminder to customer Gupta Enterprises immediately',
      });

      expect(res.reply).toContain('Outreach Safety Guard');
      expect(res.reply).toContain('cannot directly initiate phone calls, dispatch emails, or send WhatsApp');
    });

    it('should intercept customer creation requests and guide to proper UI workflow', async () => {
      const res = await service.processChat(mockAdminUser, {
        message: 'Create a new customer named Acme Global with phone 9876543210',
      });

      expect(res.reply).toContain('Read-Only Assistance Mode');
      expect(res.reply).toContain('Customers');
      expect(res.suggestedRoute).toBe('/customers');
    });
  });

  describe('2. Tenant Isolation & Scoping', () => {
    it('should enforce tenantId on customer and invoice lookups', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      await service.processChat(mockAdminUser, {
        message: 'Give me an overview of outstanding invoices',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_demo' }),
        }),
      );
    });

    it('should not leak cross-tenant data when selectedRecordId belongs to another tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const res = await service.processChat(mockAdminUser, {
        message: 'What is the balance for this record?',
        selectedRecordId: 'foreign_customer_id_999',
      });

      expect(res).toBeDefined();
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign_customer_id_999', tenantId: 'tenant_demo' },
      });
    });
  });

  describe('3. Role-Based Access Control (RBAC) Scoping', () => {
    it('should restrict Collection Agent from querying unassigned customer accounts', async () => {
      // Agent has no assigned collection cases for customer cust_unassigned
      mockPrisma.collectionCase.findMany.mockResolvedValue([]);
      mockPrisma.followUpTask.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: 'cust_unassigned', name: 'Unassigned Corp', company: 'Unassigned Corp' },
      ]);

      const res = await service.processChat(mockAgentUser, {
        message: 'What is the outstanding balance for Unassigned Corp?',
      });

      expect(res.reply).toContain('Access Restricted');
      expect(res.reply).toContain('only authorized to query your assigned collection accounts');
      expect(res.dataUnavailable).toBe(true);
    });

    it('should allow Collection Agent to query their assigned customer accounts', async () => {
      mockPrisma.collectionCase.findMany.mockResolvedValue([{ customerId: 'cust_assigned_01' }]);
      mockPrisma.followUpTask.findMany.mockResolvedValue([]);
      mockPrisma.customer.findMany.mockResolvedValue([
        { id: 'cust_assigned_01', name: 'Assigned Client', company: null },
      ]);
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust_assigned_01',
        name: 'Assigned Client',
        company: null,
        status: 'ACTIVE',
        outstandingBalance: 25000,
        invoices: [],
        payments: [],
      });

      const res = await service.processChat(mockAgentUser, {
        message: 'What is the balance for Assigned Client?',
      });

      expect(res.reply).toContain('Assigned Client');
      expect(res.reply).toContain('₹25,000');
    });

    it('should explain role restrictions when Collection Agent asks about system settings', async () => {
      const res = await service.processChat(mockAgentUser, {
        message: 'How do I add users and change gateway settings?',
      });

      expect(res.reply).toContain('restricted to **Tenant Administrators**');
      expect(res.suggestedRoute).toBeUndefined();
    });

    it('should provide full settings guidance when Tenant Admin asks about system settings', async () => {
      const res = await service.processChat(mockAdminUser, {
        message: 'How do I manage settings and integrations?',
      });

      expect(res.reply).toContain('Managing Settings & Integrations');
      expect(res.reply).toContain('Payment Gateways');
      expect(res.suggestedRoute).toBe('/settings');
    });
  });

  describe('4. Financial Accuracy & Simulation Notice', () => {
    it('should calculate accurate overdue days and rupees formatting', async () => {
      const pastDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv_1',
          number: 'INV-OVERDUE-01',
          outstanding: 45000,
          dueDate: pastDate,
          customer: { name: 'Late Payers Ltd', company: null },
        },
      ]);
      mockPrisma.invoice.count.mockResolvedValue(1);

      const res = await service.processChat(mockAdminUser, {
        message: 'Which invoices are overdue?',
      });

      expect(res.reply).toContain('INV-OVERDUE-01');
      expect(res.reply).toContain('₹45,000');
      expect(res.reply).toContain('15 days overdue');
    });

    it('should identify simulated sandbox payments accurately', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay_sim_1',
          ref: 'PAY-SIM-1234',
          amount: 15000,
          method: 'UPI',
          status: 'COMPLETED',
          providerRef: 'pay_rzp_mock_179275',
          createdAt: new Date(),
          customer: { name: 'Demo Client' },
          invoice: { number: 'INV-001' },
        },
      ]);

      const res = await service.processChat(mockAdminUser, {
        message: 'Summarize recent payment collections',
      });

      expect(res.reply).toContain('PAY-SIM-1234');
      expect(res.reply).toContain('₹15,000');
      expect(res.reply).toContain('Sandbox Simulation');
    });
  });

  describe('5. Cancelled Invoice Financial Exclusion', () => {
    it('should query only active receivable statuses for receivables overview', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        { outstanding: 25000, dueDate: new Date(Date.now() + 86400000), status: InvoiceStatus.OPEN },
      ]);

      const res = await service.processChat(mockAdminUser, {
        message: 'Give me an overview of outstanding invoices.',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
            outstanding: { gt: 0 },
          }),
        }),
      );
      expect(res.reply).toContain('₹25,000');
    });

    it('should query only active receivable statuses for overdue invoices list', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.processChat(mockAdminUser, {
        message: 'Which invoices are overdue?',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
            outstanding: { gt: 0 },
          }),
        }),
      );
    });

    it('should exclude CANCELLED invoices from customer overview overdue calculations', async () => {
      const pastDate = new Date(Date.now() - 86400000 * 5);
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust_sharma',
          name: 'Sharma Industries',
          company: 'Sharma Industries',
          tenantId: 'tenant_01',
          status: 'ACTIVE',
        },
      ]);
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust_sharma',
        name: 'Sharma Industries',
        company: 'Sharma Industries',
        outstandingBalance: 25000,
        status: 'ACTIVE',
        invoices: [
          { id: 'inv_active', number: 'INV-ACT-1', amount: 25000, outstanding: 25000, dueDate: pastDate, status: InvoiceStatus.OVERDUE },
          { id: 'inv_canc', number: 'INV-CANC-1', amount: 5000, outstanding: 5000, dueDate: pastDate, status: InvoiceStatus.CANCELLED },
        ],
        payments: [],
      });

      const res = await service.processChat(mockAdminUser, {
        message: 'Show account for Sharma Industries',
      });

      // Total overdue must only sum the active overdue invoice (25,000), ignoring the cancelled 5,000
      expect(res.reply).toContain('Total Overdue Amount:** ₹25,000');
      expect(res.reply).not.toContain('₹30,000');
    });
  });
});
