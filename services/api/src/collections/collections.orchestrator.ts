import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { evaluateCustomerConsent } from '../common/consent-policy.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CasePriority, CaseStatus, NotificationChannel, NotifStatus } from '@prisma/client';

export interface OrchestrationOptions {
  dryRun?: boolean;
  channel?: NotificationChannel | 'AUTO';
  cooldownHours?: number; // Minimum hours between reminders for same invoice (default 24h)
  forceCooldown?: boolean;
}

export interface OrchestrationItemResult {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  daysOverdue: number;
  priority: CasePriority;
  action: 'DISPATCHED' | 'SUPPRESSED_DND' | 'SUPPRESSED_PROMISE' | 'SUPPRESSED_COOLDOWN' | 'RESOLVED_PAID';
  channel?: string;
  messageId?: string;
  reason?: string;
}

export interface OrchestrationReport {
  tenantId: string;
  dryRun: boolean;
  totalInvoicesEvaluated: number;
  overdueDetected: number;
  remindersDispatched: number;
  suppressedDnd: number;
  suppressedPromises: number;
  suppressedCooldown: number;
  resolvedPaid: number;
  items: OrchestrationItemResult[];
  timestamp: string;
}

@Injectable()
export class CollectionsOrchestrator {
  private readonly logger = new Logger(CollectionsOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Run the collections orchestration engine for the tenant:
   * 1. Detect overdue invoices and assign priority tiers.
   * 2. Re-check live payment status to prevent erroneous outreach.
   * 3. Respect active Promise to Pay (PTP) grace periods.
   * 4. Enforce strict customer contact permissions & [DND:NO_CONTACT] directives.
   * 5. Enforce 24-hour duplicate outreach prevention (cooldown window).
   * 6. Track delivery status and log full audit trail.
   */
  async orchestrate(
    user: AuthUser,
    options?: OrchestrationOptions,
  ): Promise<OrchestrationReport> {
    const { tenantId, userId } = user;
    const dryRun = options?.dryRun ?? false;
    const cooldownHours = options?.cooldownHours ?? 24;
    const forceCooldown = options?.forceCooldown ?? false;
    const preferredChannel = options?.channel ?? 'AUTO';

    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - cooldownHours * 3600 * 1000);

    const report: OrchestrationReport = {
      tenantId,
      dryRun,
      totalInvoicesEvaluated: 0,
      overdueDetected: 0,
      remindersDispatched: 0,
      suppressedDnd: 0,
      suppressedPromises: 0,
      suppressedCooldown: 0,
      resolvedPaid: 0,
      items: [],
      timestamp: now.toISOString(),
    };

    // ── 1. Query all open/overdue invoices for the tenant ──────────────────────
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      include: {
        customer: true,
        collectionCases: { take: 1, orderBy: { createdAt: 'desc' } },
        paymentPromises: { where: { status: 'PENDING' }, orderBy: { promisedDate: 'desc' }, take: 1 },
      },
      orderBy: { dueDate: 'asc' },
    });

    report.totalInvoicesEvaluated = invoices.length;

    for (const inv of invoices) {
      const customer = inv.customer;
      const outstandingAmt = Number(inv.outstanding);
      const isPastDue = inv.dueDate < now;
      const msDiff = now.getTime() - inv.dueDate.getTime();
      const daysOverdue = isPastDue ? Math.max(1, Math.floor(msDiff / (86400000))) : 0;

      // ── 2. Payment Recheck Before Action ──────────────────────────────────
      if (outstandingAmt <= 0) {
        // Invoice is already settled!
        if (inv.status !== 'PAID' && !dryRun) {
          await this.prisma.invoice.update({
            where: { id: inv.id },
            data: { status: 'PAID', outstanding: 0 },
          });
        }
        if (inv.collectionCases.length > 0 && inv.collectionCases[0].status !== 'RESOLVED' && !dryRun) {
          await this.prisma.collectionCase.update({
            where: { id: inv.collectionCases[0].id },
            data: { status: 'RESOLVED', resolvedAt: now },
          });
        }
        report.resolvedPaid++;
        report.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerId: customer.id,
          customerName: customer.name,
          amount: outstandingAmt,
          daysOverdue,
          priority: 'LOW',
          action: 'RESOLVED_PAID',
          reason: 'Live payment recheck confirmed balance is zero',
        });
        continue;
      }

      // If not past due, skip from collections escalation
      if (!isPastDue) {
        continue;
      }

      report.overdueDetected++;

      // Update invoice status to OVERDUE if currently OPEN
      if (inv.status === 'OPEN' && !dryRun) {
        await this.prisma.invoice.update({
          where: { id: inv.id },
          data: { status: 'OVERDUE' },
        });
      }

      // ── 3. Calculate Urgency Priority ──────────────────────────────────────
      let priority: CasePriority = CasePriority.LOW;
      if (daysOverdue > 60 || outstandingAmt >= 100000) {
        priority = CasePriority.URGENT;
      } else if (daysOverdue > 30 || outstandingAmt >= 50000) {
        priority = CasePriority.HIGH;
      } else if (daysOverdue > 15) {
        priority = CasePriority.MEDIUM;
      }

      // Ensure CollectionCase exists
      let collectionCase = inv.collectionCases[0];
      if (!collectionCase && !dryRun) {
        collectionCase = await this.prisma.collectionCase.create({
          data: {
            tenantId,
            customerId: customer.id,
            invoiceId: inv.id,
            status: CaseStatus.OPEN,
            priority,
            notes: `Auto-generated by Collections Orchestration. Days overdue: ${daysOverdue}.`,
          },
        });
      } else if (collectionCase && collectionCase.priority !== priority && !dryRun) {
        await this.prisma.collectionCase.update({
          where: { id: collectionCase.id },
          data: { priority },
        });
      }

      // ── 4. Channel Resolution & Centralized Consent Policy Guard ──────────
      let channelToUse: NotificationChannel = NotificationChannel.WHATSAPP;
      if (preferredChannel === 'EMAIL') channelToUse = NotificationChannel.EMAIL;
      else if (preferredChannel === 'SMS') channelToUse = NotificationChannel.SMS;
      else {
        // Auto routing: Prefer consented channel (WhatsApp if consented, otherwise Email if consented)
        const waConsent = evaluateCustomerConsent(customer, NotificationChannel.WHATSAPP);
        const emailConsent = evaluateCustomerConsent(customer, NotificationChannel.EMAIL);
        if (customer.phone && waConsent.allowed) {
          channelToUse = NotificationChannel.WHATSAPP;
        } else if (customer.email && emailConsent.allowed) {
          channelToUse = NotificationChannel.EMAIL;
        } else {
          channelToUse = customer.phone ? NotificationChannel.WHATSAPP : NotificationChannel.EMAIL;
        }
      }

      const consentEval = evaluateCustomerConsent(customer, channelToUse);
      if (!consentEval.allowed || customer?.status === 'INACTIVE') {
        report.suppressedDnd++;
        report.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerId: customer.id,
          customerName: customer.name,
          amount: outstandingAmt,
          daysOverdue,
          priority,
          action: 'SUPPRESSED_DND',
          channel: channelToUse,
          reason: consentEval.reason || 'Customer is marked INACTIVE in tenant records',
        });

        if (!dryRun) {
          await this.auditLogs.log({
            tenantId,
            userId,
            action: 'collections.contact_suppressed_dnd',
            entityType: 'Customer',
            entityId: customer.id,
            metadata: {
              invoiceNumber: inv.number,
              daysOverdue,
              channel: channelToUse,
              reason: consentEval.reason,
              classification: consentEval.classification,
              consentState: consentEval.consentState,
            },
          });
        }
        continue;
      }

      // ── 5. Active Promise to Pay (PTP) Grace Period ────────────────────────
      const activePromise = inv.paymentPromises[0];
      if (activePromise && activePromise.promisedDate >= now) {
        report.suppressedPromises++;
        const promiseDateStr = activePromise.promisedDate.toISOString().slice(0, 10);
        report.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerId: customer.id,
          customerName: customer.name,
          amount: outstandingAmt,
          daysOverdue,
          priority,
          action: 'SUPPRESSED_PROMISE',
          reason: `Customer commitment active until ${promiseDateStr}. Collection paused during grace period.`,
        });
        continue;
      }

      // ── 6. Duplicate Prevention / Cooldown Window ─────────────────────────
      if (!forceCooldown) {
        const recentNotification = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            customerId: customer.id,
            createdAt: { gte: cooldownCutoff },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (recentNotification) {
          report.suppressedCooldown++;
          report.items.push({
            invoiceId: inv.id,
            invoiceNumber: inv.number,
            customerId: customer.id,
            customerName: customer.name,
            amount: outstandingAmt,
            daysOverdue,
            priority,
            action: 'SUPPRESSED_COOLDOWN',
            reason: `Outreach sent within last ${cooldownHours}h (Recent ID: ${recentNotification.id}). Cooldown active.`,
          });
          continue;
        }
      }

      // ── 7. Action Execution / Delivery Tracking ────────────────────────────
      if (dryRun) {
        report.remindersDispatched++;
        report.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerId: customer.id,
          customerName: customer.name,
          amount: outstandingAmt,
          daysOverdue,
          priority,
          action: 'DISPATCHED',
          channel: channelToUse,
          messageId: 'dry_run_preview',
          reason: `Preview: reminder queued via ${channelToUse} for ₹${outstandingAmt.toLocaleString('en-IN')}`,
        });
        continue;
      }

      try {
        // Dispatch reminder via notifications service
        const dispatchResult = await this.notifications.dispatch(user, {
          customerId: customer.id,
          channel: channelToUse,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceNumber: inv.number,
            amount: outstandingAmt,
            daysOverdue,
            dueDate: inv.dueDate.toISOString().slice(0, 10),
          },
        });

        report.remindersDispatched++;
        const providerMsgId =
          (dispatchResult.payload as any)?.providerMessageId || dispatchResult.id;

        report.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerId: customer.id,
          customerName: customer.name,
          amount: outstandingAmt,
          daysOverdue,
          priority,
          action: 'DISPATCHED',
          channel: channelToUse,
          messageId: providerMsgId,
        });

        // Create follow-up task on collection case if present
        if (collectionCase) {
          const followUpDue = new Date(now.getTime() + 48 * 3600 * 1000); // 48h follow-up
          await this.prisma.followUpTask.create({
            data: {
              tenantId,
              collectionCaseId: collectionCase.id,
              customerId: customer.id,
              title: `Payment Follow-up (${channelToUse})`,
              description: `Automated reminder dispatched via ${channelToUse} (Msg ID: ${providerMsgId}). Follow up on payment receipt.`,
              dueDate: followUpDue,
            },
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch collection reminder for invoice ${inv.number}: ${err.message}`);
      }
    }

    // ── 8. Emit Orchestration Audit Trail ────────────────────────────────────
    if (!dryRun) {
      await this.auditLogs.log({
        tenantId,
        userId,
        action: 'collections.orchestrated',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: {
          overdueDetected: report.overdueDetected,
          remindersDispatched: report.remindersDispatched,
          suppressedDnd: report.suppressedDnd,
          suppressedPromises: report.suppressedPromises,
          suppressedCooldown: report.suppressedCooldown,
          resolvedPaid: report.resolvedPaid,
        },
      });
    }

    return report;
  }
}
