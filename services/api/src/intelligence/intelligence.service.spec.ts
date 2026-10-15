import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceService } from './intelligence.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ProposalStatus, ActionRisk } from '@prisma/client';

describe('IntelligenceService', () => {
  let service: IntelligenceService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let mockNotifications: any;

  const mockUser: AuthUser = {
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'ADMIN',
  };

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      invoice: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      collectionCase: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      followUpTask: {
        create: vi.fn(),
      },
      paymentPromise: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      callSession: {
        findMany: vi.fn(),
      },
      notification: {
        findMany: vi.fn(),
      },
      actionProposal: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    mockNotifications = {
      dispatch: vi.fn().mockResolvedValue({ id: 'notif_1', status: 'DELIVERED' }),
    };

    service = new IntelligenceService(
      mockPrisma as PrismaService,
      mockAuditLogs as AuditLogsService,
      mockNotifications as NotificationsService,
    );
  });

  describe('Tool Catalog', () => {
    it('returns a comprehensive catalog of AI tools with schemas and consequential flags', () => {
      const tools = service.getToolDefinitions();
      expect(tools.length).toBeGreaterThanOrEqual(5);

      const balanceTool = tools.find((t) => t.name === 'get_customer_balance');
      expect(balanceTool).toBeDefined();
      expect(balanceTool?.isConsequential).toBe(false);

      const ptpTool = tools.find((t) => t.name === 'record_payment_promise');
      expect(ptpTool).toBeDefined();
      expect(ptpTool?.isConsequential).toBe(true);
      expect(ptpTool?.riskLevel).toBe(ActionRisk.HIGH);

      const disputeTool = tools.find((t) => t.name === 'dispute_invoice');
      expect(disputeTool).toBeDefined();
      expect(disputeTool?.isConsequential).toBe(true);
    });
  });

  describe('Read-Only AI Tool: get_customer_balance', () => {
    it('executes directly without requiring confirmation', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        name: 'Raj Enterprises',
        company: 'Raj Enterprises',
        phone: '+91 98765 43210',
        email: 'billing@rajent.in',
        currency: 'INR',
        outstandingBalance: 145000,
        status: 'ACTIVE',
        invoices: [
          { id: 'inv_1', amount: 85000, outstanding: 85000, dueDate: new Date(Date.now() - 86400000) },
          { id: 'inv_2', amount: 60000, outstanding: 60000, dueDate: new Date(Date.now() + 86400000) },
        ],
      });

      const response = await service.executeTool(mockUser, {
        toolName: 'get_customer_balance',
        parameters: { customerId: 'cust_1' },
      });

      expect(response.status).toBe('SUCCESS');
      expect(response.result.customerName).toBe('Raj Enterprises');
      expect(response.result.outstandingBalance).toBe(145000);
      expect(response.result.overdueInvoiceCount).toBe(1);
      expect(response.result.totalOverdueAmount).toBe(85000);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.tool_executed' }),
      );
    });
  });

  describe('Consequential AI Tool Confirmation Guard', () => {
    it('blocks execution of consequential action when confirmed=false and creates ActionProposal', async () => {
      mockPrisma.actionProposal.create.mockResolvedValue({
        id: 'prop_123',
        actionType: 'record_payment_promise',
        toolName: 'record_payment_promise',
        parameters: {
          customerId: 'cust_1',
          invoiceId: 'inv_1',
          promisedAmount: 50000,
          promisedDate: '2026-10-25T00:00:00Z',
        },
        summary: 'Record a formal Promise-to-Pay of ₹50,000 scheduled for 25/10/2026 on invoice inv_1',
        riskLevel: ActionRisk.HIGH,
        status: ProposalStatus.PENDING,
      });

      const response = await service.executeTool(mockUser, {
        toolName: 'record_payment_promise',
        parameters: {
          customerId: 'cust_1',
          invoiceId: 'inv_1',
          promisedAmount: 50000,
          promisedDate: '2026-10-25T00:00:00Z',
        },
        confirmed: false,
      });

      expect(response.status).toBe('REQUIRES_CONFIRMATION');
      expect(response.proposal).toBeDefined();
      expect(mockPrisma.actionProposal.create).toHaveBeenCalled();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.action_proposed' }),
      );
      // Payment promise should NOT have been created yet
      expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
    });

    it('executes consequential action when confirmed=true', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Raj Enterprises' });
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv_1', number: 'INV-2024-001' });
      mockPrisma.paymentPromise.create.mockResolvedValue({
        id: 'promise_1',
        invoiceId: 'inv_1',
        promisedAmount: 50000,
        promisedDate: new Date('2026-10-25'),
      });
      mockPrisma.followUpTask.create.mockResolvedValue({ id: 'task_1' });

      const response = await service.executeTool(mockUser, {
        toolName: 'record_payment_promise',
        parameters: {
          customerId: 'cust_1',
          invoiceId: 'inv_1',
          promisedAmount: 50000,
          promisedDate: '2026-10-25T00:00:00Z',
        },
        confirmed: true,
      });

      expect(response.status).toBe('SUCCESS');
      expect(mockPrisma.paymentPromise.create).toHaveBeenCalled();
      expect(mockPrisma.followUpTask.create).toHaveBeenCalled();
      expect(mockNotifications.dispatch).toHaveBeenCalledWith(
        mockUser,
        expect.objectContaining({ template: 'PTP_CONFIRMATION' }),
      );
    });
  });

  describe('Approval Workflow', () => {
    it('approves and executes a pending action proposal', async () => {
      mockPrisma.actionProposal.findFirst.mockResolvedValue({
        id: 'prop_123',
        tenantId: 'tenant_1',
        toolName: 'record_payment_promise',
        parameters: {
          customerId: 'cust_1',
          invoiceId: 'inv_1',
          promisedAmount: 50000,
          promisedDate: '2026-10-25T00:00:00Z',
        },
        status: ProposalStatus.PENDING,
      });

      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Raj Enterprises' });
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv_1', number: 'INV-2024-001' });
      mockPrisma.paymentPromise.create.mockResolvedValue({ id: 'promise_1' });
      mockPrisma.followUpTask.create.mockResolvedValue({ id: 'task_1' });
      mockPrisma.actionProposal.update.mockResolvedValue({
        id: 'prop_123',
        status: ProposalStatus.EXECUTED,
      });

      const res = await service.approveProposal('prop_123', mockUser);
      expect(res.proposal.status).toBe(ProposalStatus.EXECUTED);
      expect(mockPrisma.paymentPromise.create).toHaveBeenCalled();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.action_approved_and_executed' }),
      );
    });

    it('rejects a pending proposal with reason', async () => {
      mockPrisma.actionProposal.findFirst.mockResolvedValue({
        id: 'prop_123',
        tenantId: 'tenant_1',
        toolName: 'record_payment_promise',
        status: ProposalStatus.PENDING,
      });
      mockPrisma.actionProposal.update.mockResolvedValue({
        id: 'prop_123',
        status: ProposalStatus.REJECTED,
      });

      const res = await service.rejectProposal('prop_123', mockUser, { reason: 'Incorrect customer' });
      expect(res.status).toBe(ProposalStatus.REJECTED);
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.action_rejected' }),
      );
    });
  });
});
