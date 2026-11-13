import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceService } from './intelligence.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ProposalStatus, ActionRisk, InvoiceStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

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
        create: vi.fn(),
        update: vi.fn(),
      },
      integrationConfig: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
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

  describe('Cease-Contact (NO_CONTACT) & Contact Preferences', () => {
    it('records cease-contact preference and updates customer notes with [DND:NO_CONTACT]', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        tenantId: 'tenant_1',
        name: 'Sharma Logistics',
        notes: 'Preferred contact by phone',
      });
      mockPrisma.customer.update.mockImplementation(async ({ data }) => ({
        id: 'cust_1',
        tenantId: 'tenant_1',
        name: 'Sharma Logistics',
        notes: data.notes,
      }));

      const response = await service.executeTool(mockUser, {
        toolName: 'record_cease_contact',
        parameters: {
          customerId: 'cust_1',
          reason: 'Customer explicitly requested to stop calling',
          channel: 'ALL',
        },
      });

      expect(response.status).toBe('SUCCESS');
      expect(response.result.dndActive).toBe(true);
      expect(response.result.contactPreference).toBe('NO_CONTACT');
      expect(mockPrisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust_1' },
          data: expect.objectContaining({
            notes: expect.stringContaining('[DND:NO_CONTACT: Customer explicitly requested to stop calling'),
          }),
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'customer.cease_contact_recorded' }),
      );
    });

    it('enforces tenant isolation and throws NotFoundException when customer belongs to another tenant', async () => {
      // Customer does not exist in mockUser.tenantId
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.executeTool(mockUser, {
          toolName: 'record_cease_contact',
          parameters: {
            customerId: 'cust_cross_tenant',
            reason: 'Stop calling',
          },
        }),
      ).rejects.toThrow('Customer not found in tenant');
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
    });

    it('suppresses automated outreach reminders when customer has active [DND:NO_CONTACT] preference', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_1',
        tenantId: 'tenant_1',
        name: 'Sharma Logistics',
        notes: '[DND:NO_CONTACT - Recorded on 2026-10-19]\nPrevious notes',
      });

      await expect(
        service.executeTool(mockUser, {
          toolName: 'dispatch_reminder',
          parameters: {
            customerId: 'cust_1',
            channel: 'WHATSAPP',
            template: 'PAYMENT_REMINDER_OVERDUE',
          },
          confirmed: true,
        }),
      ).rejects.toThrow('Outreach suppressed: Customer has an active Do-Not-Contact (cease-contact) preference');

      expect(mockNotifications.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('Consequential Customer Creation (create_customer)', () => {
    it('creates an ActionProposal and blocks execution when confirmed is false', async () => {
      mockPrisma.actionProposal.create.mockResolvedValue({
        id: 'prop_cust_1',
        toolName: 'create_customer',
        parameters: { name: 'Acme Traders', phone: '+91 99887 76655', email: 'acme@traders.in' },
        summary: 'Add new customer "Acme Traders" (Phone: +91 99887 76655, Email: acme@traders.in, Company: N/A)',
        riskLevel: ActionRisk.MEDIUM,
        status: ProposalStatus.PENDING,
      });

      const response = await service.executeTool(mockUser, {
        toolName: 'create_customer',
        parameters: { name: 'Acme Traders', phone: '+91 99887 76655', email: 'acme@traders.in' },
        confirmed: false,
      });

      expect(response.status).toBe('REQUIRES_CONFIRMATION');
      expect(response.proposal).toBeDefined();
      expect(mockPrisma.actionProposal.create).toHaveBeenCalled();
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.action_proposed' }),
      );
    });

    it('creates customer in tenant and audit logs when confirmed is true', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null); // No duplicate
      mockPrisma.customer.create.mockResolvedValue({
        id: 'cust_new_1',
        name: 'Acme Traders',
        phone: '+91 99887 76655',
        email: 'acme@traders.in',
        tenantId: mockUser.tenantId,
        outstandingBalance: 0,
        status: 'ACTIVE',
      });

      const response = await service.executeTool(mockUser, {
        toolName: 'create_customer',
        parameters: { name: 'Acme Traders', phone: '+91 99887 76655', email: 'acme@traders.in' },
        confirmed: true,
      });

      expect(response.status).toBe('SUCCESS');
      expect(response.result.customer.id).toBe('cust_new_1');
      expect(mockPrisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Acme Traders',
            phone: '+91 99887 76655',
            email: 'acme@traders.in',
            tenantId: mockUser.tenantId,
          }),
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.customer_created' }),
      );
    });

    it('rejects creation when duplicate phone or email exists within tenant', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust_existing',
        phone: '+91 99887 76655',
      });

      await expect(
        service.executeTool(mockUser, {
          toolName: 'create_customer',
          parameters: { name: 'Acme Traders', phone: '+91 99887 76655' },
          confirmed: true,
        }),
      ).rejects.toThrow(/already exists in this tenant/);
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('Dashboard Customization & Preferences (customize_dashboard)', () => {
    it('updates tenant dashboard preferences without modifying financial records', async () => {
      mockPrisma.integrationConfig.findFirst.mockResolvedValue(null);
      mockPrisma.integrationConfig.create.mockResolvedValue({
        id: 'config_1',
        tenantId: mockUser.tenantId,
        provider: 'DASHBOARD_PREFERENCES',
        config: {
          hiddenWidgets: ['recent_payments'],
          dateRange: '30d',
          agingThreshold: 45,
        },
      });

      const response = await service.executeTool(mockUser, {
        toolName: 'customize_dashboard',
        parameters: {
          hiddenWidgets: ['recent_payments'],
          dateRange: '30d',
          agingThreshold: 45,
        },
        confirmed: false, // Non-consequential, runs immediately
      });

      expect(response.status).toBe('SUCCESS');
      expect(response.result.preferences.dateRange).toBe('30d');
      expect(response.result.preferences.agingThreshold).toBe(45);
      expect(response.result.preferences.hiddenWidgets).toContain('recent_payments');
      // Verify NO financial entities are written
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
      expect(mockPrisma.customer.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.dashboard_customized' }),
      );
    });
  });

  describe('Natural Language Chat Intent Routing', () => {
    it('creates an action proposal preview when user asks to add a customer', async () => {
      mockPrisma.actionProposal.create.mockResolvedValue({
        id: 'prop_chat_1',
        toolName: 'create_customer',
        parameters: { name: 'Pooja Textiles', phone: '+919876500000', email: 'pooja@textiles.in' },
        summary: 'Add new customer "Pooja Textiles"',
        riskLevel: ActionRisk.MEDIUM,
        status: ProposalStatus.PENDING,
      });

      const response = await service.chat(mockUser, {
        message: 'Add customer Pooja Textiles with phone +919876500000 and email pooja@textiles.in',
      });

      expect(response.toolCalled).toBe('create_customer');
      expect(response.requiresConfirmation).toBe(true);
      expect(response.actionProposal).toBeDefined();
      expect(response.reply).toContain('Pooja Textiles');
    });

    it('customizes dashboard view when user asks to filter dashboard without modifying financial records', async () => {
      mockPrisma.integrationConfig.findFirst.mockResolvedValue(null);
      mockPrisma.integrationConfig.create.mockResolvedValue({
        id: 'config_chat_1',
        config: { dateRange: '30d', agingThreshold: 30 },
      });

      const response = await service.chat(mockUser, {
        message: 'Filter dashboard for 30 days',
      });

      expect(response.toolCalled).toBe('customize_dashboard');
      expect(response.reply).toContain('Updated dashboard preferences');
      expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('Cancelled Invoice Exclusion and Safety Guards', () => {
    it('queries active receivable statuses when fetching overdue invoices', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Raj Enterprises' });
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      const result = await (service as any).toolGetOverdueInvoices('tenant_1', 'cust_1');

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
            outstanding: { gt: 0 },
          }),
        }),
      );
      expect(result.invoices).toEqual([]);
    });

    it('rejects recording Promise-to-Pay for a CANCELLED invoice', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Raj Enterprises' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_canc',
        number: 'INV-CANCELLED-001',
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.executeTool(mockUser, {
          toolName: 'record_payment_promise',
          parameters: {
            customerId: 'cust_1',
            invoiceId: 'inv_canc',
            promisedAmount: 5000,
            promisedDate: '2026-12-01',
          },
          confirmed: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects disputing a CANCELLED invoice', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust_1', name: 'Raj Enterprises' });
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv_canc',
        number: 'INV-CANCELLED-001',
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.executeTool(mockUser, {
          toolName: 'dispute_invoice',
          parameters: {
            customerId: 'cust_1',
            invoiceId: 'inv_canc',
            reason: 'Billing calculation dispute',
          },
          confirmed: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
