import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PromptsService } from '../prompts/prompts.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { InvoiceStatus, NotificationChannel, NotifStatus, ConsentState } from '@prisma/client';
import { evaluateCustomerConsent } from '../common/consent-policy.js';
import {
  getInvoiceReminderStage,
  calculateDaysUntilDue,
  classifyReminderStage,
  getTenantLocalDate,
} from './calendar-stage.util.js';
import type {
  TenantReminderSettings,
  UpdateReminderSettingsDto,
  ReminderStage,
  ReminderEvaluationItem,
  RemindersRunSummary,
  ReminderStatsSummary,
  SendTestReminderDto,
} from './reminders.types.js';
import { validateCompanyContactNumber } from '../integrations/adapters/whatsapp-cloud.adapter.js';

const CONFIG_PROVIDER_KEY = 'AUTOMATED_REMINDERS';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  // In-memory concurrency lock per tenant to prevent overlapping concurrent cron executions
  private readonly activeLocks = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly integrations: IntegrationsService,
    private readonly prompts: PromptsService,
  ) {}

  /**
   * Safe defaults for tenant automated reminder preferences
   */
  getDefaultSettings(): TenantReminderSettings {
    return {
      enabled: false,
      dryRun: true,
      channels: ['EMAIL'],
      channelPreference: 'EMAIL',
      scheduleCron: '0 10 * * *', // 10:00 AM daily
      timezone: 'Asia/Kolkata',
      quietHours: {
        startHour: 19, // 7 PM
        endHour: 9, // 9 AM
      },
      maxDailyPerCustomer: 1,
      minDaysBetweenReminders: 3,
      testRecipientEmail: process.env.EMAIL_TEST_RECIPIENT || 'delivered@resend.dev',
      testRecipientPhone: process.env.WHATSAPP_TEST_RECIPIENT || '919618954429',
      companyContactNumber: undefined,
    };
  }

  /**
   * Retrieve tenant reminder configuration and global status
   */
  async getSettings(tenantId: string): Promise<TenantReminderSettings & { globalEnabled: boolean }> {
    const globalEnabled = (process.env.AUTOMATED_REMINDERS_ENABLED || '').toLowerCase() === 'true';

    const record = await this.prisma.integrationConfig.findUnique({
      where: {
        provider_tenantId: {
          provider: CONFIG_PROVIDER_KEY,
          tenantId,
        },
      },
    });

    if (!record || !record.config) {
      return {
        ...this.getDefaultSettings(),
        globalEnabled,
      };
    }

    const saved = record.config as Record<string, any>;
    const defaults = this.getDefaultSettings();

    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
      dryRun: typeof saved.dryRun === 'boolean' ? saved.dryRun : defaults.dryRun,
      channels: Array.isArray(saved.channels) ? saved.channels : defaults.channels,
      channelPreference: saved.channelPreference || defaults.channelPreference,
      scheduleCron: saved.scheduleCron || defaults.scheduleCron,
      timezone: saved.timezone || defaults.timezone,
      quietHours: saved.quietHours || defaults.quietHours,
      maxDailyPerCustomer: saved.maxDailyPerCustomer ?? defaults.maxDailyPerCustomer,
      minDaysBetweenReminders: saved.minDaysBetweenReminders ?? defaults.minDaysBetweenReminders,
      testRecipientEmail: saved.testRecipientEmail || defaults.testRecipientEmail,
      testRecipientPhone: saved.testRecipientPhone || defaults.testRecipientPhone,
      companyContactNumber: saved.companyContactNumber || defaults.companyContactNumber,
      globalEnabled,
    };
  }

  /**
   * Update tenant reminder preferences
   */
  async updateSettings(tenantId: string, dto: UpdateReminderSettingsDto, userId: string = 'SYSTEM'): Promise<TenantReminderSettings> {
    const current = await this.getSettings(tenantId);

    const updated: TenantReminderSettings = {
      enabled: dto.enabled !== undefined ? dto.enabled : current.enabled,
      dryRun: dto.dryRun !== undefined ? dto.dryRun : current.dryRun,
      channelPreference: dto.channelPreference || current.channelPreference,
      channels:
        dto.channelPreference === 'BOTH'
          ? ['EMAIL', 'WHATSAPP']
          : dto.channelPreference === 'WHATSAPP'
            ? ['WHATSAPP']
            : ['EMAIL'],
      scheduleCron: current.scheduleCron,
      timezone: dto.timezone || current.timezone,
      quietHours: {
        startHour: dto.quietHoursStart ?? current.quietHours.startHour,
        endHour: dto.quietHoursEnd ?? current.quietHours.endHour,
      },
      maxDailyPerCustomer: dto.maxDailyPerCustomer ?? current.maxDailyPerCustomer,
      minDaysBetweenReminders: dto.minDaysBetweenReminders ?? current.minDaysBetweenReminders,
      testRecipientEmail: dto.testRecipientEmail !== undefined ? dto.testRecipientEmail : current.testRecipientEmail,
      testRecipientPhone: dto.testRecipientPhone !== undefined ? dto.testRecipientPhone : current.testRecipientPhone,
      companyContactNumber: dto.companyContactNumber !== undefined ? dto.companyContactNumber : current.companyContactNumber,
    };

    await this.prisma.integrationConfig.upsert({
      where: {
        provider_tenantId: {
          provider: CONFIG_PROVIDER_KEY,
          tenantId,
        },
      },
      create: {
        provider: CONFIG_PROVIDER_KEY,
        tenantId,
        isActive: updated.enabled,
        config: updated as any,
      },
      update: {
        isActive: updated.enabled,
        config: updated as any,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'reminders.settings_updated',
      entityType: 'IntegrationConfig',
      metadata: {
        enabled: updated.enabled,
        dryRun: updated.dryRun,
        channelPreference: updated.channelPreference,
        timezone: updated.timezone,
      },
    });

    return updated;
  }

  /**
   * Timezone and quiet hours check
   */
  isQuietHours(timezone: string, quietHours: { startHour: number; endHour: number }, date: Date = new Date()): boolean {
    let currentHour: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const hourPart = parts.find((p) => p.type === 'hour');
      currentHour = hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
    } catch {
      currentHour = date.getUTCHours();
    }

    const { startHour, endHour } = quietHours;
    if (startHour > endHour) {
      // Overnight quiet window: e.g. 19:00 to 09:00 (quiet between 7 PM and 9 AM)
      return currentHour >= startHour || currentHour < endHour;
    } else {
      // Daytime quiet window: e.g. 13:00 to 15:00
      return currentHour >= startHour && currentHour < endHour;
    }
  }

  /**
   * Get formatted local date string in tenant timezone (YYYY-MM-DD)
   */
  getLocalDateInTimezone(timezone: string, date: Date = new Date()): string {
    return getTenantLocalDate(date, timezone) ?? date.toISOString().split('T')[0];
  }

  /**
   * Map days overdue to reminder escalation stage.
   * Note: daysOverdue is -daysUntilDue (positive = overdue, negative = future, 0 = due today).
   * Invoices due in > 3 days (daysOverdue < -3) return null (not eligible).
   */
  calculateStage(daysOverdue: number): ReminderStage | null {
    const daysUntilDue = -daysOverdue;
    return classifyReminderStage(daysUntilDue);
  }

  /**
   * Format currency cleanly in Indian Rupee representation
   */
  formatAmount(amount: number | string): string {
    const num = Number(amount);
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  /**
   * Personalize concise, professional, and respectful reminders using verified details only.
   * Never invents amounts, links, or deadlines.
   */
  generateChotuReminderMessage(params: {
    stage: ReminderStage;
    channel: 'EMAIL' | 'WHATSAPP';
    customerName: string;
    invoiceNumber: string;
    amount: number;
    dueDate: Date;
    daysOverdue: number;
    companyName: string;
    paymentLink?: string;
    companyContactNumber?: string;
  }): { subject: string; message: string; template: string } {
    const {
      stage,
      channel,
      customerName,
      invoiceNumber,
      amount,
      dueDate,
      daysOverdue,
      companyName,
      paymentLink,
      companyContactNumber,
    } = params;
    const amountStr = this.formatAmount(amount);
    const dueDateStr = new Date(dueDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const payLinkText = paymentLink ? `\n\nDirect Payment Link: ${paymentLink}` : '';

    let template = 'PAYMENT_REMINDER_OVERDUE';
    let subject = `Notice from ${companyName}`;
    let message = '';

    switch (stage) {
      case 'DUE_SOON':
        template = 'PAYMENT_REMINDER_UPCOMING';
        subject = `Upcoming Payment Notice: Invoice ${invoiceNumber} — ${companyName}`;
        if (channel === 'WHATSAPP') {
          message = `*Upcoming Payment Reminder — ${companyName}*\n\nHello ${customerName},\nThis is a courtesy notice that invoice *${invoiceNumber}* for *${amountStr}* is due on *${dueDateStr}*.${payLinkText}\n\nKindly schedule payment clearance. Thank you for your continued partnership.\n\nAccounts & Finance, ${companyName}`;
        } else {
          message = `Dear ${customerName},\n\nWe hope this email finds you well.\n\nThis is a friendly reminder that invoice ${invoiceNumber} in the amount of ${amountStr} is scheduled for payment on ${dueDateStr}.\n\nIf you have already processed this remittance, please accept our thanks and disregard this notice.${payLinkText}\n\nWarm regards,\nAccounts Receivable Team\n${companyName}`;
        }
        break;

      case 'DUE_TODAY':
        template = 'PAYMENT_REMINDER_UPCOMING';
        subject = `Payment Due Today: Invoice ${invoiceNumber} — ${companyName}`;
        if (channel === 'WHATSAPP') {
          message = `*Payment Due Today — ${companyName}*\n\nDear ${customerName},\nInvoice *${invoiceNumber}* for *${amountStr}* is due for clearance today, *${dueDateStr}*.${payLinkText}\n\nPlease arrange remittance today to maintain uninterrupted credit terms.\n\nThank you,\nFinance & Accounts, ${companyName}`;
        } else {
          message = `Dear ${customerName},\n\nOur records indicate that payment for invoice ${invoiceNumber} in the amount of ${amountStr} is due today, ${dueDateStr}.${payLinkText}\n\nKindly ensure remittance is initiated today. For any billing queries, please reply directly to this message.\n\nSincerely,\nCredit Control Team\n${companyName}`;
        }
        break;

      case 'OVERDUE_STAGE_1':
        template = 'PAYMENT_REMINDER_OVERDUE';
        subject = `Friendly Reminder: Overdue Invoice ${invoiceNumber} — ${companyName}`;
        if (channel === 'WHATSAPP') {
          const contactSuffix = companyContactNumber
            ? `\n\nFor payment queries, contact our accounts desk at ${companyContactNumber}.`
            : '';
          message = `*Payment Reminder — ${companyName}*\n\nDear ${customerName},\nThis is a gentle reminder that invoice *${invoiceNumber}* for *${amountStr}* was due on *${dueDateStr}* and is currently *${daysOverdue} days overdue*.${payLinkText}${contactSuffix}\n\nPlease remit payment at your earliest convenience.\n\nThank you,\nAccounts Team, ${companyName}`;
        } else {
          message = `Dear ${customerName},\n\nWe would like to remind you that invoice ${invoiceNumber} in the amount of ${amountStr} was due on ${dueDateStr} and is currently ${daysOverdue} days overdue.${payLinkText}\n\nPlease confirm whether this invoice has been scheduled for payment. If already paid, kindly let us know so we can update our records.\n\nWarm regards,\nAccounts Receivable\n${companyName}`;
        }
        break;

      case 'OVERDUE_STAGE_2':
        template = 'PAYMENT_REMINDER_OVERDUE';
        subject = `Urgent Follow-Up: Invoice ${invoiceNumber} Overdue (${daysOverdue} Days) — ${companyName}`;
        if (channel === 'WHATSAPP') {
          const contactSuffix = companyContactNumber
            ? `\n\nPlease contact our credit desk at ${companyContactNumber} today to confirm remittance.`
            : '';
          message = `*Urgent Payment Reminder — ${companyName}*\n\nDear ${customerName},\nInvoice *${invoiceNumber}* for *${amountStr}* remains outstanding and is now *${daysOverdue} days past due*.${payLinkText}${contactSuffix}\n\nWe request your prompt remittance today or an update from your finance desk.\n\nCredit Control, ${companyName}`;
        } else {
          message = `Dear ${customerName},\n\nThis is a follow-up notice regarding invoice ${invoiceNumber} for ${amountStr}, which was due on ${dueDateStr} and is now ${daysOverdue} days overdue.${payLinkText}\n\nWe request that remittance be arranged immediately to ensure uninterrupted credit facilities. If there are any discrepancies with the invoice, please reach out to us at once.\n\nSincerely,\nCredit Management\n${companyName}`;
        }
        break;

      case 'OVERDUE_STAGE_3':
      default:
        template = 'PAYMENT_REMINDER_OVERDUE';
        subject = `Formal Notice: Overdue Account Balance (Invoice ${invoiceNumber}) — ${companyName}`;
        if (channel === 'WHATSAPP') {
          const contactSuffix = companyContactNumber
            ? `\n\nPlease contact accounts immediately at ${companyContactNumber} to confirm payment remittance and prevent account escalation.`
            : '\n\nPlease contact accounts immediately to confirm payment remittance and prevent account escalation.';
          message = `*Formal Credit Control Notice — ${companyName}*\n\nDear ${customerName},\nInvoice *${invoiceNumber}* in the amount of *${amountStr}* is significantly overdue (${daysOverdue} days).${payLinkText}${contactSuffix}\n\nSenior Credit Control, ${companyName}`;
        } else {
          message = `Dear ${customerName},\n\nDespite previous reminders, invoice ${invoiceNumber} in the amount of ${amountStr} remains unpaid and is now ${daysOverdue} days past the agreed payment date.${payLinkText}\n\nPlease remit the outstanding balance immediately or contact our credit control department today to discuss account settlement.\n\nRespectfully,\nSenior Credit Control Officer\n${companyName}`;
        }
        break;
    }

    return { subject, message, template };
  }

  /**
   * Evaluate invoices for a tenant and execute (or simulate in dry-run mode)
   */
  async evaluateTenantReminders(
    tenantId: string,
    options?: {
      force?: boolean;
      dryRunOverride?: boolean;
      specificInvoiceId?: string;
      userId?: string;
    },
  ): Promise<RemindersRunSummary> {
    // Acquire concurrency lock for this tenant
    if (this.activeLocks.has(tenantId)) {
      this.logger.warn(`Tenant ${tenantId} already has an active reminder run in progress. Skipping concurrent run.`);
      return {
        tenantId,
        evaluatedCount: 0,
        eligibleCount: 0,
        dispatchedCount: 0,
        suppressedCount: 0,
        failedCount: 0,
        isDryRun: true,
        globalEnabled: false,
        timestamp: new Date().toISOString(),
        items: [],
      };
    }

    this.activeLocks.add(tenantId);

    try {
      const now = new Date();
      const globalEnabled = (process.env.AUTOMATED_REMINDERS_ENABLED || '').toLowerCase() === 'true';
      const testMode = (process.env.REMINDERS_TEST_MODE || '').toLowerCase() === 'true';
      const settings = await this.getSettings(tenantId);
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });

      if (!tenant) {
        throw new NotFoundException(`Tenant ${tenantId} not found`);
      }

      const tenantContactNumber =
        (await this.notifications.getTenantContactNumber?.(tenantId)) || settings.companyContactNumber;

      // Safety check: Dry-run is unconditionally forced if global automation flag and test mode are both off.
      // Even if an explicit dryRunOverride=false is provided, bulk live dispatch is strictly forbidden when neither flag is active.
      const isDryRun = (!globalEnabled && !testMode)
        ? true
        : options?.dryRunOverride !== undefined
          ? options.dryRunOverride
          : settings.dryRun || !settings.enabled;

      const inQuietHours = this.isQuietHours(settings.timezone, settings.quietHours, now);
      const localDate = this.getLocalDateInTimezone(settings.timezone, now);

      // Query genuinely outstanding invoices directly from database
      const [invoices, totalTenantInvoices, settledInvoicesCount] = await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            tenantId,
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
            outstanding: { gt: 0 },
            ...(options?.specificInvoiceId ? { id: options.specificInvoiceId } : {}),
          },
          include: {
            customer: true,
          },
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.invoice.count({ where: { tenantId } }),
        this.prisma.invoice.count({
          where: {
            tenantId,
            OR: [
              { status: InvoiceStatus.PAID },
              { outstanding: 0 },
            ],
          },
        }),
      ]);

      const summary: RemindersRunSummary = {
        tenantId,
        evaluatedCount: invoices.length,
        eligibleCount: 0,
        dispatchedCount: 0,
        suppressedCount: 0,
        failedCount: 0,
        isDryRun,
        globalEnabled,
        timestamp: now.toISOString(),
        items: [],
        totalTenantInvoices,
        settledInvoicesCount,
      };

      // Track how many reminders we plan to send to each customer in this run
      const customerRunCounts = new Map<string, number>();

      for (const invoice of invoices) {
        // Evaluate reminder stage using tenant-timezone calendar-day logic
        const stage = getInvoiceReminderStage(invoice.dueDate, now, settings.timezone);

        // Invoices outside the upcoming reminder window (due in > 3 days) or with invalid dates/timezones
        // are explicitly not eligible and must be skipped before constructing idempotency keys or dispatching
        if (!stage) {
          continue;
        }

        const daysUntilDue = calculateDaysUntilDue(invoice.dueDate, now, settings.timezone) ?? 0;
        const daysOverdue = Math.max(0, -daysUntilDue);
        const outstandingAmount = Number(invoice.outstanding);

        // Persistent idempotency key per tenant, invoice, stage, and occurrence date
        const idempotencyKey = `rem_${tenantId}_${invoice.id}_${stage}_${localDate}`;

        const configuredPreference = settings.channelPreference;
        const item: ReminderEvaluationItem = {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customerId: invoice.customer.id,
          customerName: invoice.customer.name,
          customerEmail: invoice.customer.email,
          customerPhone: invoice.customer.phone,
          outstandingAmount,
          dueDate: invoice.dueDate.toISOString(),
          daysOverdue,
          stage,
          channel:
            configuredPreference === 'BOTH'
              ? 'BOTH'
              : configuredPreference === 'WHATSAPP'
                ? 'WHATSAPP'
                : 'EMAIL',
          idempotencyKey,
          isEligible: false,
          messagePreview: this.generateChotuReminderMessage({
            stage,
            channel: configuredPreference === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL',
            customerName: invoice.customer.name,
            invoiceNumber: invoice.number,
            amount: outstandingAmount,
            dueDate: invoice.dueDate,
            daysOverdue,
            companyName: tenant.name,
            companyContactNumber: tenantContactNumber,
          }),
        };

        // ── 1. Check Tenant & Channel Enablement ──────────────────────────────
        if (!settings.enabled && !options?.force) {
          item.suppressionReason = 'DISABLED_IN_SETTINGS';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        if (settings.channelPreference === 'DISABLED') {
          item.suppressionReason = 'CHANNELS_DISABLED';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // ── 2. Check Quiet Hours ─────────────────────────────────────────────
        if (inQuietHours && !options?.force) {
          item.suppressionReason = 'QUIET_HOURS';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // ── 3. Check Customer Status ─────────────────────────────────────────
        if (invoice.customer.status !== 'ACTIVE') {
          item.suppressionReason = 'CUSTOMER_INACTIVE';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // ── 4. Independent Per-Channel Consent & Recipient Evaluation ──────────
        const candidateChannels: NotificationChannel[] =
          configuredPreference === 'BOTH'
            ? [NotificationChannel.EMAIL, NotificationChannel.WHATSAPP]
            : configuredPreference === 'WHATSAPP'
              ? [NotificationChannel.WHATSAPP]
              : [NotificationChannel.EMAIL];

        const permittedChannels: NotificationChannel[] = [];
        const channelSuppressions = new Map<NotificationChannel, string>();

        for (const ch of candidateChannels) {
          // 4a. Independent Structured Consent Evaluation (Central Policy)
          const consentEval = evaluateCustomerConsent(invoice.customer, ch);
          if (!consentEval.allowed) {
            let reason: string;
            if (
              consentEval.classification !== 'NONE' ||
              (invoice.customer.notes &&
                (invoice.customer.notes.includes('DND:NO_CONTACT') ||
                  invoice.customer.notes.includes('OPT_OUT')))
            ) {
              reason = 'DND_NO_CONTACT';
            } else if (consentEval.consentState === ConsentState.OPTED_OUT) {
              reason = `OPTED_OUT_${ch}`;
            } else {
              reason = `CONSENT_UNKNOWN_${ch}`;
            }
            channelSuppressions.set(ch, reason);
            continue;
          }

          // 4b. Recipient Validity for Channel
          if (ch === NotificationChannel.EMAIL) {
            if (!invoice.customer.email || !invoice.customer.email.includes('@')) {
              channelSuppressions.set(ch, 'MISSING_OR_INVALID_EMAIL');
              continue;
            }
          } else if (ch === NotificationChannel.WHATSAPP) {
            const cleanPhone = (invoice.customer.phone || '').replace(/[^\d]/g, '');
            if (cleanPhone.length < 8) {
              channelSuppressions.set(ch, 'MISSING_OR_INVALID_PHONE');
              continue;
            }
            if (stage.startsWith('OVERDUE')) {
              const contactVal = validateCompanyContactNumber(tenantContactNumber, invoice.customer.phone);
              if (!contactVal.valid) {
                channelSuppressions.set(ch, 'MISSING_OR_INVALID_COMPANY_CONTACT_NUMBER');
                continue;
              }
            }
          }

          // 4c. Channel-Specific Idempotency Check for Today
          const channelIdempKey = `${idempotencyKey}_${ch}`;
          const existingIdemp = await this.prisma.notification.findFirst({
            where: {
              tenantId,
              channel: ch,
              status: { in: [NotifStatus.SENT, NotifStatus.DELIVERED, NotifStatus.QUEUED] },
              OR: [
                { payload: { path: ['channelIdempotencyKey'], equals: channelIdempKey } },
                { payload: { path: ['idempotencyKey'], equals: idempotencyKey } },
              ],
            },
          });

          if (existingIdemp) {
            channelSuppressions.set(ch, 'ALREADY_SENT_FOR_STAGE_TODAY');
            continue;
          }

          // Channel passed all recipient, consent, and idempotency checks!
          permittedChannels.push(ch);
        }

        // If no candidate channels are permitted, suppress the item entirely
        if (permittedChannels.length === 0) {
          const reasons = Array.from(new Set(channelSuppressions.values()));
          if (reasons.length === 1 && reasons[0] === 'DND_NO_CONTACT') {
            item.suppressionReason = 'DND_NO_CONTACT';
          } else if (reasons.length === 1 && reasons[0] === 'ALREADY_SENT_FOR_STAGE_TODAY') {
            item.suppressionReason = 'ALREADY_SENT_FOR_STAGE_TODAY';
          } else if (candidateChannels.length === 1) {
            item.suppressionReason = channelSuppressions.get(candidateChannels[0]) || 'CHANNEL_SUPPRESSED';
          } else {
            // BOTH channels suppressed with specific reasons
            item.suppressionReason = Array.from(channelSuppressions.entries())
              .map(([c, r]) => `${c}:${r}`)
              .join('; ');
          }
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // ── 5. Check Frequency Limits (Daily & Minimum Days Between Reminders) ─
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const customerRecentCount = await this.prisma.notification.count({
          where: {
            tenantId,
            customerId: invoice.customer.id,
            createdAt: { gte: oneDayAgo },
            status: { in: [NotifStatus.SENT, NotifStatus.DELIVERED] },
            NOT: { payload: { path: ['isTest'], equals: true } },
          },
        });

        const inRunCount = customerRunCounts.get(invoice.customer.id) || 0;
        if (customerRecentCount + inRunCount >= settings.maxDailyPerCustomer) {
          item.suppressionReason = 'FREQUENCY_LIMIT_DAILY';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        const minIntervalAgo = new Date(now.getTime() - settings.minDaysBetweenReminders * 24 * 60 * 60 * 1000);
        const invoiceRecentNotif = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            customerId: invoice.customer.id,
            payload: { path: ['invoiceId'], equals: invoice.id },
            createdAt: { gte: minIntervalAgo },
            status: { in: [NotifStatus.SENT, NotifStatus.DELIVERED] },
            NOT: { payload: { path: ['isTest'], equals: true } },
          },
        });

        if (invoiceRecentNotif) {
          item.suppressionReason = 'FREQUENCY_LIMIT_INTERVAL';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // ── 6. Recheck Payment Status Right Before Dispatch ──────────────────
        const freshInvoice = await this.prisma.invoice.findUnique({
          where: { id: invoice.id },
        });

        if (
          !freshInvoice ||
          Number(freshInvoice.outstanding) <= 0 ||
          freshInvoice.status === InvoiceStatus.PAID ||
          freshInvoice.status === InvoiceStatus.CANCELLED
        ) {
          item.suppressionReason = 'INVOICE_SETTLED';
          summary.suppressedCount++;
          summary.items.push(item);
          continue;
        }

        // Invoice is genuinely eligible for permitted channels!
        item.isEligible = true;
        summary.eligibleCount++;
        customerRunCounts.set(invoice.customer.id, inRunCount + 1);

        // ── 7. Prepare Chotu AI Message Preview with fresh outstanding ───────
        const primaryChannel = permittedChannels.includes(NotificationChannel.WHATSAPP)
          ? NotificationChannel.WHATSAPP
          : NotificationChannel.EMAIL;

        const preview = this.generateChotuReminderMessage({
          stage,
          channel: primaryChannel === NotificationChannel.WHATSAPP ? 'WHATSAPP' : 'EMAIL',
          customerName: invoice.customer.name,
          invoiceNumber: invoice.number,
          amount: Number(freshInvoice.outstanding),
          dueDate: freshInvoice.dueDate,
          daysOverdue,
          companyName: tenant.name,
          companyContactNumber: tenantContactNumber,
        });
        item.messagePreview = preview;

        // ── 8. Dispatch Execution or Dry-Run Simulation ──────────────────────
        if (isDryRun) {
          item.dispatchStatus = 'SIMULATED';
          summary.dispatchedCount++;
          summary.items.push(item);
        } else {
          // Live Dispatch Mode: Dispatch strictly to permitted channels
          let lastDispatchedNotif: any = null;
          let dispatchedSuccessCount = 0;
          let failedCountForInvoice = 0;
          const channelErrors: string[] = [];

          for (const ch of permittedChannels) {
            const testRecipient = testMode
              ? (ch === NotificationChannel.EMAIL
                  ? (settings.testRecipientEmail || process.env.EMAIL_TEST_RECIPIENT)
                  : (settings.testRecipientPhone || process.env.WHATSAPP_TEST_RECIPIENT))
              : undefined;

            try {
              const notif = await this.notifications.dispatch(
                {
                  tenantId,
                  userId: options?.userId || 'CHOTU_AI_AUTOMATION',
                  role: 'ADMIN',
                },
                {
                  customerId: invoice.customer.id,
                  channel: ch,
                  template: preview.template,
                  payload: {
                    idempotencyKey,
                    channelIdempotencyKey: `${idempotencyKey}_${ch}`,
                    customerName: invoice.customer.name,
                    companyName: tenant.name,
                    companyContactNumber: tenantContactNumber,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.number,
                    amount: Number(freshInvoice.outstanding),
                    dueDate: freshInvoice.dueDate,
                    daysOverdue,
                    stage,
                    reminderType: 'AUTOMATED_CHOTU',
                    isDryRun: false,
                    isTest: testMode,
                    testScope: testMode ? 'SCHEDULED_REMINDER_TEST' : undefined,
                    testRecipient,
                    persistSuppressed: true,
                  },
                },
              );

              lastDispatchedNotif = notif;
              if (notif.status === NotifStatus.FAILED) {
                failedCountForInvoice++;
                channelErrors.push(`${ch}: ${notif.failReason || 'Failed'}`);
              } else if (notif.status === NotifStatus.SUPPRESSED) {
                channelErrors.push(`${ch}: SUPPRESSED (${notif.failReason})`);
              } else {
                dispatchedSuccessCount++;
              }
            } catch (dispatchErr: any) {
              this.logger.error(`Failed to dispatch ${ch} reminder for invoice ${invoice.number}: ${dispatchErr.message}`);
              failedCountForInvoice++;
              channelErrors.push(`${ch}: ${dispatchErr.message}`);
            }
          }

          item.dispatchedNotificationId = lastDispatchedNotif?.id;
          if (dispatchedSuccessCount > 0) {
            summary.dispatchedCount++;
            item.dispatchStatus = lastDispatchedNotif?.status ?? NotifStatus.SENT;
            if (failedCountForInvoice > 0) {
              item.suppressionReason = `Partial dispatch: ${channelErrors.join('; ')}`;
            }
          } else {
            summary.failedCount++;
            item.dispatchStatus = NotifStatus.FAILED;
            item.suppressionReason = channelErrors.join('; ') || 'All permitted channels failed dispatch';
          }
          summary.items.push(item);
        }
      }

      // Record audit log for the run
      await this.auditLogs.log({
        tenantId,
        userId: options?.userId || 'CHOTU_AI_AUTOMATION',
        action: 'reminders.evaluation_completed',
        entityType: 'Notification',
        metadata: {
          evaluatedCount: summary.evaluatedCount,
          eligibleCount: summary.eligibleCount,
          dispatchedCount: summary.dispatchedCount,
          suppressedCount: summary.suppressedCount,
          failedCount: summary.failedCount,
          isDryRun: summary.isDryRun,
        },
      });

      return summary;
    } finally {
      this.activeLocks.delete(tenantId);
    }
  }

  /**
   * Preview upcoming reminders (strictly dry-run inspection)
   */
  async previewReminders(user: AuthUser): Promise<RemindersRunSummary> {
    return this.evaluateTenantReminders(user.tenantId, {
      force: true, // Allow previewing even outside quiet hours
      dryRunOverride: true,
      userId: user.userId,
    });
  }

  /**
   * Manually trigger an automated run
   */
  async triggerRun(user: AuthUser, dryRunOverride?: boolean): Promise<RemindersRunSummary> {
    return this.evaluateTenantReminders(user.tenantId, {
      force: false,
      dryRunOverride,
      userId: user.userId,
    });
  }

  /**
   * Send a test reminder strictly to the configured test recipient
   */
  async sendTestReminder(user: AuthUser, dto: SendTestReminderDto): Promise<{ success: boolean; notification?: any; message: string }> {
    const { tenantId, userId } = user;
    const settings = await this.getSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant) throw new NotFoundException('Tenant not found');

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found in tenant');

    const configuredTestTarget =
      dto.channel === 'EMAIL'
        ? settings.testRecipientEmail || process.env.EMAIL_TEST_RECIPIENT
        : settings.testRecipientPhone || process.env.WHATSAPP_TEST_RECIPIENT;

    let testRecipient = configuredTestTarget;

    if (dto.recipient) {
      const cleanOverride = dto.recipient.trim();
      if (dto.channel === 'EMAIL') {
        const isAllowed =
          cleanOverride.toLowerCase() === configuredTestTarget?.toLowerCase() ||
          cleanOverride.toLowerCase() === process.env.EMAIL_TEST_RECIPIENT?.toLowerCase() ||
          cleanOverride.toLowerCase().endsWith('@resend.dev') ||
          cleanOverride.toLowerCase().endsWith('.test') ||
          cleanOverride.toLowerCase().endsWith('.internal');
        if (!isAllowed) {
          throw new BadRequestException(
            `Recipient override '${cleanOverride}' is blocked. Test reminders may only be sent to the configured test recipient (${configuredTestTarget || 'not set'}) or authorized test domain.`,
          );
        }
        testRecipient = cleanOverride;
      } else {
        const cleanDigits = cleanOverride.replace(/[^\d]/g, '');
        const configuredDigits = (configuredTestTarget || '').replace(/[^\d]/g, '');
        const envDigits = (process.env.WHATSAPP_TEST_RECIPIENT || '').replace(/[^\d]/g, '');
        if (cleanDigits !== configuredDigits && cleanDigits !== envDigits && !cleanDigits.endsWith('0000')) {
          throw new BadRequestException(
            `Phone override '${cleanOverride}' is blocked. Test reminders may only be sent to the configured test phone (${configuredTestTarget || 'not set'}).`,
          );
        }
        testRecipient = cleanOverride;
      }
    }

    if (!testRecipient) {
      throw new BadRequestException(
        `No configured test recipient found for channel ${dto.channel}. Configure testRecipient in settings or environment.`,
      );
    }

    const now = new Date();
    const diffTime = now.getTime() - new Date(invoice.dueDate).getTime();
    const daysOverdue = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    const stage: ReminderStage = this.calculateStage(daysOverdue) ?? 'DUE_SOON';

    const tenantContactNumber = (await this.notifications.getTenantContactNumber?.(tenantId)) || settings.companyContactNumber;

    const preview = this.generateChotuReminderMessage({
      stage,
      channel: dto.channel,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.number,
      amount: Number(invoice.outstanding),
      dueDate: invoice.dueDate,
      daysOverdue,
      companyName: tenant.name,
      companyContactNumber: tenantContactNumber || undefined,
    });

    if (dto.channel === 'WHATSAPP' && preview.template === 'PAYMENT_REMINDER_OVERDUE') {
      const contactVal = validateCompanyContactNumber(tenantContactNumber, testRecipient);
      if (!contactVal.valid) {
        throw new BadRequestException(
          `Cannot send overdue WhatsApp reminder: ${contactVal.reason}. Please configure a valid company contact number in company profile or settings.`,
        );
      }
    }

    // Create a temporary mock customer or target the test recipient explicitly
    const targetChannel = dto.channel === 'EMAIL' ? NotificationChannel.EMAIL : NotificationChannel.WHATSAPP;

    const notif = await this.notifications.dispatch(user, {
      customerId: invoice.customer.id,
      channel: targetChannel,
      template: preview.template,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: Number(invoice.outstanding),
        dueDate: invoice.dueDate,
        daysOverdue,
        stage,
        isTest: true,
        testScope: 'CONTROLLED_REMINDER_TEST',
        testRecipient,
        companyContactNumber: tenantContactNumber || undefined,
        customSubject: `[TEST REMINDER] ${preview.subject}`,
        customMessage: preview.message,
        allowDuplicate: true,
      },
    });

    return {
      success: notif.status !== NotifStatus.FAILED,
      notification: notif,
      message: `Test reminder evaluated and dispatched to configured test recipient (${testRecipient})`,
    };
  }

  /**
   * Aggregate reminder stats for dashboard cards
   */
  async getStats(user: AuthUser): Promise<ReminderStatsSummary> {
    const { tenantId } = user;
    const settings = await this.getSettings(tenantId);

    const [totalEvaluated, sentCount, deliveredCount, failedCount, pendingCount] = await Promise.all([
      this.prisma.notification.count({
        where: {
          tenantId,
          payload: { path: ['reminderType'], equals: 'AUTOMATED_CHOTU' },
        },
      }),
      this.prisma.notification.count({
        where: {
          tenantId,
          status: NotifStatus.SENT,
          payload: { path: ['reminderType'], equals: 'AUTOMATED_CHOTU' },
        },
      }),
      this.prisma.notification.count({
        where: {
          tenantId,
          status: NotifStatus.DELIVERED,
          payload: { path: ['reminderType'], equals: 'AUTOMATED_CHOTU' },
        },
      }),
      this.prisma.notification.count({
        where: {
          tenantId,
          status: NotifStatus.FAILED,
          payload: { path: ['reminderType'], equals: 'AUTOMATED_CHOTU' },
        },
      }),
      this.prisma.notification.count({
        where: {
          tenantId,
          status: NotifStatus.QUEUED,
          payload: { path: ['reminderType'], equals: 'AUTOMATED_CHOTU' },
        },
      }),
    ]);

    const lastAudit = await this.prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: 'reminders.evaluation_completed',
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      totalEvaluated,
      sentCount,
      deliveredCount,
      failedCount,
      suppressedCount: (lastAudit?.metadata as any)?.suppressedCount || 0,
      pendingCount,
      lastRunAt: lastAudit?.createdAt.toISOString(),
      isGloballyEnabled: settings.globalEnabled,
      isTenantEnabled: settings.enabled,
      isDryRun: settings.dryRun,
    };
  }

  /**
   * Per-invoice reminder history and failure reasons
   */
  async getHistory(user: AuthUser, query: { page?: number; limit?: number; invoiceId?: string; status?: NotifStatus }) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.invoiceId ? { payload: { path: ['invoiceId'], equals: query.invoiceId } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
