import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotificationChannel, NotifStatus } from '@prisma/client';
import { IsOptional, IsEnum, IsString, IsObject, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
    description: 'Template payload variables (invoiceId, amount, customMessage, paymentLink, etc.)',
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
  recipient: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  getTemplates() {
    return [
      {
        id: 'PAYMENT_REMINDER_OVERDUE',
        name: 'Payment Reminder (Overdue)',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Urgent reminder for overdue invoices with payment details',
        variables: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'daysOverdue', 'companyName'],
      },
      {
        id: 'PAYMENT_REMINDER_UPCOMING',
        name: 'Payment Reminder (Upcoming)',
        channels: ['WHATSAPP', 'EMAIL', 'SMS'],
        description: 'Friendly notification for upcoming invoice due date',
        variables: ['customerName', 'invoiceNumber', 'amount', 'dueDate', 'companyName'],
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

  private renderMessage(
    template: string,
    channel: NotificationChannel,
    customer: { name: string; email: string; phone: string; company?: string | null },
    tenantName: string,
    payload: Record<string, any> = {},
  ): RenderedTemplate {
    const recipient = channel === NotificationChannel.EMAIL ? customer.email : customer.phone;
    const company = tenantName || 'myCashflo Finance';
    const amountStr = payload.amount ? `₹${Number(payload.amount).toLocaleString('en-IN')}` : 'your outstanding balance';
    const invoiceNum = payload.invoiceNumber || 'your recent invoice';
    const dueDateStr = payload.dueDate ? new Date(payload.dueDate).toLocaleDateString('en-IN') : 'immediate';

    let subject = `Notice from ${company}`;
    let message = '';

    switch (template) {
      case 'PAYMENT_REMINDER_OVERDUE':
        subject = `Overdue Payment Notice: Invoice ${invoiceNum} — ${company}`;
        if (channel === NotificationChannel.WHATSAPP) {
          message = `*Payment Reminder from ${company}*\n\nDear ${customer.name},\nThis is a gentle reminder that invoice *${invoiceNum}* for *${amountStr}* was due on *${dueDateStr}* and is currently overdue.\n\nPlease remit the payment at your earliest convenience to maintain an uninterrupted credit facility.\n\nThank you,\nFinance & Accounts, ${company}`;
        } else if (channel === NotificationChannel.SMS) {
          message = `Reminder: Invoice ${invoiceNum} of ${amountStr} for ${customer.name} is overdue since ${dueDateStr}. Please clear remittance immediately. - ${company}`;
        } else {
          message = `Dear ${customer.name},\n\nWe hope this email finds you well.\n\nOur records indicate that payment for invoice ${invoiceNum} in the amount of ${amountStr} was due on ${dueDateStr} and remains unpaid.\n\nPlease arrange for the transfer today. If payment has already been remitted, kindly disregard this notice.\n\nWarm regards,\nAccounts Receivable Team\n${company}`;
        }
        break;

      case 'PAYMENT_REMINDER_UPCOMING':
        subject = `Upcoming Payment Notice: Invoice ${invoiceNum} — ${company}`;
        if (channel === NotificationChannel.WHATSAPP) {
          message = `*Upcoming Payment Reminder — ${company}*\n\nHello ${customer.name},\nInvoice *${invoiceNum}* for *${amountStr}* is due on *${dueDateStr}*.\n\nKindly schedule your remittance to ensure timely clearance.\n\nBest regards,\n${company}`;
        } else if (channel === NotificationChannel.SMS) {
          message = `Invoice ${invoiceNum} for ${amountStr} is due on ${dueDateStr}. Kindly ensure timely remittance. - ${company}`;
        } else {
          message = `Dear ${customer.name},\n\nThis is a friendly reminder that invoice ${invoiceNum} for ${amountStr} is scheduled for payment on ${dueDateStr}.\n\nThank you for your business.\n\nSincerely,\n${company}`;
        }
        break;

      case 'PTP_CONFIRMATION':
        subject = `Payment Commitment Confirmation — ${company}`;
        const ptpDate = payload.promisedDate ? new Date(payload.promisedDate).toLocaleDateString('en-IN') : 'agreed date';
        const ptpAmount = payload.promisedAmount ? `₹${Number(payload.promisedAmount).toLocaleString('en-IN')}` : amountStr;
        message = `Dear ${customer.name}, thank you for confirming your payment commitment of ${ptpAmount} scheduled for ${ptpDate}. We have recorded this in your account. - ${company}`;
        break;

      case 'DISPUTE_ACKNOWLEDGMENT':
        subject = `Account Review Acknowledgment — Invoice ${invoiceNum}`;
        message = `Dear ${customer.name}, we have received your query regarding invoice ${invoiceNum}. Our finance team is reviewing the account and will get back to you within 24 hours. - ${company}`;
        break;

      case 'CUSTOM':
      default:
        subject = payload.subject || `Message from ${company}`;
        message = payload.customMessage || `Dear ${customer.name}, please contact ${company} regarding your account balance of ${amountStr}.`;
        break;
    }

    return { subject, message, recipient };
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

    // 2. Validate channel-specific recipient address
    let failReason: string | null = null;
    let status: NotifStatus = NotifStatus.SENT;

    if (dto.channel === NotificationChannel.EMAIL) {
      if (!customer.email || !customer.email.includes('@')) {
        failReason = `Customer has invalid or missing email address (${customer.email})`;
        status = NotifStatus.FAILED;
      }
    } else {
      // WHATSAPP or SMS
      if (!customer.phone || customer.phone.length < 8) {
        failReason = `Customer has invalid or missing phone number (${customer.phone})`;
        status = NotifStatus.FAILED;
      }
    }

    // 3. Render content
    const rendered = this.renderMessage(
      dto.template,
      dto.channel,
      customer,
      tenant?.name ?? 'myCashflo',
      dto.payload ?? {},
    );

    const fullPayload = {
      ...(dto.payload ?? {}),
      renderedSubject: rendered.subject,
      renderedMessage: rendered.message,
      recipient: rendered.recipient,
      dispatchedBy: userId,
    };

    // 4. If valid, simulate/execute multi-channel delivery
    let sentAt: Date | null = null;
    if (status !== NotifStatus.FAILED) {
      sentAt = new Date();
      status = NotifStatus.DELIVERED;
    }

    // 5. Persist notification in database
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

    // 6. Record audit log
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
        results.failedCount++;
        results.details.push({
          invoiceNumber: invoice.number,
          customerName: invoice.customer.name,
          error: err.message,
        });
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
      },
    });

    return results;
  }
}
