import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ChotuChatRequestDto, ChotuChatResponseDto } from './dto/chotu-chat.dto.js';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class ChotuService {
  private readonly logger = new Logger(ChotuService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main conversational entry point for Chotu Chatbot.
   * Enforces strict read-only behavior, tenant isolation, and RBAC scoping.
   */
  async processChat(user: AuthUser, dto: ChotuChatRequestDto): Promise<ChotuChatResponseDto> {
    const rawMessage = (dto.message || '').trim();
    if (!rawMessage) {
      throw new BadRequestException('Message cannot be empty or whitespace only');
    }
    const conversationId = dto.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const queryLower = rawMessage.toLowerCase();

    // ── 1. Safety Guard: Reject all mutation & outreach requests ──────────────
    const mutationRefusal = this.checkMutationAttempt(queryLower, user);
    if (mutationRefusal) {
      return {
        reply: mutationRefusal.reply,
        suggestedQuestions: mutationRefusal.suggestedQuestions,
        conversationId,
        suggestedRoute: mutationRefusal.suggestedRoute,
      };
    }

    // ── 2. Determine RBAC Scoping for the user ────────────────────────────────
    const agentAssignedCustomerIds = user.role === 'AGENT' ? await this.getAgentAssignedCustomerIds(user) : null;

    // ── 3. Check for record context (selectedRecordId or customer/invoice in query) ──
    const recordContext = await this.resolveRecordContext(user, dto, agentAssignedCustomerIds);

    // If an agent specifically asked about an unassigned customer
    if (user.role === 'AGENT' && recordContext?.unauthorizedForAgent) {
      return {
        reply: `🔒 **Access Restricted**\n\nAs a Collection Agent, you are only authorized to query your assigned collection accounts. Customer **"${recordContext.customerName}"** is not currently assigned to you.\n\nPlease navigate to **Collections** or check with your team manager for assigned accounts.`,
        suggestedQuestions: [
          'Which assigned customers need follow-up?',
          'Which of my assigned invoices are overdue?',
          'Explain my collection performance.',
        ],
        conversationId,
        dataUnavailable: true,
        suggestedRoute: '/collections',
      };
    }

    // ── 4. Route query to specialized read-only handler ───────────────────────

    // A. Specific Customer Detail or Payment History Query
    if (recordContext?.customer) {
      return this.handleCustomerQuery(user, recordContext.customer, queryLower, conversationId);
    }

    // B. Specific Invoice Query
    if (recordContext?.invoice) {
      return this.handleInvoiceQuery(user, recordContext.invoice, queryLower, conversationId);
    }

    // C. Overdue Invoices List Query
    if (
      queryLower.includes('overdue') &&
      (queryLower.includes('invoice') || queryLower.includes('which') || queryLower.includes('list') || queryLower.includes('what'))
    ) {
      return this.handleOverdueInvoicesList(user, agentAssignedCustomerIds, conversationId);
    }

    // D. Overview of Outstanding Invoices / Receivables
    if (
      queryLower.includes('overview') ||
      queryLower.includes('outstanding') ||
      queryLower.includes('receivable') ||
      queryLower.includes('total due') ||
      queryLower.includes('summary of invoices')
    ) {
      return this.handleReceivablesOverview(user, agentAssignedCustomerIds, conversationId);
    }

    // E. Payment History & Verification Query
    if (queryLower.includes('payment') && (queryLower.includes('history') || queryLower.includes('recent') || queryLower.includes('received') || queryLower.includes('claim'))) {
      return this.handlePaymentHistoryOverview(user, agentAssignedCustomerIds, conversationId);
    }

    // F. Collections & Follow-Up Tasks Query
    if (
      queryLower.includes('follow') ||
      queryLower.includes('task') ||
      queryLower.includes('collection') ||
      queryLower.includes('performance') ||
      queryLower.includes('assigned')
    ) {
      return this.handleCollectionsAndFollowUps(user, agentAssignedCustomerIds, conversationId);
    }

    // G. Application Navigation & Feature Explanation Query
    if (
      queryLower.includes('how do i') ||
      queryLower.includes('where is') ||
      queryLower.includes('where can i') ||
      queryLower.includes('how to') ||
      queryLower.includes('navigate') ||
      queryLower.includes('setting') ||
      queryLower.includes('report') ||
      queryLower.includes('remind') ||
      queryLower.includes('user') ||
      queryLower.includes('help')
    ) {
      return this.handleNavigationGuidance(user, queryLower, dto.currentPage, conversationId);
    }

    // ── 5. Default General Assistant Response ─────────────────────────────────
    return this.handleGeneralGuidance(user, conversationId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Guard: Reject mutations and automated outreach (Phase 6)
  // ─────────────────────────────────────────────────────────────────────────────

  private checkMutationAttempt(query: string, user: AuthUser): { reply: string; suggestedQuestions: string[]; suggestedRoute?: string } | null {
    // If the user is asking an informational "How to" question about navigation/workflows, allow it to proceed to navigation guidance
    const isHowToQuestion =
      query.startsWith('how do i') ||
      query.startsWith('how can i') ||
      query.startsWith('how to') ||
      query.startsWith('where do i') ||
      query.startsWith('where can i') ||
      query.startsWith('where is');

    if (isHowToQuestion && (query.includes('setting') || query.includes('user') || query.includes('team') || query.includes('role') || query.includes('report') || query.includes('payment'))) {
      return null;
    }
    // Payment settlement or modification attempt
    if (
      /(?:mark|settle|reconcile).*(?:paid|settled|close)/i.test(query) ||
      /(?:change|deduct|alter|reset).*(?:balance|outstanding)/i.test(query) ||
      /(?:record|create|submit).*(?:payment|settlement)/i.test(query) ||
      /(?:reverse|refund).*(?:payment|transaction|charge)/i.test(query) ||
      query.includes('mark as paid') ||
      query.includes('mark paid')
    ) {
      const isAgent = user.role === 'AGENT';
      const actionAdvice = isAgent
        ? 'As a Collection Agent, you can submit verified payment claims via **Payments > "+ Submit Payment Claim"**. An administrator will review and verify the transaction receipt before balances are updated.'
        : 'To record payment collections, navigate to **Payments > "+ Record Payment"** where you can enter the transaction reference and amount to reconcile the invoice.';

      return {
        reply: `🛡️ **Read-Only Assistance Mode**\n\nI am Chotu, your read-only conversational assistant. I cannot directly modify financial balances, mark invoices as paid, or reverse transactions.\n\n${actionAdvice}`,
        suggestedQuestions: [
          'Give me an overview of outstanding invoices.',
          'Which invoices are overdue?',
          'How do I view payment records?',
        ],
        suggestedRoute: '/payments',
      };
    }

    // Direct customer outreach or communication attempt
    if (
      /(?:send|dispatch|trigger).*(?:reminder|whatsapp|email|sms|notification|message)/i.test(query) ||
      /(?:call|dial|phone).*(?:customer|client|debtor)/i.test(query) ||
      query.includes('send reminder') ||
      query.includes('send whatsapp')
    ) {
      return {
        reply: `🛡️ **Outreach Safety Guard**\n\nI cannot directly initiate phone calls, dispatch emails, or send WhatsApp messages from this chat session.\n\n• Automated reminder escalations can be managed under **Reminders** by Administrators.\n• Interactive voice calls can be initiated through **Chotu AI (Voice)** or recorded under **Call History**.`,
        suggestedQuestions: [
          'Which assigned customers need follow-up?',
          'Which invoices are overdue?',
          'Where do I find call history records?',
        ],
        suggestedRoute: user.role === 'ADMIN' ? '/reminders' : '/calls',
      };
    }

    // Record creation or deletion attempt
    if (
      /(?:create|add|new|insert|delete|drop|remove).*(?:customer|invoice|account|user|role|permission)/i.test(query) ||
      query.includes('create customer') ||
      query.includes('add customer')
    ) {
      return {
        reply: `🛡️ **Read-Only Assistance Mode**\n\nI cannot create, edit, or delete database records or alter user permissions.\n\n• To manage customers, navigate to **Customers**.\n• To manage invoices, navigate to **Invoices**.\n• To manage team members and roles (Administrators only), go to **Settings > Team & Roles**.`,
        suggestedQuestions: [
          'Give me an overview of outstanding invoices.',
          'How do I navigate to customers?',
          'Explain my collection performance.',
        ],
        suggestedRoute: '/customers',
      };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scoping & Record Context Resolution (Phase 4 & 5)
  // ─────────────────────────────────────────────────────────────────────────────

  private async getAgentAssignedCustomerIds(user: AuthUser): Promise<string[]> {
    const { tenantId, userId } = user;
    const [assignedCases, assignedTasks] = await Promise.all([
      this.prisma.collectionCase.findMany({
        where: { tenantId, assignedTo: userId },
        select: { customerId: true },
      }),
      this.prisma.followUpTask.findMany({
        where: { tenantId, assignedTo: userId },
        select: { customerId: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const c of (assignedCases || [])) {
      if (c?.customerId) ids.add(c.customerId);
    }
    for (const t of (assignedTasks || [])) {
      if (t?.customerId) ids.add(t.customerId);
    }
    return Array.from(ids);
  }

  private async resolveRecordContext(
    user: AuthUser,
    dto: ChotuChatRequestDto,
    agentCustomerIds: string[] | null,
  ): Promise<{
    customer?: any;
    invoice?: any;
    unauthorizedForAgent?: boolean;
    customerName?: string;
  } | null> {
    const { tenantId } = user;
    const query = dto.message.toLowerCase();

    // 1. Check selectedRecordId
    if (dto.selectedRecordId) {
      // Check customer
      const cust = await this.prisma.customer.findFirst({
        where: { id: dto.selectedRecordId, tenantId },
      });
      if (cust) {
        if (agentCustomerIds && !agentCustomerIds.includes(cust.id)) {
          return { unauthorizedForAgent: true, customerName: cust.name };
        }
        return { customer: cust };
      }

      // Check invoice
      const inv = await this.prisma.invoice.findFirst({
        where: { id: dto.selectedRecordId, tenantId },
        include: { customer: true },
      });
      if (inv) {
        if (agentCustomerIds && !agentCustomerIds.includes(inv.customerId)) {
          return { unauthorizedForAgent: true, customerName: inv.customer?.name || 'Customer' };
        }
        return { invoice: inv };
      }
    }

    // 2. Scan for customer names mentioned in query
    const customers = (await this.prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, name: true, company: true },
    })) || [];

    for (const c of customers) {
      const matchName = c.name && query.includes(c.name.toLowerCase());
      const matchComp = c.company && query.includes(c.company.toLowerCase());
      if (matchName || matchComp) {
        if (agentCustomerIds && !agentCustomerIds.includes(c.id)) {
          return { unauthorizedForAgent: true, customerName: c.name };
        }
        const fullCust = await this.prisma.customer.findUnique({
          where: { id: c.id },
          include: {
            invoices: { where: { outstanding: { gt: 0 } }, orderBy: { dueDate: 'asc' } },
            payments: { orderBy: { createdAt: 'desc' }, take: 5 },
          },
        });
        return { customer: fullCust };
      }
    }

    // 3. Scan for invoice numbers mentioned in query (e.g., INV-001 or INV-VAL-123)
    const invMatch = query.match(/\b(inv[-_\w\d]+)\b/i);
    if (invMatch) {
      const invNumber = invMatch[1].toUpperCase();
      const invoice = await this.prisma.invoice.findFirst({
        where: { tenantId, number: { equals: invNumber, mode: 'insensitive' } },
        include: { customer: true, payments: { orderBy: { createdAt: 'desc' } } },
      });
      if (invoice) {
        if (agentCustomerIds && !agentCustomerIds.includes(invoice.customerId)) {
          return { unauthorizedForAgent: true, customerName: invoice.customer?.name || 'Customer' };
        }
        return { invoice };
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Handlers (Phase 4)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handlers for customer balance, account status, and payment summary
   */
  private async handleCustomerQuery(
    user: AuthUser,
    customer: any,
    query: string,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const now = new Date();
    const balance = Number(customer.outstandingBalance || 0);
    const invoices = customer.invoices || (await this.prisma.invoice.findMany({
      where: { customerId: customer.id, tenantId: user.tenantId },
      orderBy: { dueDate: 'asc' },
    }));

    const overdueInvoices = invoices.filter((i: any) => Number(i.outstanding) > 0 && new Date(i.dueDate) < now);
    const totalOverdue = overdueInvoices.reduce((sum: number, i: any) => sum + Number(i.outstanding), 0);

    const payments = customer.payments || (await this.prisma.payment.findMany({
      where: { customerId: customer.id, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }));

    const statusBadge = customer.status === 'ACTIVE' ? '🟢 Active' : '⚪ Inactive (Outreach Suppressed)';

    let reply = `### 👤 Customer Overview: ${customer.name}\n\n`;
    if (customer.company) reply += `**Company:** ${customer.company}\n`;
    reply += `**Status:** ${statusBadge}\n`;
    reply += `**Total Outstanding Balance:** ₹${balance.toLocaleString('en-IN')}\n`;
    reply += `**Total Overdue Amount:** ₹${totalOverdue.toLocaleString('en-IN')} (${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'})\n\n`;

    if (overdueInvoices.length > 0) {
      reply += `**Overdue Invoices:**\n`;
      for (const inv of overdueInvoices.slice(0, 3)) {
        const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        reply += `• **${inv.number}**: ₹${Number(inv.outstanding).toLocaleString('en-IN')} (${days} days overdue, due ${new Date(inv.dueDate).toLocaleDateString('en-IN')})\n`;
      }
      if (overdueInvoices.length > 3) {
        reply += `• *...and ${overdueInvoices.length - 3} more overdue invoices.*\n`;
      }
      reply += '\n';
    }

    if (payments.length > 0) {
      reply += `**Recent Payments & Claims:**\n`;
      for (const p of payments.slice(0, 3)) {
        const dateStr = p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : new Date(p.createdAt).toLocaleDateString('en-IN');
        const isSim = p.providerRef && (p.providerRef.includes('mock') || p.providerRef.includes('sim') || p.providerRef.includes('cs_test_'));
        const simLabel = isSim ? ' *(Simulated Sandbox)*' : '';
        const statusLabel = p.notes && p.notes.includes('AWAITING_VERIFICATION') ? '⏳ Awaiting Verification' : p.status;
        reply += `• ₹${Number(p.amount).toLocaleString('en-IN')} via ${p.method} on ${dateStr} — [${statusLabel}]${simLabel}\n`;
      }
    } else {
      reply += `*No recent payments recorded for this customer.*\n`;
    }

    return {
      reply,
      suggestedQuestions: [
        `Show overdue invoices for ${customer.name}`,
        `What is the payment history for ${customer.name}?`,
        'Give me an overview of outstanding invoices.',
      ],
      conversationId,
      suggestedRoute: `/customers`,
    };
  }

  /**
   * Handlers for specific invoice queries
   */
  private async handleInvoiceQuery(
    user: AuthUser,
    invoice: any,
    query: string,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const now = new Date();
    const amount = Number(invoice.amount || 0);
    const outstanding = Number(invoice.outstanding || 0);
    const dueDate = new Date(invoice.dueDate);
    const isOverdue = outstanding > 0 && dueDate < now;
    const daysOverdue = isOverdue ? Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

    let reply = `### 🧾 Invoice Details: ${invoice.number}\n\n`;
    reply += `**Customer:** ${invoice.customer?.name || 'Customer'}\n`;
    reply += `**Status:** ${invoice.status}${isOverdue ? ` ⚠️ **OVERDUE** (${daysOverdue} days)` : ''}\n`;
    reply += `**Total Amount:** ₹${amount.toLocaleString('en-IN')}\n`;
    reply += `**Outstanding Balance:** ₹${outstanding.toLocaleString('en-IN')}\n`;
    reply += `**Due Date:** ${dueDate.toLocaleDateString('en-IN')}\n`;

    if (invoice.payments && invoice.payments.length > 0) {
      reply += `\n**Linked Payments:**\n`;
      for (const p of invoice.payments) {
        reply += `• Ref ${p.ref}: ₹${Number(p.amount).toLocaleString('en-IN')} (${p.status}) on ${new Date(p.createdAt).toLocaleDateString('en-IN')}\n`;
      }
    }

    return {
      reply,
      suggestedQuestions: [
        `Summarize ${invoice.customer?.name || 'this customer'}'s payment history.`,
        'Which other invoices are overdue?',
        'Give me an overview of outstanding invoices.',
      ],
      conversationId,
      suggestedRoute: `/invoices`,
    };
  }

  /**
   * Overdue invoices breakdown
   */
  private async handleOverdueInvoicesList(
    user: AuthUser,
    agentCustomerIds: string[] | null,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const now = new Date();
    const where: any = {
      tenantId: user.tenantId,
      outstanding: { gt: 0 },
      dueDate: { lt: now },
    };

    if (agentCustomerIds) {
      where.customerId = { in: agentCustomerIds };
    }

    const overdueInvoices = await this.prisma.invoice.findMany({
      where,
      include: { customer: { select: { name: true, company: true } } },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });

    const totalCount = await this.prisma.invoice.count({ where });

    if (overdueInvoices.length === 0) {
      return {
        reply: `🎉 **No Overdue Invoices!**\n\nAll current receivables within your ${user.role === 'AGENT' ? 'assigned accounts' : 'organization'} are up to date.`,
        suggestedQuestions: [
          'Give me an overview of outstanding invoices.',
          'Explain my collection performance.',
          'Which assigned customers need follow-up?',
        ],
        conversationId,
        suggestedRoute: '/invoices',
      };
    }

    const totalOverdue = overdueInvoices.reduce((acc, i) => acc + Number(i.outstanding), 0);
    const scopeLabel = user.role === 'AGENT' ? 'Your Assigned' : 'Tenant';

    let reply = `### ⚠️ ${scopeLabel} Overdue Invoices (${totalCount} Total)\n\n`;
    reply += `Here are the top overdue invoices requiring collection attention:\n\n`;

    for (const inv of overdueInvoices) {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      reply += `• **${inv.number}** — **${inv.customer?.name}**: ₹${Number(inv.outstanding).toLocaleString('en-IN')} (*${days} days overdue*, due ${new Date(inv.dueDate).toLocaleDateString('en-IN')})\n`;
    }

    if (totalCount > 10) {
      reply += `\n*...and ${totalCount - 10} additional overdue invoices. View the full list on the Invoices page.*`;
    }

    return {
      reply,
      suggestedQuestions: [
        'Give me an overview of outstanding invoices.',
        'Which assigned customers need follow-up?',
        'How do I generate an ageing report?',
      ],
      conversationId,
      suggestedRoute: '/invoices',
    };
  }

  /**
   * Overview of all receivables and outstanding balances
   */
  private async handleReceivablesOverview(
    user: AuthUser,
    agentCustomerIds: string[] | null,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const now = new Date();
    const where: any = { tenantId: user.tenantId, outstanding: { gt: 0 } };

    if (agentCustomerIds) {
      where.customerId = { in: agentCustomerIds };
    }

    const openInvoices = await this.prisma.invoice.findMany({
      where,
      select: { outstanding: true, dueDate: true, status: true },
    });

    const totalReceivables = openInvoices.reduce((acc, i) => acc + Number(i.outstanding), 0);
    const overdueInvoices = openInvoices.filter((i) => new Date(i.dueDate) < now);
    const overdueAmount = overdueInvoices.reduce((acc, i) => acc + Number(i.outstanding), 0);
    const scopeLabel = user.role === 'AGENT' ? 'Your Assigned Accounts' : 'Entire Organization';

    const reply = `### 📊 Receivables Overview (${scopeLabel})\n\n` +
      `• **Total Open Invoices:** ${openInvoices.length}\n` +
      `• **Total Outstanding Receivables:** ₹${totalReceivables.toLocaleString('en-IN')}\n` +
      `• **Currently Overdue Amount:** ₹${overdueAmount.toLocaleString('en-IN')} (${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? '' : 's'})\n` +
      `• **Overdue Percentage:** ${totalReceivables > 0 ? ((overdueAmount / totalReceivables) * 100).toFixed(1) : 0}%\n\n` +
      `You can review detailed ageing buckets (0–30, 31–60, 61–90, 90+ days) on the **Reports** page.`;

    return {
      reply,
      suggestedQuestions: [
        'Which invoices are overdue?',
        'Which assigned customers need follow-up?',
        'How do I generate a report?',
      ],
      conversationId,
      suggestedRoute: '/reports',
    };
  }

  /**
   * Payment history overview
   */
  private async handlePaymentHistoryOverview(
    user: AuthUser,
    agentCustomerIds: string[] | null,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const where: any = { tenantId: user.tenantId };
    if (agentCustomerIds) {
      where.customerId = { in: agentCustomerIds };
    }

    const payments = await this.prisma.payment.findMany({
      where,
      include: { customer: { select: { name: true } }, invoice: { select: { number: true } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    if (payments.length === 0) {
      return {
        reply: `*No recent payments recorded within your authorized scope.*`,
        suggestedQuestions: ['Give me an overview of outstanding invoices.', 'Which invoices are overdue?'],
        conversationId,
        suggestedRoute: '/payments',
      };
    }

    let reply = `### 💳 Recent Payment Records\n\n`;
    for (const p of payments) {
      const isSim = p.providerRef && (p.providerRef.includes('mock') || p.providerRef.includes('sim') || p.providerRef.includes('cs_test_'));
      const simBadge = isSim ? ' *(Sandbox Simulation)*' : '';
      const isClaim = p.notes && p.notes.includes('AWAITING_VERIFICATION');
      const statusText = isClaim ? '⏳ Awaiting Verification' : p.status;
      const dateStr = p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : new Date(p.createdAt).toLocaleDateString('en-IN');

      reply += `• **${p.ref}** — **${p.customer?.name}**: ₹${Number(p.amount).toLocaleString('en-IN')} via ${p.method} on ${dateStr} [${statusText}]${simBadge}\n`;
    }

    return {
      reply,
      suggestedQuestions: [
        'Give me an overview of outstanding invoices.',
        'Which invoices are overdue?',
        'Explain my collection performance.',
      ],
      conversationId,
      suggestedRoute: '/payments',
    };
  }

  /**
   * Collections cases and follow-ups
   */
  private async handleCollectionsAndFollowUps(
    user: AuthUser,
    agentCustomerIds: string[] | null,
    conversationId: string,
  ): Promise<ChotuChatResponseDto> {
    const { tenantId, userId } = user;
    const isAgent = user.role === 'AGENT';

    const caseWhere: any = { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } };
    const taskWhere: any = { tenantId, done: false };

    if (isAgent) {
      caseWhere.assignedTo = userId;
      taskWhere.assignedTo = userId;
    }

    const [openCases, pendingTasks, recentCalls] = await Promise.all([
      this.prisma.collectionCase.findMany({
        where: caseWhere,
        include: { customer: { select: { name: true } } },
        orderBy: { priority: 'desc' },
        take: 5,
      }),
      this.prisma.followUpTask.findMany({
        where: taskWhere,
        include: { collectionCase: { include: { customer: { select: { name: true } } } } },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      this.prisma.callSession.findMany({
        where: isAgent ? { tenantId, userId } : { tenantId },
        orderBy: { startedAt: 'desc' },
        take: 3,
        include: { customer: { select: { name: true } } },
      }),
    ]);

    let reply = `### 📋 Collections & Follow-Up Status (${isAgent ? 'Your Assignments' : 'Organization Overview'})\n\n`;
    reply += `• **Active Collection Cases:** ${openCases.length}\n`;
    reply += `• **Pending Follow-Up Tasks:** ${pendingTasks.length}\n\n`;

    if (pendingTasks.length > 0) {
      reply += `**Upcoming Tasks Due:**\n`;
      for (const t of pendingTasks) {
        const cust = t.collectionCase?.customer?.name || 'Customer';
        reply += `• **${t.title}** for ${cust} (Priority: ${t.priority}, Due: ${new Date(t.dueDate).toLocaleDateString('en-IN')})\n`;
      }
      reply += '\n';
    }

    if (recentCalls.length > 0) {
      reply += `**Recent Voice Agent Interactions:**\n`;
      for (const c of recentCalls) {
        reply += `• ${c.customer?.name || 'Client'}: **${c.outcome || 'IN_PROGRESS'}** (${c.duration || 0}s on ${new Date(c.startedAt).toLocaleDateString('en-IN')})\n`;
      }
    }

    return {
      reply,
      suggestedQuestions: [
        'Which assigned customers need follow-up?',
        'Which invoices are overdue?',
        'Explain my collection performance.',
      ],
      conversationId,
      suggestedRoute: '/follow-ups',
    };
  }

  /**
   * Navigation and Feature Explanations
   */
  private handleNavigationGuidance(
    user: AuthUser,
    query: string,
    currentPage: string | undefined,
    conversationId: string,
  ): ChotuChatResponseDto {
    const isAgent = user.role === 'AGENT';

    if (query.includes('report') || query.includes('ageing') || query.includes('ledger')) {
      return {
        reply: `📊 **How to Access Reports**\n\n1. Click **Reports** in the left sidebar (or navigate to \`/reports\`).\n2. Select your desired view:\n   • **Ageing Breakdown**: View outstanding balances distributed across 0–30, 31–60, 61–90, and 90+ day buckets.\n   • **Summary**: Key performance indicators including recovery rates.\n   • **Customer Ledger**: Chronological debit/credit transaction history.\n3. Click **Export CSV** to download tabular data.`,
        suggestedQuestions: ['Give me an overview of outstanding invoices.', 'Which invoices are overdue?'],
        conversationId,
        suggestedRoute: '/reports',
      };
    }

    if (query.includes('setting') || query.includes('user') || query.includes('integration') || query.includes('team')) {
      if (isAgent) {
        return {
          reply: `🔒 **Settings & User Management Access**\n\nTeam user management, role assignments, and gateway integrations (Razorpay, Stripe, WhatsApp Cloud, SIP) are restricted to **Tenant Administrators**.\n\nAs a Collection Agent, you have access to your assigned **Dashboard**, **Customers**, **Invoices**, **Payments**, **Call History**, and **Follow-Ups**.`,
          suggestedQuestions: ['Which assigned customers need follow-up?', 'Explain my collection performance.'],
          conversationId,
        };
      } else {
        return {
          reply: `⚙️ **Managing Settings & Integrations**\n\n1. Click **Settings** in the left sidebar (\`/settings\`).\n2. Available tabs:\n   • **Team & Roles**: Invite users, assign roles (Admin, Manager, Agent), and manage active seats.\n   • **Payment Gateways**: Configure and test Razorpay and Stripe credentials with secret masking.\n   • **Communication Gateways**: Configure WhatsApp Cloud and Resend transactional email.\n   • **SIP Telephony**: Test outbound carrier connectivity and configure safety simulation policies.`,
          suggestedQuestions: ['How do I generate a report?', 'Give me an overview of outstanding invoices.'],
          conversationId,
          suggestedRoute: '/settings',
        };
      }
    }

    if (query.includes('payment') || query.includes('claim')) {
      const guidance = isAgent
        ? `💳 **Submitting Payment Claims**\n\n1. Navigate to **Payments** (\`/payments\`).\n2. Click the **"📥 Submit Payment Claim"** button.\n3. Enter the Invoice number, amount, payment date, and transaction reference (UTR).\n4. Provide the receipt or proof URL.\n5. The claim is saved as **Awaiting Verification** for an Admin to review.`
        : `💳 **Recording Payments & Verifying Claims**\n\n1. Navigate to **Payments** (\`/payments\`).\n2. Click **"+ Record Payment"** for direct invoice balance reconciliation.\n3. For pending Agent claims, click **"✓ Verify Claim"** to confirm the UTR receipt and settle invoice balances.`;

      return {
        reply: guidance,
        suggestedQuestions: ['Which invoices are overdue?', 'Summarize recent payment collections.'],
        conversationId,
        suggestedRoute: '/payments',
      };
    }

    // Default navigation overview
    return {
      reply: `🗺️ **myCashflo Platform Navigation**\n\n• **Dashboard**: High-level financial KPIs, cash flow metrics, and aging summaries.\n• **Customers**: Directory of customer accounts and individual ledger balances.\n• **Invoices**: Search, filter, and track invoices by due date and status.\n• **Payments**: View transaction history and record or claim payments.\n• **Collections**: Active cases, priority queues, and customer follow-up actions.\n• **Call History**: Review AI voice session summaries, transcripts, and audio recordings.\n• **Reports**: Overdue ageing analysis and customer ledgers.\n${isAgent ? '' : '• **Reminders**: Multi-channel escalation rules and dispatch previews.\n• **Settings**: Gateway integrations, team permissions, and audit logs.'}`,
      suggestedQuestions: [
        'Give me an overview of outstanding invoices.',
        'Which invoices are overdue?',
        'How do I generate a report?',
      ],
      conversationId,
    };
  }

  /**
   * General greeting and fallback
   */
  private handleGeneralGuidance(user: AuthUser, conversationId: string): ChotuChatResponseDto {
    const isAgent = user.role === 'AGENT';
    const suggestions = isAgent
      ? [
          'Which of my assigned invoices are overdue?',
          'Which assigned customers need follow-up?',
          'Explain my collection performance.',
          'How do I submit a payment claim?',
        ]
      : [
          'Give me an overview of outstanding invoices.',
          'Which invoices are overdue?',
          'Summarize recent payment collections.',
          'How do I generate a report?',
        ];

    return {
      reply: `👋 Hello! I am **Chotu AI**, your collections assistant for myCashflo.\n\nI can answer questions using verified system records about **customers, invoices, payment histories, and follow-ups**, explain platform features, and help you navigate the system.\n\nHow can I assist you today?`,
      suggestedQuestions: suggestions,
      conversationId,
    };
  }
}
