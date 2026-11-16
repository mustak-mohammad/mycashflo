import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ActionRisk, ProposalStatus, NotificationChannel, CasePriority, InvoiceStatus, ConsentState } from '@prisma/client';
import { IsOptional, IsString, IsBoolean, IsObject, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecuteToolDto {
  @ApiProperty({ example: 'get_customer_balance', description: 'Name of the tool to execute' })
  @IsString()
  toolName: string;

  @ApiProperty({ description: 'Tool parameters', example: { customerId: 'cust_123' } })
  @IsObject()
  parameters: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Whether explicit user confirmation is provided for consequential actions',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean = false;

  @ApiPropertyOptional({ description: 'Optional approved proposal ID to execute directly' })
  @IsOptional()
  @IsString()
  proposalId?: string;
}

export class RejectProposalDto {
  @ApiPropertyOptional({ description: 'Reason for rejecting this proposed action' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class IntelligenceChatDto {
  @ApiProperty({ example: 'What is the outstanding balance for Raj Enterprises?' })
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;
}

@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Catalog of all registered AI Tools with JSON Schema definitions.
   */
  getToolDefinitions() {
    return [
      {
        name: 'get_customer_balance',
        description: 'Fetch current outstanding balance, total overdue amount, and invoice counts for a customer.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'get_overdue_invoices',
        description: 'Retrieve all overdue invoices for a customer with amount, due date, and days overdue.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            minDaysOverdue: { type: 'number', description: 'Optional minimum days overdue' },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'get_customer_summary',
        description: 'Comprehensive 360° overview: customer profile, active cases, call history, payment promises, and notifications.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'create_follow_up_task',
        description: 'Schedule an internal follow-up task for an agent regarding a customer or collection case.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            title: { type: 'string', description: 'Task title' },
            dueDate: { type: 'string', description: 'Due date in ISO format' },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Priority level' },
            description: { type: 'string', description: 'Task description' },
          },
          required: ['customerId', 'title', 'dueDate'],
        },
      },
      {
        name: 'record_payment_promise',
        description: 'Record a formal Promise-to-Pay (PTP) commitment with promised amount, target date, and automatic confirmation notice.',
        isConsequential: true,
        riskLevel: ActionRisk.HIGH,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            invoiceId: { type: 'string', description: 'Invoice ID' },
            promisedAmount: { type: 'number', description: 'Amount committed by customer' },
            promisedDate: { type: 'string', description: 'Date of promised payment in ISO format' },
            notes: { type: 'string', description: 'Additional notes or payment mode' },
          },
          required: ['customerId', 'invoiceId', 'promisedAmount', 'promisedDate'],
        },
      },
      {
        name: 'dispute_invoice',
        description: 'Log an invoice dispute, escalate case priority to HIGH, and send formal dispute acknowledgment to the customer.',
        isConsequential: true,
        riskLevel: ActionRisk.MEDIUM,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            invoiceId: { type: 'string', description: 'Invoice ID under dispute' },
            reason: { type: 'string', description: 'Reason for dispute' },
            notes: { type: 'string', description: 'Additional context' },
          },
          required: ['customerId', 'invoiceId', 'reason'],
        },
      },
      {
        name: 'dispatch_reminder',
        description: 'Dispatch a multi-channel collection reminder (WhatsApp, SMS, or Email) to the customer.',
        isConsequential: true,
        riskLevel: ActionRisk.MEDIUM,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            channel: { type: 'string', enum: ['WHATSAPP', 'EMAIL', 'SMS'], description: 'Channel' },
            template: { type: 'string', description: 'Template identifier' },
            payload: { type: 'object', description: 'Template parameters' },
          },
          required: ['customerId', 'channel', 'template'],
        },
      },
      {
        name: 'record_cease_contact',
        description: 'Record customer cease-contact / do-not-contact (DND) request, stopping further automated outreach calls.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            reason: { type: 'string', description: 'Reason or statement for ceasing contact' },
            channel: { type: 'string', description: 'Channel preference (default ALL)' },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'create_customer',
        description: 'Create a new customer account with name, phone, optional email, company, and tax details. Requires human confirmation.',
        isConsequential: true,
        riskLevel: ActionRisk.MEDIUM,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Customer or business name' },
            phone: { type: 'string', description: 'Primary phone number' },
            email: { type: 'string', description: 'Optional email address' },
            company: { type: 'string', description: 'Optional company name' },
            customerReference: { type: 'string', description: 'Optional customer internal code/ref' },
            gstNumber: { type: 'string', description: 'Optional GSTIN / Tax identifier' },
            billingAddress: { type: 'string', description: 'Optional billing address' },
          },
          required: ['name', 'phone'],
        },
      },
      {
        name: 'customize_dashboard',
        description: 'Update and save tenant dashboard preferences (visible/hidden widgets, date range, aging threshold) without modifying financial records.',
        isConsequential: false,
        riskLevel: ActionRisk.LOW,
        parameters: {
          type: 'object',
          properties: {
            hiddenWidgets: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of widget IDs to hide (e.g. aging_breakdown, recent_payments)',
            },
            dateRange: {
              type: 'string',
              enum: ['all', '30d', '90d', 'this_month', 'this_year'],
              description: 'Dashboard date filter',
            },
            agingThreshold: {
              type: 'number',
              description: 'Overdue aging threshold in days (e.g. 15, 30, 45, 60)',
            },
          },
        },
      },
    ];
  }

  /**
   * Tool Execution Router with Consequential Action Confirmation Guard.
   */
  async executeTool(user: AuthUser, dto: ExecuteToolDto) {
    const { toolName, parameters, confirmed } = dto;
    const { tenantId, userId } = user;

    const tools = this.getToolDefinitions();
    const toolDef = tools.find((t) => t.name === toolName);

    if (!toolDef) {
      throw new BadRequestException(`Unknown AI tool: '${toolName}'`);
    }

    // ── Consequential Action Confirmation Check ──────────────────────────────
    if (toolDef.isConsequential && !confirmed) {
      // Generate Human-in-the-Loop Action Proposal
      const summary = this.generateActionSummary(toolName, parameters);

      const proposal = await this.prisma.actionProposal.create({
        data: {
          tenantId,
          toolName,
          actionType: toolName,
          parameters,
          summary,
          riskLevel: toolDef.riskLevel,
          status: ProposalStatus.PENDING,
          proposedBy: 'CHOTU_AI',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours expiry
        },
      });

      // Audit log proposal creation
      await this.auditLogs.log({
        tenantId,
        userId,
        action: 'ai.action_proposed',
        entityType: 'ActionProposal',
        entityId: proposal.id,
        metadata: { toolName, riskLevel: toolDef.riskLevel, summary },
      });

      return {
        status: 'REQUIRES_CONFIRMATION',
        toolName,
        proposal,
        message: `Action requires human confirmation (${toolDef.riskLevel} risk): ${summary}`,
      };
    }

    // ── Execute the Tool ─────────────────────────────────────────────────────
    let result: any;
    switch (toolName) {
      case 'get_customer_balance':
        result = await this.toolGetCustomerBalance(tenantId, parameters.customerId);
        break;

      case 'get_overdue_invoices':
        result = await this.toolGetOverdueInvoices(
          tenantId,
          parameters.customerId,
          parameters.minDaysOverdue,
        );
        break;

      case 'get_customer_summary':
        result = await this.toolGetCustomerSummary(tenantId, parameters.customerId);
        break;

      case 'create_follow_up_task':
        result = await this.toolCreateFollowUpTask(user, parameters);
        break;

      case 'record_payment_promise':
        result = await this.toolRecordPaymentPromise(user, parameters);
        break;

      case 'dispute_invoice':
        result = await this.toolDisputeInvoice(user, parameters);
        break;

      case 'dispatch_reminder':
        result = await this.toolDispatchReminder(user, parameters);
        break;

      case 'record_cease_contact':
        result = await this.toolRecordCeaseContact(user, parameters);
        break;

      case 'create_customer':
        result = await this.toolCreateCustomer(user, parameters);
        break;

      case 'customize_dashboard':
        result = await this.toolCustomizeDashboard(user, parameters);
        break;

      default:
        throw new BadRequestException(`Tool implementation missing for '${toolName}'`);
    }

    // Audit log successful tool execution
    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'ai.tool_executed',
      entityType: toolDef.isConsequential ? 'ConsequentialAction' : 'Query',
      metadata: {
        toolName,
        isConsequential: toolDef.isConsequential,
        confirmed: !!confirmed,
        parameters,
      },
    });

    return {
      status: 'SUCCESS',
      toolName,
      result,
      message: `Tool '${toolName}' executed successfully.`,
    };
  }

  // ── Tool Implementations ───────────────────────────────────────────────────

  private async toolGetCustomerBalance(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        invoices: {
          where: {
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
            outstanding: { gt: 0 },
          },
        },
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    const now = new Date();
    const overdueInvoices = customer.invoices.filter(
      (inv: any) =>
        inv.status !== InvoiceStatus.CANCELLED &&
        inv.status !== InvoiceStatus.PAID &&
        inv.status !== InvoiceStatus.DRAFT &&
        Number(inv.outstanding) > 0 &&
        (inv.status === InvoiceStatus.OVERDUE || new Date(inv.dueDate) < now),
    );
    const overdueAmount = overdueInvoices.reduce((acc, inv) => acc + Number(inv.outstanding), 0);

    return {
      customerId: customer.id,
      customerName: customer.name,
      company: customer.company,
      phone: customer.phone,
      email: customer.email,
      currency: customer.currency,
      outstandingBalance: Number(customer.outstandingBalance),
      totalOverdueAmount: overdueAmount,
      openInvoiceCount: customer.invoices.length,
      overdueInvoiceCount: overdueInvoices.length,
      status: customer.status,
    };
  }

  private async toolGetOverdueInvoices(tenantId: string, customerId: string, minDaysOverdue = 0) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const now = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customerId,
        tenantId,
        status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
        outstanding: { gt: 0 },
        OR: [{ status: InvoiceStatus.OVERDUE }, { dueDate: { lt: now } }],
      },
      orderBy: { dueDate: 'asc' },
    });

    const results = invoices
      .map((inv) => {
        const daysOverdue = Math.max(
          1,
          Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
        );
        return {
          id: inv.id,
          number: inv.number,
          amount: Number(inv.amount),
          outstanding: Number(inv.outstanding),
          currency: inv.currency,
          status: inv.status,
          dueDate: inv.dueDate,
          daysOverdue,
          description: inv.description,
        };
      })
      .filter((inv) => inv.daysOverdue >= minDaysOverdue);

    return {
      customerId,
      customerName: customer.name,
      overdueCount: results.length,
      invoices: results,
    };
  }

  private async toolGetCustomerSummary(tenantId: string, customerId: string) {
    const [customer, collectionCases, calls, promises, notifications] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, tenantId },
      }),
      this.prisma.collectionCase.findMany({
        where: { customerId, tenantId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { followUpTasks: { where: { done: false } } },
      }),
      this.prisma.callSession.findMany({
        where: { customerId, tenantId },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
      this.prisma.paymentPromise.findMany({
        where: { invoice: { customerId, tenantId } },
        orderBy: { promisedDate: 'desc' },
        take: 5,
      }),
      this.prisma.notification.findMany({
        where: { customerId, tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    if (!customer) throw new NotFoundException('Customer not found');

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        company: customer.company,
        outstandingBalance: Number(customer.outstandingBalance),
        currency: customer.currency,
      },
      recentCases: collectionCases,
      recentCalls: calls,
      recentPromises: promises,
      recentNotifications: notifications,
    };
  }

  private async toolCreateFollowUpTask(user: AuthUser, params: any) {
    const { tenantId, userId } = user;
    const customer = await this.prisma.customer.findFirst({
      where: { id: params.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const priority = (params.priority as CasePriority) || CasePriority.MEDIUM;
    const task = await this.prisma.followUpTask.create({
      data: {
        customerId: params.customerId,
        collectionCaseId: params.collectionCaseId,
        assignedTo: userId,
        title: params.title,
        description: params.description,
        dueDate: new Date(params.dueDate),
        priority,
        tenantId,
      },
    });

    return task;
  }

  private async toolRecordPaymentPromise(user: AuthUser, params: any) {
    const { tenantId, userId } = user;
    const [customer, invoice] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: params.customerId, tenantId } }),
      this.prisma.invoice.findFirst({ where: { id: params.invoiceId, tenantId } }),
    ]);

    if (!customer) throw new NotFoundException('Customer not found');
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(`Cannot record promise to pay for an invoice with status ${invoice.status}`);
    }

    // Create payment promise
    const promise = await this.prisma.paymentPromise.create({
      data: {
        invoiceId: invoice.id,
        promisedAmount: params.promisedAmount,
        promisedDate: new Date(params.promisedDate),
        notes: params.notes,
        tenantId,
      },
    });

    // Schedule automated follow-up task on the promised date
    await this.prisma.followUpTask.create({
      data: {
        customerId: customer.id,
        assignedTo: userId,
        title: `PTP Check: ₹${Number(params.promisedAmount).toLocaleString('en-IN')} for ${invoice.number}`,
        description: `Verify receipt of payment committed by ${customer.name}. Notes: ${params.notes ?? 'None'}`,
        dueDate: new Date(params.promisedDate),
        priority: CasePriority.HIGH,
        tenantId,
      },
    });

    // Dispatch PTP confirmation notification to customer
    try {
      await this.notifications.dispatch(user, {
        customerId: customer.id,
        channel: NotificationChannel.WHATSAPP,
        template: 'PTP_CONFIRMATION',
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          promisedAmount: params.promisedAmount,
          promisedDate: params.promisedDate,
        },
      });
    } catch (e) {
      console.warn('[IntelligenceService] Could not dispatch PTP notification:', e);
    }

    return {
      paymentPromise: promise,
      message: `Recorded Promise-to-Pay of ₹${Number(params.promisedAmount).toLocaleString('en-IN')} due ${new Date(params.promisedDate).toLocaleDateString('en-IN')}`,
    };
  }

  private async toolDisputeInvoice(user: AuthUser, params: any) {
    const { tenantId } = user;
    const [customer, invoice] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: params.customerId, tenantId } }),
      this.prisma.invoice.findFirst({ where: { id: params.invoiceId, tenantId } }),
    ]);

    if (!customer) throw new NotFoundException('Customer not found');
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(`Cannot dispute an invoice with status ${invoice.status}`);
    }

    // Create or update collection case for dispute
    let colCase = await this.prisma.collectionCase.findFirst({
      where: { invoiceId: invoice.id, tenantId },
    });

    if (colCase) {
      colCase = await this.prisma.collectionCase.update({
        where: { id: colCase.id },
        data: {
          priority: CasePriority.HIGH,
          notes: `[DISPUTE LOGGED]: ${params.reason}. ${params.notes ?? ''}\nPrevious notes: ${colCase.notes ?? ''}`,
        },
      });
    } else {
      colCase = await this.prisma.collectionCase.create({
        data: {
          customerId: customer.id,
          invoiceId: invoice.id,
          priority: CasePriority.HIGH,
          notes: `[DISPUTE LOGGED]: ${params.reason}. ${params.notes ?? ''}`,
          tenantId,
        },
      });
    }

    // Dispatch dispute acknowledgment notification
    try {
      await this.notifications.dispatch(user, {
        customerId: customer.id,
        channel: NotificationChannel.EMAIL,
        template: 'DISPUTE_ACKNOWLEDGMENT',
        payload: {
          invoiceNumber: invoice.number,
          reason: params.reason,
        },
      });
    } catch (e) {
      console.warn('[IntelligenceService] Could not dispatch dispute notification:', e);
    }

    return {
      collectionCase: colCase,
      message: `Dispute logged for invoice ${invoice.number}: "${params.reason}"`,
    };
  }

  private async toolDispatchReminder(user: AuthUser, params: any) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: params.customerId, tenantId: user.tenantId },
    });
    if (customer?.notes?.includes('DND:NO_CONTACT')) {
      throw new BadRequestException('Outreach suppressed: Customer has an active Do-Not-Contact (cease-contact) preference');
    }

    return this.notifications.dispatch(user, {
      customerId: params.customerId,
      channel: params.channel,
      template: params.template,
      payload: params.payload,
    });
  }

  private async toolRecordCeaseContact(user: AuthUser, params: any) {
    const { tenantId, userId } = user;
    if (!params.customerId) {
      throw new BadRequestException('customerId is required to record cease contact');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: params.customerId, tenantId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found in tenant');
    }

    const timestamp = new Date().toISOString();
    const reasonText = params.reason ? `: ${params.reason}` : '';
    const dndTag = `[DND:NO_CONTACT${reasonText} - Recorded on ${timestamp}]`;
    const updatedNotes = customer.notes ? `${dndTag}\n${customer.notes}` : dndTag;

    const channel = (params.channel || 'ALL').toUpperCase();
    const consentUpdate: any = {};
    const now = new Date();
    if (channel === 'WHATSAPP' || channel === 'ALL') {
      consentUpdate.whatsappConsent = ConsentState.OPTED_OUT;
      consentUpdate.whatsappConsentAt = now;
      consentUpdate.whatsappConsentSource = 'CHOTU_CEASE_CONTACT';
    }
    if (channel === 'EMAIL' || channel === 'ALL') {
      consentUpdate.emailConsent = ConsentState.OPTED_OUT;
      consentUpdate.emailConsentAt = now;
      consentUpdate.emailConsentSource = 'CHOTU_CEASE_CONTACT';
    }
    if (channel === 'SMS' || channel === 'ALL') {
      consentUpdate.smsConsent = ConsentState.OPTED_OUT;
      consentUpdate.smsConsentAt = now;
      consentUpdate.smsConsentSource = 'CHOTU_CEASE_CONTACT';
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        notes: updatedNotes,
        ...consentUpdate,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'customer.cease_contact_recorded',
      entityType: 'Customer',
      entityId: customer.id,
      metadata: {
        reason: params.reason || 'Cease contact requested',
        recordedAt: timestamp,
        channel: params.channel || 'ALL',
      },
    });

    return {
      success: true,
      customerId: customer.id,
      dndActive: true,
      contactPreference: 'NO_CONTACT',
      recordedAt: timestamp,
      notes: updatedCustomer.notes,
    };
  }

  private async toolCreateCustomer(user: AuthUser, params: any) {
    const { tenantId, userId } = user;
    if (!params.name || typeof params.name !== 'string' || !params.name.trim()) {
      throw new BadRequestException('Customer name is required');
    }
    if (!params.phone || typeof params.phone !== 'string' || !params.phone.trim()) {
      throw new BadRequestException('Customer phone number is required');
    }

    const trimmedName = params.name.trim();
    const trimmedPhone = params.phone.trim();
    const trimmedEmail = params.email && typeof params.email === 'string' ? params.email.trim() : null;

    // Check duplicate phone or email in this tenant
    const existing = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          { phone: trimmedPhone },
          ...(trimmedEmail ? [{ email: trimmedEmail }] : []),
        ],
      },
    });

    if (existing) {
      throw new BadRequestException(
        `A customer with phone '${trimmedPhone}'${trimmedEmail ? ` or email '${trimmedEmail}'` : ''} already exists in this tenant`,
      );
    }

    const customer = await this.prisma.customer.create({
      data: {
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail,
        company: params.company && typeof params.company === 'string' ? params.company.trim() : null,
        customerReference: params.customerReference && typeof params.customerReference === 'string' ? params.customerReference.trim() : null,
        gstNumber: params.gstNumber && typeof params.gstNumber === 'string' ? params.gstNumber.trim().toUpperCase() : null,
        billingAddress: params.billingAddress && typeof params.billingAddress === 'string' ? params.billingAddress.trim() : null,
        outstandingBalance: 0,
        currency: 'INR',
        status: 'ACTIVE',
        tenantId,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'ai.customer_created',
      entityType: 'Customer',
      entityId: customer.id,
      metadata: {
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        company: customer.company,
      },
    });

    return {
      customer,
      message: `Customer "${customer.name}" created successfully.`,
    };
  }

  private async toolCustomizeDashboard(user: AuthUser, params: any) {
    const { tenantId, userId } = user;

    // Financial records are strictly read-only and will NEVER be touched by dashboard customization
    const existingConfig = await this.prisma.integrationConfig.findFirst({
      where: { tenantId, provider: 'DASHBOARD_PREFERENCES' },
    });

    const currentConfig = (existingConfig?.config as any) || {};
    const updatedPreferences = {
      hiddenWidgets: params.hiddenWidgets !== undefined ? params.hiddenWidgets : (currentConfig.hiddenWidgets || []),
      dateRange: params.dateRange || currentConfig.dateRange || 'all',
      agingThreshold: params.agingThreshold !== undefined ? Number(params.agingThreshold) : (currentConfig.agingThreshold || 30),
      customPreferences: params.customPreferences || currentConfig.customPreferences || {},
      updatedAt: new Date().toISOString(),
    };

    let configRecord;
    if (existingConfig) {
      configRecord = await this.prisma.integrationConfig.update({
        where: { id: existingConfig.id },
        data: { config: updatedPreferences },
      });
    } else {
      configRecord = await this.prisma.integrationConfig.create({
        data: {
          tenantId,
          provider: 'DASHBOARD_PREFERENCES',
          config: updatedPreferences,
          isEnabled: true,
        },
      });
    }

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'ai.dashboard_customized',
      entityType: 'IntegrationConfig',
      entityId: configRecord.id,
      metadata: { preferences: updatedPreferences },
    });

    return {
      preferences: updatedPreferences,
      message: 'Dashboard preferences updated successfully without modifying financial records.',
    };
  }

  // ── Action Proposals Management ────────────────────────────────────────────

  async getPendingProposals(user: AuthUser) {
    return this.prisma.actionProposal.findMany({
      where: {
        tenantId: user.tenantId,
        status: ProposalStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllProposals(user: AuthUser) {
    return this.prisma.actionProposal.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async approveProposal(id: string, user: AuthUser) {
    const proposal = await this.prisma.actionProposal.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!proposal) {
      throw new NotFoundException('Action proposal not found');
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(`Proposal is already ${proposal.status}`);
    }

    // Execute the underlying action with confirmed: true
    const execution = await this.executeTool(user, {
      toolName: proposal.toolName,
      parameters: proposal.parameters as any,
      confirmed: true,
      proposalId: proposal.id,
    });

    // Mark proposal executed
    const updated = await this.prisma.actionProposal.update({
      where: { id: proposal.id },
      data: {
        status: ProposalStatus.EXECUTED,
        reviewedBy: user.userId,
        executedAt: new Date(),
        result: execution.result ?? {},
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'ai.action_approved_and_executed',
      entityType: 'ActionProposal',
      entityId: proposal.id,
      metadata: {
        toolName: proposal.toolName,
        parameters: proposal.parameters,
        executedBy: user.userId,
      },
    });

    return {
      proposal: updated,
      execution,
    };
  }

  async rejectProposal(id: string, user: AuthUser, dto: RejectProposalDto) {
    const proposal = await this.prisma.actionProposal.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!proposal) {
      throw new NotFoundException('Action proposal not found');
    }

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(`Proposal is already ${proposal.status}`);
    }

    const updated = await this.prisma.actionProposal.update({
      where: { id: proposal.id },
      data: {
        status: ProposalStatus.REJECTED,
        reviewedBy: user.userId,
        rejectionReason: dto.reason ?? 'Rejected by supervisor/agent',
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'ai.action_rejected',
      entityType: 'ActionProposal',
      entityId: proposal.id,
      metadata: {
        toolName: proposal.toolName,
        reason: dto.reason,
        rejectedBy: user.userId,
      },
    });

    return updated;
  }

  // ── Natural Language Collections Assistant ──────────────────────────────────

  async chat(user: AuthUser, dto: IntelligenceChatDto) {
    const { tenantId } = user;
    const query = dto.message.toLowerCase();

    // 1. Intent recognition & tool routing: Add Customer Action (Consequential, requires confirmation)
    if (query.includes('add customer') || query.includes('create customer') || query.includes('new customer')) {
      const nameMatch = dto.message.match(/(?:add|create|new)\s+customer\s+([A-Za-z0-9\s&.-]+?)(?:\s+with|\s+phone|\s+email|$)/i);
      const phoneMatch = dto.message.match(/phone\s*[:=]?\s*([+0-9\s-]{10,15})/i);
      const emailMatch = dto.message.match(/email\s*[:=]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

      const extractedName = nameMatch ? nameMatch[1].trim() : '';
      const extractedPhone = phoneMatch ? phoneMatch[1].trim().replace(/\s+/g, '') : '';
      const extractedEmail = emailMatch ? emailMatch[1].trim() : '';

      if (!extractedName || !extractedPhone) {
        return {
          reply: "To add a new customer, please provide at least the customer's name and phone number (e.g. 'Add customer Acme Corp with phone +919876543210 and email contact@acme.com'). All additions require your explicit review and confirmation before being created.",
          toolCalled: null,
          data: null,
        };
      }

      const proposalResult = await this.executeTool(user, {
        toolName: 'create_customer',
        parameters: {
          name: extractedName,
          phone: extractedPhone,
          email: extractedEmail || undefined,
        },
        confirmed: false,
      });

      return {
        reply: `I have prepared a proposal to add customer "${extractedName}". Because this modifies tenant records, please review and confirm the action below before it takes effect.`,
        toolCalled: 'create_customer',
        actionProposal: proposalResult.proposal,
        requiresConfirmation: true,
        data: proposalResult,
      };
    }

    // 2. Intent recognition & tool routing: Dashboard Customization & Filtering (Read-only on financials)
    if (
      query.includes('filter dashboard') ||
      query.includes('dashboard filter') ||
      query.includes('aging threshold') ||
      query.includes('hide widget') ||
      query.includes('show widget') ||
      query.includes('customize dashboard')
    ) {
      let dateRange: string | undefined;
      if (query.includes('30d') || query.includes('30 days')) dateRange = '30d';
      else if (query.includes('90d') || query.includes('90 days')) dateRange = '90d';
      else if (query.includes('month')) dateRange = 'this_month';
      else if (query.includes('year')) dateRange = 'this_year';
      else if (query.includes('all')) dateRange = 'all';

      let agingThreshold: number | undefined;
      const thresholdMatch = query.match(/(\d+)\s*days?/);
      if (thresholdMatch) {
        agingThreshold = parseInt(thresholdMatch[1], 10);
      }

      const result = await this.executeTool(user, {
        toolName: 'customize_dashboard',
        parameters: {
          dateRange,
          agingThreshold,
        },
        confirmed: true,
      });

      return {
        reply: `Updated dashboard preferences (date filter: ${dateRange || 'default'}, aging threshold: ${agingThreshold || 30} days). No financial records were modified.`,
        toolCalled: 'customize_dashboard',
        data: result.result,
      };
    }

    // 3. Identify customer if not passed explicitly
    let customer: any = null;
    if (dto.customerId) {
      customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      });
    }

    if (!customer) {
      const allCustomers = (await this.prisma.customer.findMany({ where: { tenantId } })) || [];
      customer = allCustomers.find(
        (c: any) =>
          query.includes(c.name.toLowerCase()) ||
          (c.company && query.includes(c.company.toLowerCase())),
      );
    }

    // 4. Customer-specific queries
    if (customer) {
      if (
        query.includes('balance') ||
        query.includes('due') ||
        query.includes('how much') ||
        query.includes('outstanding')
      ) {
        const bal = await this.toolGetCustomerBalance(tenantId, customer.id);
        return {
          reply: `${customer.name} has a total outstanding balance of ₹${bal.outstandingBalance.toLocaleString('en-IN')}, of which ₹${bal.totalOverdueAmount.toLocaleString('en-IN')} is currently overdue across ${bal.overdueInvoiceCount} invoice(s).`,
          toolCalled: 'get_customer_balance',
          data: bal,
        };
      }

      if (query.includes('overdue') || query.includes('invoices')) {
        const overdue = await this.toolGetOverdueInvoices(tenantId, customer.id);
        const invSummary = overdue.invoices
          .map((i) => `• ${i.number}: ₹${i.outstanding.toLocaleString('en-IN')} (${i.daysOverdue} days overdue)`)
          .join('\n');
        return {
          reply: `Found ${overdue.overdueCount} overdue invoice(s) for ${customer.name}:\n${invSummary || 'None!'}`,
          toolCalled: 'get_overdue_invoices',
          data: overdue,
        };
      }

      if (query.includes('summary') || query.includes('profile') || query.includes('history')) {
        const summary = await this.toolGetCustomerSummary(tenantId, customer.id);
        return {
          reply: `Account Summary for ${customer.name}:\nOutstanding: ₹${summary.customer.outstandingBalance.toLocaleString('en-IN')}\nRecent Calls: ${summary.recentCalls.length}\nPromises: ${summary.recentPromises.length}`,
          toolCalled: 'get_customer_summary',
          data: summary,
        };
      }
    }

    // Fallback response with helpful guide
    return {
      reply:
        "I'm Chotu Intelligence. You can ask me to look up customer balances, overdue invoices, account summaries, customize your dashboard view (e.g., 'filter dashboard for 30 days'), or add new customers (e.g., 'Add customer Acme Corp with phone +919876543210').",
      toolCalled: null,
      data: null,
    };
  }

  private generateActionSummary(toolName: string, params: any): string {
    switch (toolName) {
      case 'create_customer':
        return `Add new customer "${params.name}" (Phone: ${params.phone || 'N/A'}, Email: ${params.email || 'N/A'}, Company: ${params.company || 'N/A'})`;

      case 'customize_dashboard':
        return `Update dashboard preferences without modifying financial records (dateRange: ${params.dateRange || 'unchanged'}, agingThreshold: ${params.agingThreshold || 'unchanged'})`;

      case 'record_payment_promise':
        const amount = params.promisedAmount ? `₹${Number(params.promisedAmount).toLocaleString('en-IN')}` : 'unspecified amount';
        const date = params.promisedDate ? new Date(params.promisedDate).toLocaleDateString('en-IN') : 'agreed date';
        return `Record a formal Promise-to-Pay of ${amount} scheduled for ${date} on invoice ${params.invoiceId}`;

      case 'dispute_invoice':
        return `Mark invoice ${params.invoiceId} as Disputed: "${params.reason ?? 'Billing query'}"`;

      case 'dispatch_reminder':
        return `Dispatch ${params.channel} reminder (${params.template}) to customer ${params.customerId}`;

      default:
        return `Execute action '${toolName}' with parameters: ${JSON.stringify(params)}`;
    }
  }
}
