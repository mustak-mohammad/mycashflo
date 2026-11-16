import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotificationChannel, NotifStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { IsOptional, IsEnum, IsString, IsObject, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { validateCompanyContactNumber } from '../integrations/adapters/whatsapp-cloud.adapter.js';
import { evaluateCustomerConsent } from '../common/consent-policy.js';
import {
  WhatsAppInboundSafetyService,
  type InboundResolutionResult,
} from './whatsapp-inbound-safety.service.js';

export class DispatchNotificationDto {
  @ApiProperty({ description: 'Target Customer ID' })
  @IsString()
  customerId: string;

  @ApiProperty({ enum: NotificationChannel, description: 'Channel: WHATSAPP, EMAIL, or SMS' })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({
    example: 'PAYMENT_REMINDER_OVERDUE',
    description: 'Template name (PAYMENT_REMINDER_OVERDUE, PAYMENT_REMINDER_UPCOMING, PTP_CONFIRMATION, DISPUTE_ACKNOWLEDGMENT, CUSTOM)',
  })
  @IsString()
  template: string;

  @ApiPropertyOptional({
    description: 'Template payload variables (invoiceId, amount, customMessage, paymentLink, idempotencyKey, etc.)',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export class NotificationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ enum: NotifStatus })
  @IsOptional()
  @IsEnum(NotifStatus)
  status?: NotifStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;
}

export interface RenderedTemplate {
  subject?: string;
  message: string;
  html?: string;
  recipient: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly inboundSafety?: WhatsAppInboundSafetyService,
  ) {}

  getTemplates() {
    return [
      {
        id: 'PAYMENT_REMINDER_OVERDUE',
        name: 'Payment Reminder (Overdue)',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Urgent reminder for overdue invoices with verified payment details',
        variables: [
          'customerName',
          'companyName',
          'invoiceNumber',
          'amount',
          'dueDate',
          'companyContactNumber',
        ],
      },
      {
        id: 'PAYMENT_REMINDER_UPCOMING',
        name: 'Payment Reminder (Upcoming)',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Friendly notification for upcoming invoice due date',
        variables: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'companyName', 'paymentLink'],
      },
      {
        id: 'PTP_CONFIRMATION',
        name: 'Promise-to-Pay Confirmation',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Confirmation of payment commitment agreed during collection call',
        variables: ['customerName', 'promisedAmount', 'promisedDate', 'companyName'],
      },
      {
        id: 'DISPUTE_ACKNOWLEDGMENT',
        name: 'Dispute Acknowledgment',
        channels: ['EMAIL', 'WHATSAPP'],
        description: 'Acknowledges customer dispute and indicates review in progress',
        variables: ['customerName', 'invoiceNumber', 'reason', 'companyName'],
      },
      {
        id: 'CUSTOM',
        name: 'Custom Agent Notification',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Ad-hoc customized message written by finance agent',
        variables: ['customerName', 'customMessage', 'companyName'],
      },
    ];
  }

  /**
   * Resolves the authoritative contact number for a tenant from tenant configuration.
   * Priority:
   *  1. COMPANY_PROFILE in IntegrationConfig (phone, contactNumber, companyContactNumber, supportPhone)
   *  2. WHATSAPP_CLOUD in IntegrationConfig (companyContactNumber, contactNumber, phone, supportPhone)
   *  3. AUTOMATED_REMINDERS in IntegrationConfig (companyContactNumber, contactNumber, phone)
   * Strictly tenant-isolated: never substitutes another tenant's number, global fallback, or customer's number.
   */
  async getTenantContactNumber(tenantId: string): Promise<string | null> {
    if (this.integrations?.getRawConfig) {
      try {
        const profile = await this.integrations.getRawConfig(tenantId, 'COMPANY_PROFILE');
        const profileNum =
          profile?.phone || profile?.contactNumber || profile?.companyContactNumber || profile?.supportPhone;
        if (profileNum && typeof profileNum === 'string' && profileNum.trim()) {
          return profileNum.trim();
        }

        const wa = await this.integrations.getRawConfig(tenantId, 'WHATSAPP_CLOUD');
        const waNum =
          wa?.companyContactNumber || wa?.contactNumber || wa?.phone || wa?.supportPhone;
        if (waNum && typeof waNum === 'string' && waNum.trim()) {
          return waNum.trim();
        }

        const rem = await this.integrations.getRawConfig(tenantId, 'AUTOMATED_REMINDERS');
        const remNum = rem?.companyContactNumber || rem?.contactNumber || rem?.phone;
        if (remNum && typeof remNum === 'string' && remNum.trim()) {
          return remNum.trim();
        }
      } catch {
        // Fall back to direct prisma query
      }
    }

    if (this.prisma.integrationConfig?.findMany) {
      const configs = await this.prisma.integrationConfig.findMany({
        where: {
          tenantId,
          provider: { in: ['COMPANY_PROFILE', 'WHATSAPP_CLOUD', 'AUTOMATED_REMINDERS'] },
        },
      });

      const profile = configs.find((c) => c.provider === 'COMPANY_PROFILE')?.config as
        | Record<string, any>
        | undefined;
      const profileNum =
        profile?.phone || profile?.contactNumber || profile?.companyContactNumber || profile?.supportPhone;
      if (profileNum && typeof profileNum === 'string' && profileNum.trim()) {
        return profileNum.trim();
      }

      const wa = configs.find((c) => c.provider === 'WHATSAPP_CLOUD')?.config as
        | Record<string, any>
        | undefined;
      const waNum = wa?.companyContactNumber || wa?.contactNumber || wa?.phone || wa?.supportPhone;
      if (waNum && typeof waNum === 'string' && waNum.trim()) {
        return waNum.trim();
      }

      const rem = configs.find((c) => c.provider === 'AUTOMATED_REMINDERS')?.config as
        | Record<string, any>
        | undefined;
      const remNum = rem?.companyContactNumber || rem?.contactNumber || rem?.phone;
      if (remNum && typeof remNum === 'string' && remNum.trim()) {
        return remNum.trim();
      }
    }

    return null;
  }

  async findAll(user: AuthUser, query: NotificationQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true, company: true } },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const notif = await this.prisma.notification.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
      },
    });

    if (!notif) {
      throw new NotFoundException('Notification not found');
    }

    return notif;
  }

  private generateHtmlEmail(
    company: string,
    customerName: string,
    badgeText: string,
    badgeColor: string,
    introText: string,
    tableRows: Array<{ label: string; value: string; isHighlight?: boolean }>,
    paymentUrl?: string,
    noteText?: string,
  ): string {
    const rowsHtml = tableRows
      .map(
        (r) => `
        <tr>
          <td style="padding: 12px 16px; font-size: 13px; color: #64748b; border-bottom: 1px solid #e2e8f0;">${r.label}</td>
          <td style="padding: 12px 16px; font-size: ${r.isHighlight ? '16px' : '14px'}; font-weight: 600; color: ${r.isHighlight ? '#dc2626' : '#1e293b'}; text-align: right; border-bottom: 1px solid #e2e8f0;">${r.value}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${company} Notice</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="background-color: #0f172a; padding: 20px 24px; color: #ffffff;">
      <h1 style="margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;">${company}</h1>
      <p style="margin: 3px 0 0 0; font-size: 12px; color: #94a3b8;">Accounts Receivable &amp; Credit Control</p>
    </div>
    <div style="padding: 24px;">
      <div style="display: inline-block; background-color: ${badgeColor === 'red' ? '#fef2f2' : '#f0fdf4'}; color: ${badgeColor === 'red' ? '#dc2626' : '#16a34a'}; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; border: 1px solid ${badgeColor === 'red' ? '#fee2e2' : '#dcfce7'}; margin-bottom: 16px; letter-spacing: 0.05em; text-transform: uppercase;">
        ${badgeText}
      </div>
      <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.5;">Dear <strong>${customerName}</strong>,</p>
      <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #475569;">
        ${introText}
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; background-color: #f8fafc; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0;">
        ${rowsHtml}
      </table>
      ${
        paymentUrl
          ? `
      <div style="text-align: center; margin: 24px 0 20px 0;">
        <a href="${paymentUrl}" style="background-color: #2563eb; color: #ffffff; padding: 13px 26px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-block;">
          Pay Online Now &rarr;
        </a>
        <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748b;">
          Direct payment link: <a href="${paymentUrl}" style="color: #2563eb;">${paymentUrl}</a>
        </p>
      </div>`
          : `
      <div style="background-color: #f1f5f9; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #475569;">
        Please remit via standard bank transfer (NEFT / RTGS / IMPS) quoting the invoice number, or contact accounts to request an instant payment link.
      </div>`
      }
      <p style="margin: 16px 0 0 0; font-size: 12px; line-height: 1.5; color: #64748b;">
        ${noteText || 'If payment has already been remitted within the last 24 hours, kindly accept our thanks and disregard this notice. For queries, please reply directly to this message.'}
      </p>
    </div>
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 24px; font-size: 11px; color: #94a3b8; text-align: center;">
      <p style="margin: 0;">Sent by ${company} via myCashflo Receivables Automation</p>
      <p style="margin: 2px 0 0 0;">This communication is confidential and intended solely for ${customerName}.</p>
    </div>
  </div>
</body>
</html>`;
  }

  private renderMessage(
    template: string,
    channel: NotificationChannel,
    customer: { name: string; email: string; phone: string; company?: string | null },
    tenantName: string,
    payload: Record<string, any> = {},
  ): RenderedTemplate {
    const effectiveRecipient = payload.testRecipient || payload.recipientOverride;
    const recipient = effectiveRecipient || (channel === NotificationChannel.EMAIL ? customer.email : customer.phone);
    const company = tenantName || 'myCashflo Finance';
    const amountStr = payload.amount ? `₹${Number(payload.amount).toLocaleString('en-IN')}` : 'your outstanding balance';
    const invoiceNum = payload.invoiceNumber || 'your recent invoice';
    const dueDateStr = payload.dueDate ? new Date(payload.dueDate).toLocaleDateString('en-IN') : 'immediate';
    const paymentUrl = payload.paymentLink;
    const daysOverdue = payload.daysOverdue;

    let subject = payload.customSubject || `Notice from ${company}`;
    let message = '';
    let html: string | undefined = undefined;

    switch (template) {
      case 'PAYMENT_REMINDER_OVERDUE':
        subject = payload.customSubject || `Overdue Payment Notice: Invoice ${invoiceNum} — ${company}`;
        if (channel === NotificationChannel.WHATSAPP) {
          const payLinkText = paymentUrl ? `\n\nInstant Payment Link: ${paymentUrl}` : '';
          const contactText = payload.companyContactNumber
            ? `\n\nFor payment queries, contact our accounts desk at ${payload.companyContactNumber}.`
            : '';
          message =
            payload.customMessage ||
            `*Payment Reminder from ${company}*\n\nDear ${customer.name},\nThis is a gentle reminder that invoice *${invoiceNum}* for *${amountStr}* was due on *${dueDateStr}* and is currently overdue.${payLinkText}${contactText}\n\nPlease remit the payment at your earliest convenience to maintain an uninterrupted credit facility.\n\nThank you,\nFinance & Accounts, ${company}`;
        } else if (channel === NotificationChannel.SMS) {
          const linkSnippet = paymentUrl ? ` Pay: ${paymentUrl}` : '';
          message =
            payload.customMessage ||
            `Reminder: Invoice ${invoiceNum} of ${amountStr} for ${customer.name} is overdue since ${dueDateStr}.${linkSnippet} Please clear remittance immediately. - ${company}`;
        } else {
          const paySection = paymentUrl
            ? `\n\nYou may clear this balance immediately via our secure online portal:\n${paymentUrl}\n`
            : '\n\nPlease arrange for bank transfer today quoting your invoice number.\n';
          message =
            payload.customMessage ||
            `Dear ${customer.name},\n\nWe hope this email finds you well.\n\nOur records indicate that payment for invoice ${invoiceNum} in the amount of ${amountStr} was due on ${dueDateStr}${daysOverdue ? ` (${daysOverdue} days overdue)` : ''} and remains unpaid.${paySection}\nIf payment has already been remitted, kindly disregard this notice.\n\nWarm regards,\nAccounts Receivable Team\n${company}`;

          html = this.generateHtmlEmail(
            company,
            customer.name,
            payload.customSubject || 'Overdue Payment Notice',
            'red',
            payload.customMessage
              ? payload.customMessage.replace(/\n/g, '<br/>')
              : `This is a formal notification that invoice <strong>${invoiceNum}</strong> has exceeded the agreed credit term and is currently overdue for payment.`,
            [
              { label: 'Invoice Number', value: invoiceNum },
              { label: 'Original Due Date', value: dueDateStr },
              ...(daysOverdue ? [{ label: 'Days Overdue', value: `${daysOverdue} days` }] : []),
              { label: 'Outstanding Balance', value: amountStr, isHighlight: true },
            ],
            paymentUrl,
            'If payment has already been remitted within the last 24 hours, kindly accept our thanks and disregard this notice. For queries, reply to this email.',
          );
        }
        break;

      case 'PAYMENT_REMINDER_UPCOMING':
        subject = payload.customSubject || `Upcoming Payment Notice: Invoice ${invoiceNum} — ${company}`;
        if (channel === NotificationChannel.WHATSAPP) {
          const link = paymentUrl ? `\n\nPay here: ${paymentUrl}` : '';
          message =
            payload.customMessage ||
            `*Upcoming Payment Reminder — ${company}*\n\nHello ${customer.name},\nInvoice *${invoiceNum}* for *${amountStr}* is due on *${dueDateStr}*.${link}\n\nKindly schedule your remittance to ensure timely clearance.\n\nBest regards,\n${company}`;
        } else if (channel === NotificationChannel.SMS) {
          message =
            payload.customMessage ||
            `Invoice ${invoiceNum} for ${amountStr} is due on ${dueDateStr}. Kindly ensure timely remittance. - ${company}`;
        } else {
          message =
            payload.customMessage ||
            `Dear ${customer.name},\n\nThis is a friendly reminder that invoice ${invoiceNum} for ${amountStr} is scheduled for payment on ${dueDateStr}.\n\nThank you for your business.\n\nSincerely,\n${company}`;
          html = this.generateHtmlEmail(
            company,
            customer.name,
            payload.customSubject || 'Upcoming Payment Notice',
            'green',
            payload.customMessage
              ? payload.customMessage.replace(/\n/g, '<br/>')
              : `This is a friendly reminder that invoice <strong>${invoiceNum}</strong> is scheduled for payment on <strong>${dueDateStr}</strong>.`,
            [
              { label: 'Invoice Number', value: invoiceNum },
              { label: 'Due Date', value: dueDateStr },
              { label: 'Amount Payable', value: amountStr },
            ],
            paymentUrl,
          );
        }
        break;

      case 'PTP_CONFIRMATION':
        subject = `Payment Commitment Confirmation — ${company}`;
        const ptpDate = payload.promisedDate ? new Date(payload.promisedDate).toLocaleDateString('en-IN') : 'agreed date';
        const ptpAmount = payload.promisedAmount ? `₹${Number(payload.promisedAmount).toLocaleString('en-IN')}` : amountStr;
        message = `Dear ${customer.name}, thank you for confirming your payment commitment of ${ptpAmount} scheduled for ${ptpDate}. We have recorded this in your account. - ${company}`;
        if (channel === NotificationChannel.EMAIL) {
          html = this.generateHtmlEmail(
            company,
            customer.name,
            'Payment Promise Confirmed',
            'green',
            `Thank you for speaking with our accounts representative. We have formally recorded your payment commitment in our financial ledger.`,
            [
              { label: 'Committed Amount', value: ptpAmount },
              { label: 'Commitment Date', value: ptpDate },
            ],
            paymentUrl,
          );
        }
        break;

      case 'DISPUTE_ACKNOWLEDGMENT':
        subject = `Account Review Acknowledgment — Invoice ${invoiceNum}`;
        message = `Dear ${customer.name}, we have received your query regarding invoice ${invoiceNum}. Our finance team is reviewing the account and will get back to you within 24 hours. - ${company}`;
        if (channel === NotificationChannel.EMAIL) {
          html = this.generateHtmlEmail(
            company,
            customer.name,
            'Dispute Under Review',
            'red',
            `We have officially registered your query regarding invoice <strong>${invoiceNum}</strong>. A senior billing manager has been assigned to reconcile your account records.`,
            [
              { label: 'Invoice Reference', value: invoiceNum },
              { label: 'Reason Logged', value: payload.reason || 'Account Reconciliation' },
              { label: 'Review SLA', value: 'Within 24 business hours' },
            ],
          );
        }
        break;

      case 'CUSTOM':
      default:
        subject = payload.subject || `Message from ${company}`;
        message = payload.customMessage || `Dear ${customer.name}, please contact ${company} regarding your account balance of ${amountStr}.`;
        if (channel === NotificationChannel.EMAIL) {
          html = this.generateHtmlEmail(
            company,
            customer.name,
            'Account Notice',
            'green',
            payload.customMessage || `Please contact ${company} regarding your account balance of ${amountStr}.`,
            [],
            paymentUrl,
          );
        }
        break;
    }

    return { subject, message, html, recipient };
  }

  async dispatch(user: AuthUser, dto: DispatchNotificationDto) {
    const { tenantId, userId } = user;

    // 1. Verify tenant & customer
    const [customer, tenant] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException('Customer not found in tenant');
    }

    if (user.role === 'AGENT') {
      const [assignedCase, assignedTask] = await Promise.all([
        this.prisma.collectionCase?.findFirst
          ? this.prisma.collectionCase.findFirst({
              where: { tenantId, customerId: customer.id, assignedTo: userId },
            })
          : null,
        this.prisma.followUpTask?.findFirst
          ? this.prisma.followUpTask.findFirst({
              where: { tenantId, customerId: customer.id, assignedTo: userId },
            })
          : null,
      ]);
      if (!assignedCase && !assignedTask) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer');
      }
    }

    // 2. Strict Referential Integrity: Validate Invoice, Customer, and Payment Link Relationships Upfront
    let verifiedInvoiceNumber = dto.payload?.invoiceNumber;
    let verifiedAmount = dto.payload?.amount;
    let verifiedDueDate = dto.payload?.dueDate;
    let approvedPaymentUrl = dto.payload?.paymentLink;
    let resolvedInvoice: any = null;

    if (dto.payload?.invoiceId) {
      resolvedInvoice = await this.prisma.invoice.findFirst({
        where: { id: dto.payload.invoiceId, tenantId },
      });
      if (!resolvedInvoice) {
        throw new NotFoundException('Invoice not found in tenant');
      }

      // Enforce invoice-customer ownership
      if (resolvedInvoice.customerId && resolvedInvoice.customerId !== customer.id) {
        throw new BadRequestException('Referenced invoice does not belong to the target customer');
      }

      // Enforce invoiceNumber consistency if explicitly provided in payload
      if (
        dto.payload?.invoiceNumber &&
        dto.payload.invoiceNumber.trim().toUpperCase() !== resolvedInvoice.number.trim().toUpperCase()
      ) {
        throw new BadRequestException('Invoice number does not match the referenced invoice ID');
      }

      // Enforce amount consistency if explicitly provided in payload
      if (
        dto.payload?.amount !== undefined &&
        dto.payload?.amount !== null &&
        Math.abs(Number(dto.payload.amount) - Number(resolvedInvoice.outstanding)) > 0.009
      ) {
        throw new BadRequestException('Amount in payload does not match the referenced invoice outstanding balance');
      }

      verifiedInvoiceNumber = resolvedInvoice.number;
      verifiedAmount = Number(resolvedInvoice.outstanding);
      verifiedDueDate = resolvedInvoice.dueDate;

      // Look up existing approved payment link strictly bound to customer and invoice
      if (!approvedPaymentUrl) {
        const existingLinkPayment = await this.prisma.payment.findFirst({
          where: {
            tenantId,
            invoiceId: resolvedInvoice.id,
            customerId: customer.id,
            method: PaymentMethod.PAYMENT_LINK,
            status: PaymentStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existingLinkPayment?.notes && existingLinkPayment.notes.startsWith('http')) {
          approvedPaymentUrl = existingLinkPayment.notes;
        }
      }
    } else if (dto.payload?.invoiceNumber) {
      // If invoiceNumber provided without invoiceId, check if it matches an existing invoice in tenant
      const invByNumber = await this.prisma.invoice.findFirst({
        where: { number: dto.payload.invoiceNumber.trim(), tenantId },
      });
      if (invByNumber) {
        if (invByNumber.customerId && invByNumber.customerId !== customer.id) {
          throw new BadRequestException('Referenced invoice number does not belong to the target customer');
        }
        if (
          dto.payload?.amount !== undefined &&
          dto.payload?.amount !== null &&
          Math.abs(Number(dto.payload.amount) - Number(invByNumber.outstanding)) > 0.009
        ) {
          throw new BadRequestException('Amount in payload does not match the referenced invoice outstanding balance');
        }
        resolvedInvoice = invByNumber;
        verifiedInvoiceNumber = invByNumber.number;
        if (verifiedAmount === undefined || verifiedAmount === null) {
          verifiedAmount = Number(invByNumber.outstanding);
        }
        if (!verifiedDueDate) {
          verifiedDueDate = invByNumber.dueDate;
        }

        if (!approvedPaymentUrl) {
          const existingLinkPayment = await this.prisma.payment.findFirst({
            where: {
              tenantId,
              invoiceId: invByNumber.id,
              customerId: customer.id,
              method: PaymentMethod.PAYMENT_LINK,
              status: PaymentStatus.PENDING,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (existingLinkPayment?.notes && existingLinkPayment.notes.startsWith('http')) {
            approvedPaymentUrl = existingLinkPayment.notes;
          }
        }
      }
    }

    // Strict validation of caller-supplied payment link
    if (approvedPaymentUrl) {
      const linkPayment = await this.prisma.payment.findFirst({
        where: {
          tenantId,
          OR: [
            { notes: approvedPaymentUrl },
            { providerRef: approvedPaymentUrl },
          ],
        },
      });
      if (linkPayment) {
        if (linkPayment.customerId && linkPayment.customerId !== customer.id) {
          throw new BadRequestException('Payment link does not belong to the target customer');
        }
        if (resolvedInvoice && linkPayment.invoiceId && linkPayment.invoiceId !== resolvedInvoice.id) {
          throw new BadRequestException('Payment link does not match the referenced invoice');
        }
      }
    }

    // 3. Contact-Permission & Structured Customer Consent Guard (Phase 1C)
    const consentEval = evaluateCustomerConsent(customer, dto.channel);
    if (!consentEval.allowed) {
      if (dto.payload?.persistSuppressed === true) {
        return this.prisma.notification.create({
          data: {
            tenantId,
            customerId: customer.id,
            channel: dto.channel,
            template: dto.template,
            status: NotifStatus.SUPPRESSED,
            sentAt: null,
            deliveredAt: null,
            payload: {
              ...(dto.payload ?? {}),
              customerName: customer.name,
              suppressionReason: consentEval.reason,
              consentClassification: consentEval.classification,
              consentState: consentEval.consentState,
            },
          },
        });
      }

      throw new BadRequestException(
        `Outreach suppressed: ${consentEval.reason}`,
      );
    }

    // 3. Idempotency & Duplicate-Send Protection
    // A) Explicit Idempotency Key check
    if (dto.payload?.idempotencyKey) {
      const existingByIdemp = await this.prisma.notification.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          channel: dto.channel,
          payload: { path: ['idempotencyKey'], equals: dto.payload.idempotencyKey },
        },
      });
      if (existingByIdemp) {
        return existingByIdemp;
      }
    }

    // B) 24-hour duplicate send protection for invoice reminders
    if (dto.payload?.invoiceId && dto.payload?.allowDuplicate !== true) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentDuplicate = await this.prisma.notification.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          channel: dto.channel,
          template: dto.template,
          status: { in: [NotifStatus.SENT, NotifStatus.DELIVERED] },
          createdAt: { gte: oneDayAgo },
          payload: { path: ['invoiceId'], equals: dto.payload.invoiceId },
        },
      });
      if (recentDuplicate) {
        return recentDuplicate;
      }
    }

    // 5. Validate channel-specific recipient address
    let failReason: string | null = null;
    let status: NotifStatus = NotifStatus.SENT;

    const targetRecipient =
      dto.payload?.testRecipient ||
      dto.payload?.recipientOverride ||
      (dto.channel === NotificationChannel.EMAIL ? customer.email : customer.phone);

    if (dto.channel === NotificationChannel.EMAIL) {
      if (!targetRecipient || !targetRecipient.includes('@')) {
        failReason = `Customer has invalid or missing email address (${targetRecipient || ''})`;
        status = NotifStatus.FAILED;
      }
    } else {
      // WHATSAPP or SMS
      const cleanPhone = (targetRecipient || '').replace(/[^\d]/g, '');
      if (cleanPhone.length < 8) {
        failReason = `Customer has invalid or missing phone number (${targetRecipient || ''})`;
        status = NotifStatus.FAILED;
      }
    }

    // ── Server-Side Test-Delivery Allowlist Guard ────────────────────────────
    const isTestMode = (process.env.REMINDERS_TEST_MODE || '').toLowerCase() === 'true';
    if (status !== NotifStatus.FAILED && (isTestMode || dto.payload?.isTest === true)) {
      if (dto.channel === NotificationChannel.EMAIL) {
        const allowedEmail = (process.env.EMAIL_TEST_RECIPIENT || '').trim().toLowerCase();
        const targetEmail = (targetRecipient || '').trim().toLowerCase();
        const isEmailAllowed =
          (allowedEmail && targetEmail === allowedEmail) ||
          targetEmail.endsWith('@resend.dev') ||
          targetEmail === 'delivered@resend.dev';

        if (!isEmailAllowed) {
          failReason = `[SAFETY GUARD] Outbound email to ${targetRecipient} blocked. Real customer outreach is suppressed in test mode. Configured test recipient: ${allowedEmail || 'none'}`;
          status = NotifStatus.FAILED;
        }
      } else if (dto.channel === NotificationChannel.WHATSAPP) {
        const allowedPhone = (process.env.WHATSAPP_TEST_RECIPIENT || '').replace(/[^\d]/g, '');
        const targetPhone = (targetRecipient || '').replace(/[^\d]/g, '');
        const isPhoneAllowed = allowedPhone ? targetPhone === allowedPhone : targetPhone.endsWith('0000');

        if (!isPhoneAllowed) {
          failReason = `[SAFETY GUARD] WhatsApp dispatch to ${targetRecipient} suppressed. Real customer outreach is disabled in test mode. Configured test recipient: ${allowedPhone || 'none'}`;
          status = NotifStatus.FAILED;
        }
      }
    }

    // 5b. Resolve and strictly validate tenant company contact number for overdue WhatsApp reminders
    let companyContactNumber = dto.payload?.companyContactNumber;
    if (!companyContactNumber) {
      companyContactNumber = await this.getTenantContactNumber(tenantId);
    }

    if (dto.channel === NotificationChannel.WHATSAPP && dto.template === 'PAYMENT_REMINDER_OVERDUE') {
      const contactVal = validateCompanyContactNumber(companyContactNumber, customer.phone);
      if (!contactVal.valid) {
        failReason = contactVal.reason || 'Missing or invalid tenant contact number for overdue WhatsApp template';
        status = NotifStatus.FAILED;
      } else {
        companyContactNumber = contactVal.formatted;
      }
    }

    // 6. Render content with verified data
    const rendered = this.renderMessage(
      dto.template,
      dto.channel,
      customer,
      tenant?.name ?? 'myCashflo',
      {
        ...(dto.payload ?? {}),
        invoiceNumber: verifiedInvoiceNumber,
        amount: verifiedAmount,
        dueDate: verifiedDueDate,
        paymentLink: approvedPaymentUrl,
        companyContactNumber,
      },
    );

    const fullPayload = {
      ...(dto.payload ?? {}),
      customerName: customer.name,
      companyName: tenant?.name ?? 'myCashflo',
      companyContactNumber,
      invoiceNumber: verifiedInvoiceNumber,
      amount: verifiedAmount,
      dueDate: verifiedDueDate,
      paymentLink: approvedPaymentUrl,
      renderedSubject: rendered.subject,
      renderedMessage: rendered.message,
      recipient: rendered.recipient,
      dispatchedBy: userId,
      failReason,
    };

    // 7. If valid recipient, dispatch via channel adapter
    let sentAt: Date | null = null;
    if (status !== NotifStatus.FAILED) {
      sentAt = new Date();

      if (dto.channel === NotificationChannel.EMAIL && this.integrations?.email) {
        const emailConfig = await this.integrations.getRawConfig(tenantId, 'RESEND');
        const sendResult = await this.integrations.email.send(
          {
            to: rendered.recipient,
            recipientName: customer.name,
            subject: rendered.subject ?? 'Notice from myCashflo',
            text: rendered.message,
            html: rendered.html,
            invoiceNumber: verifiedInvoiceNumber,
            idempotencyKey: dto.payload?.idempotencyKey,
            isTest: dto.payload?.isTest === true,
            testScope: dto.payload?.testScope,
          },
          emailConfig,
        );

        (fullPayload as any).providerMessageId = sendResult.messageId;
        (fullPayload as any).isSimulated = sendResult.isSimulated;
        (fullPayload as any).provider = sendResult.provider;

        if (sendResult.status === 'FAILED') {
          status = NotifStatus.FAILED;
          sentAt = null;
          failReason = sendResult.error || 'Provider rejected email delivery';
          (fullPayload as any).failReason = failReason;
        } else {
          status = sendResult.status as NotifStatus;
        }
      } else if (dto.channel === NotificationChannel.WHATSAPP && this.integrations?.whatsapp) {
        const waConfig = await this.integrations.getRawConfig(tenantId, 'WHATSAPP_CLOUD');
        const sendResult = await this.integrations.whatsapp.send(
          {
            to: rendered.recipient,
            recipientName: customer.name,
            template: dto.template,
            message: rendered.message,
            payload: fullPayload,
          },
          waConfig,
        );
        (fullPayload as any).providerMessageId = sendResult.messageId;
        (fullPayload as any).isSimulated = sendResult.isSimulated;
        (fullPayload as any).provider = 'WHATSAPP_CLOUD';
        if (sendResult.status === 'FAILED') {
          status = NotifStatus.FAILED;
          sentAt = null;
          failReason = sendResult.error || 'WhatsApp provider rejected delivery';
          (fullPayload as any).failReason = failReason;
        } else {
          status = sendResult.status as NotifStatus;
        }
      } else if (dto.channel === NotificationChannel.SMS && this.integrations?.sms) {
        const smsConfig = await this.integrations.getRawConfig(tenantId, 'SMS_GATEWAY');
        const sendResult = await this.integrations.sms.send(
          {
            to: rendered.recipient,
            recipientName: customer.name,
            template: dto.template,
            message: rendered.message,
            payload: fullPayload,
          },
          smsConfig,
        );
        (fullPayload as any).providerMessageId = sendResult.messageId;
        (fullPayload as any).isSimulated = sendResult.isSimulated;
        (fullPayload as any).provider = sendResult.provider;
        if (sendResult.status === 'FAILED') {
          status = NotifStatus.FAILED;
          sentAt = null;
          failReason = sendResult.error || 'SMS provider rejected delivery';
          (fullPayload as any).failReason = failReason;
        } else {
          status = sendResult.status as NotifStatus;
        }
      } else {
        // Channel unsupported or adapter not found
        (fullPayload as any).isSimulated = true;
        (fullPayload as any).provider = 'NONE';
        status = NotifStatus.FAILED;
        sentAt = null;
        failReason = `Channel ${dto.channel} is not configured or unsupported`;
        (fullPayload as any).failReason = failReason;
      }
    }

    // 8. Persist notification in database
    const notification = await this.prisma.notification.create({
      data: {
        customerId: customer.id,
        channel: dto.channel,
        template: dto.template,
        payload: fullPayload,
        status,
        sentAt,
        failReason,
        tenantId,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    // 9. Record audit log
    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'notification.dispatched',
      entityType: 'Notification',
      entityId: notification.id,
      metadata: {
        channel: dto.channel,
        template: dto.template,
        customerId: customer.id,
        status,
        failReason,
        providerMessageId: (fullPayload as any).providerMessageId,
        isSimulated: (fullPayload as any).isSimulated,
      },
    });

    return notification;
  }

  async triggerAutomatedReminders(user: AuthUser) {
    const { tenantId, userId } = user;
    const now = new Date();

    // Find all overdue invoices for this tenant
    const overdueInvoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: ['OVERDUE', 'PARTIALLY_PAID', 'OPEN'] },
        dueDate: { lt: now },
        outstanding: { gt: 0 },
      },
      include: {
        customer: true,
      },
    });

    const results = {
      evaluatedInvoices: overdueInvoices.length,
      dispatchedCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      details: [] as any[],
    };

    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.max(
        1,
        Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
      );

      // Channel dispatch rules:
      // 1 - 14 days overdue: Email reminder
      // 15 - 30 days overdue: SMS reminder
      // 30+ days overdue: WhatsApp urgent reminder
      let channel: NotificationChannel;
      if (daysOverdue > 30) {
        channel = NotificationChannel.WHATSAPP;
      } else if (daysOverdue > 14) {
        channel = NotificationChannel.SMS;
      } else {
        channel = NotificationChannel.EMAIL;
      }

      // Check customer structured consent & DND preferences before triggering reminder (Phase 1C)
      const consentEval = evaluateCustomerConsent(invoice.customer, channel);
      if (!consentEval.allowed) {
        results.suppressedCount++;
        results.details.push({
          invoiceNumber: invoice.number,
          customerName: invoice.customer.name,
          channel,
          skipped: true,
          suppressed: true,
          status: NotifStatus.SUPPRESSED,
          reason: consentEval.reason,
        });
        continue;
      }

      try {
        const notif = await this.dispatch(user, {
          customerId: invoice.customerId,
          channel,
          template: 'PAYMENT_REMINDER_OVERDUE',
          payload: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amount: Number(invoice.outstanding),
            dueDate: invoice.dueDate,
            daysOverdue,
          },
        });

        if (notif.status === NotifStatus.FAILED) {
          results.failedCount++;
        } else if (notif.status === NotifStatus.SUPPRESSED) {
          results.suppressedCount++;
        } else {
          results.dispatchedCount++;
        }

        results.details.push({
          invoiceNumber: invoice.number,
          customerName: invoice.customer.name,
          channel,
          status: notif.status,
          daysOverdue,
        });
      } catch (err: any) {
        if (err.message && err.message.includes('Outreach suppressed')) {
          results.suppressedCount++;
          results.details.push({
            invoiceNumber: invoice.number,
            customerName: invoice.customer.name,
            channel,
            skipped: true,
            suppressed: true,
            status: NotifStatus.SUPPRESSED,
            reason: err.message,
          });
        } else {
          results.failedCount++;
          results.details.push({
            invoiceNumber: invoice.number,
            customerName: invoice.customer.name,
            error: err.message,
          });
        }
      }
    }

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'notifications.automated_trigger',
      entityType: 'Notification',
      metadata: {
        evaluatedInvoices: results.evaluatedInvoices,
        dispatchedCount: results.dispatchedCount,
        failedCount: results.failedCount,
        suppressedCount: results.suppressedCount,
      },
    });

    return results;
  }

  verifyWhatsAppWebhook(mode: string, token: string, challenge: string): string {
    const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN || 'mycashflo_whatsapp_verify_token';
    const result = this.integrations?.whatsapp?.verifyWebhookChallenge
      ? this.integrations.whatsapp.verifyWebhookChallenge(mode, token, challenge, configuredToken)
      : (mode === 'subscribe' && token === configuredToken ? challenge : null);

    if (!result) {
      throw new BadRequestException('Forbidden webhook verification token');
    }
    return result;
  }

  private sanitizeSecretString(str: any): string {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/EAA[A-Za-z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/key-[a-f0-9]{32}/gi, '[REDACTED_KEY]')
      .replace(/((?:access_token|secret)=)[^\s&,;'"]+/gi, '$1[REDACTED]');
  }

  async handleWhatsAppWebhook(payload: any, signature: string) {
    if (this.integrations?.whatsapp) {
      const isValid = this.integrations.whatsapp.verifyWebhookSignature(payload, signature);
      if (!isValid) {
        throw new BadRequestException('Invalid WhatsApp webhook signature');
      }

      const events = this.integrations.whatsapp.parseWebhook(payload);
      let updatedCount = 0;

      for (const ev of events) {
        let notif = await this.prisma.notification.findFirst({
          where: {
            channel: NotificationChannel.WHATSAPP,
            payload: { path: ['providerMessageId'], equals: ev.messageId },
          },
        });

        if (!notif) {
          const recentNotifs = await this.prisma.notification.findMany({
            where: { channel: NotificationChannel.WHATSAPP },
            take: 50,
            orderBy: { createdAt: 'desc' },
          });
          notif = recentNotifs.find((n) => (n.payload as any)?.providerMessageId === ev.messageId) || null;
        }

        if (!notif) {
          this.logger.debug(`WhatsApp webhook ignored for unknown message ID: ${ev.messageId}`);
          continue;
        }

        const currentStatus = notif.status;
        const currentPayload = (notif.payload as Record<string, any>) || {};

        // Webhook Idempotency Check:
        // Skip duplicate replays to avoid redundant database writes and duplicate audit entries
        if (
          (ev.status === 'READ' && currentPayload.deliveryStatus === 'READ') ||
          (ev.status === 'DELIVERED' && currentStatus === NotifStatus.DELIVERED && currentPayload.deliveryStatus !== 'SENT') ||
          (ev.status === 'SENT' && (currentStatus === NotifStatus.SENT || currentStatus === NotifStatus.DELIVERED))
        ) {
          this.logger.debug(`Idempotent WhatsApp webhook replay ignored for message ID ${ev.messageId} (${ev.status})`);
          continue;
        }

        let nextStatus: NotifStatus = currentStatus;
        if (ev.status === 'FAILED') {
          if (currentStatus !== NotifStatus.DELIVERED) {
            nextStatus = NotifStatus.FAILED;
          }
        } else if (ev.status === 'SENT') {
          if (currentStatus === NotifStatus.QUEUED) {
            nextStatus = NotifStatus.SENT;
          }
        } else if (ev.status === 'DELIVERED' || ev.status === 'READ') {
          nextStatus = NotifStatus.DELIVERED;
        }

        const updatedPayload: Record<string, any> = {
          ...currentPayload,
          deliveryStatus: ev.status,
          ...(ev.status === 'DELIVERED' ? { deliveredAt: ev.timestamp.toISOString() } : {}),
          ...(ev.status === 'READ' ? { readAt: ev.timestamp.toISOString() } : {}),
          ...(ev.errorCode ? { providerErrorCode: ev.errorCode } : {}),
        };

        const safeError = ev.error ? this.sanitizeSecretString(ev.error) : notif.failReason;

        await this.prisma.notification.update({
          where: { id: notif.id },
          data: {
            status: nextStatus,
            failReason: safeError,
            payload: updatedPayload,
          },
        });
        updatedCount++;

        await this.auditLogs.log({
          tenantId: notif.tenantId,
          userId: 'SYSTEM',
          action: 'notification.status_updated',
          entityType: 'Notification',
          entityId: notif.id,
          metadata: {
            messageId: ev.messageId,
            status: ev.status,
            channel: 'WHATSAPP',
          },
        });
      }

      const inboundResults: InboundResolutionResult[] = [];
      if (this.integrations.whatsapp.parseInboundMessages) {
        const inboundEvents = this.integrations.whatsapp.parseInboundMessages(payload);
        if (inboundEvents.length > 0 && this.inboundSafety) {
          for (const inEv of inboundEvents) {
            const res = await this.inboundSafety.processInboundMessage(inEv);
            inboundResults.push(res);
          }
        }
      }

      return {
        status: 'ok',
        processed: events.length,
        updated: updatedCount,
        ...(inboundResults.length > 0 ? { inboundProcessed: inboundResults.length } : {}),
      };
    }
    return { status: 'ok', processed: 0, updated: 0 };
  }

  async handleEmailWebhook(payload: any, signature: string) {
    if (this.integrations?.email) {
      const isValid = this.integrations.email.verifyWebhookSignature(payload, signature);
      if (!isValid) {
        throw new BadRequestException('Invalid Email webhook signature');
      }

      const events = this.integrations.email.parseWebhook(payload);
      let updatedCount = 0;

      for (const ev of events) {
        const recentNotifs = await this.prisma.notification.findMany({
          where: { channel: NotificationChannel.EMAIL },
          take: 50,
          orderBy: { createdAt: 'desc' },
        });

        for (const notif of recentNotifs) {
          const payloadObj = notif.payload as any;
          if (payloadObj?.providerMessageId === ev.messageId) {
            const nextStatus = ev.status === 'FAILED' ? NotifStatus.FAILED : NotifStatus.DELIVERED;
            await this.prisma.notification.update({
              where: { id: notif.id },
              data: {
                status: nextStatus,
                failReason: ev.error || notif.failReason,
              },
            });
            updatedCount++;

            await this.auditLogs.log({
              tenantId: notif.tenantId,
              userId: 'SYSTEM',
              action: 'notification.status_updated',
              entityType: 'Notification',
              entityId: notif.id,
              metadata: {
                messageId: ev.messageId,
                status: ev.status,
                event: ev.event,
              },
            });
          }
        }
      }
      return { status: 'ok', processed: events.length, updated: updatedCount };
    }
    return { status: 'ok', processed: 0, updated: 0 };
  }
}
