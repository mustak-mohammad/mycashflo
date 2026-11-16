import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { buildInvoicePdf } from '../invoices/invoice-pdf.util.js';
import { evaluateCustomerConsent } from '../common/consent-policy.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';

export {
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
};

export class CreateDocumentDeliveryDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  callSessionId?: string;

  @IsOptional()
  @IsEnum(DocumentRequestType)
  requestType?: DocumentRequestType;

  @IsOptional()
  @IsEnum(DeliveryChannelPreference)
  deliveryChannel?: DeliveryChannelPreference;

  @IsOptional()
  @IsString()
  requestedBy?: string;

  @IsOptional()
  @IsBoolean()
  resend?: boolean;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DocumentDeliveryQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  callSessionId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsEnum(DocumentDeliveryStatus)
  status?: DocumentDeliveryStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export interface SignedInvoicePayload {
  tenantId: string;
  invoiceId: string;
  customerId: string;
  exp: number;
}

@Injectable()
export class DocumentDeliveryService {
  private readonly logger = new Logger(DocumentDeliveryService.name);
  private readonly hmacSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly integrations: IntegrationsService,
    private readonly auditLogs: AuditLogsService,
  ) {
    const configuredSecret =
      process.env.DOCUMENT_DELIVERY_HMAC_SECRET ||
      process.env.JWT_ACCESS_SECRET ||
      process.env.JWT_SECRET;
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    if (!configuredSecret || configuredSecret.trim() === '') {
      if (nodeEnv === 'test') {
        this.hmacSecret = crypto.randomBytes(32).toString('hex');
      } else {
        throw new Error(
          'DOCUMENT_DELIVERY_HMAC_SECRET or JWT_ACCESS_SECRET must be configured',
        );
      }
    } else {
      this.hmacSecret = configuredSecret;
    }
  }

  // ── RBAC Scoping Helper ────────────────────────────────────────────────────
  private async getAgentCustomerIds(tenantId: string, userId: string): Promise<string[]> {
    try {
      const [assignedCases, assignedTasks] = await Promise.all([
        this.prisma.collectionCase?.findMany
          ? this.prisma.collectionCase.findMany({
              where: { tenantId, assignedTo: userId },
              select: { customerId: true },
            })
          : [],
        this.prisma.followUpTask?.findMany
          ? this.prisma.followUpTask.findMany({
              where: { tenantId, assignedTo: userId, customerId: { not: null } },
              select: { customerId: true },
            })
          : [],
      ]);
      const allowed = new Set<string>();
      (assignedCases || []).forEach((c: any) => c.customerId && allowed.add(c.customerId));
      (assignedTasks || []).forEach((t: any) => t.customerId && allowed.add(t.customerId));
      return Array.from(allowed);
    } catch {
      return [];
    }
  }

  // ── Privacy Masking Helpers ────────────────────────────────────────────────
  maskPhone(phone?: string | null): string {
    if (!phone) return '****';
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.length <= 4) return '****';
    return `+${digits.substring(0, 2)} ****${digits.substring(digits.length - 4)}`;
  }

  maskEmail(email?: string | null): string {
    if (!email || !email.includes('@')) return '****';
    const [local, domain] = email.split('@');
    const maskedLocal =
      local.length <= 2 ? `${local[0]}*` : `${local[0]}****${local[local.length - 1]}`;
    return `${maskedLocal}@${domain}`;
  }

  // ── Secure Short-Lived Signed URL Generation & Verification ────────────────
  generateSignedInvoiceToken(tenantId: string, invoiceId: string, customerId: string, ttlMs = 86400000): string {
    const payload: SignedInvoicePayload = {
      tenantId,
      invoiceId,
      customerId,
      exp: Date.now() + ttlMs,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(encodedPayload)
      .digest('hex');
    return `${encodedPayload}.${signature}`;
  }

  verifySignedInvoiceToken(token: string, invoiceId: string): { valid: boolean; reason?: string; payload?: SignedInvoicePayload } {
    if (!token || !token.includes('.')) {
      return { valid: false, reason: 'Malformed document access token' };
    }
    const [encodedPayload, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(encodedPayload)
      .digest('hex');

    try {
      const match = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
      if (!match) {
        return { valid: false, reason: 'Invalid document access signature' };
      }
    } catch {
      return { valid: false, reason: 'Invalid signature verification' };
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SignedInvoicePayload;
      if (payload.invoiceId !== invoiceId) {
        return { valid: false, reason: 'Token was issued for a different invoice' };
      }
      if (Date.now() > payload.exp) {
        return { valid: false, reason: 'Document access token has expired' };
      }
      return { valid: true, payload };
    } catch {
      return { valid: false, reason: 'Failed to parse document access token payload' };
    }
  }

  // ── Secure PDF Download Retrieval ──────────────────────────────────────────
  async getSecureInvoicePdf(invoiceId: string, token: string): Promise<{ buffer: Buffer; filename: string }> {
    const verification = this.verifySignedInvoiceToken(token, invoiceId);
    if (!verification.valid || !verification.payload) {
      throw new UnauthorizedException(verification.reason || 'Unauthorized document access');
    }

    const { tenantId, customerId } = verification.payload;
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId, customerId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found or access revoked');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    const pdf = buildInvoicePdf({
      tenantName: tenant?.name ?? 'myCashflo',
      invoice,
    });

    const safeNumber = invoice.number.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      buffer: pdf,
      filename: `invoice-${safeNumber}.pdf`,
    };
  }

  // ── Core Delivery Processing ───────────────────────────────────────────────
  async requestDelivery(
    user: AuthUser,
    dto: CreateDocumentDeliveryDto,
    baseUrl?: string,
  ) {
    const { tenantId, userId, role } = user;
    const requestType = dto.requestType || DocumentRequestType.BOTH;
    const deliveryChannel = dto.deliveryChannel || DeliveryChannelPreference.WHATSAPP_AND_EMAIL;

    // 1. Verify Customer & Tenant Isolation
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID '${dto.customerId}' not found in current organization`);
    }

    // RBAC: Check Agent customer assignment
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(customer.id)) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer account');
      }
    }

    // 2. Resolve & Verify Invoice
    let invoice: any;
    if (dto.invoiceId) {
      invoice = await this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, tenantId, customerId: customer.id },
        include: { customer: true },
      });
      if (!invoice) {
        throw new NotFoundException(`Invoice with ID '${dto.invoiceId}' not found for customer '${customer.name}'`);
      }
    } else {
      // Find open or overdue invoices for this customer
      const candidateInvoices = await this.prisma.invoice.findMany({
        where: {
          tenantId,
          customerId: customer.id,
          status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
        },
        orderBy: { dueDate: 'asc' },
        include: { customer: true },
      });

      if (candidateInvoices.length === 1) {
        invoice = candidateInvoices[0];
      } else if (candidateInvoices.length > 1) {
        // Default to the oldest overdue invoice
        invoice = candidateInvoices[0];
      } else {
        const anyInvoice = await this.prisma.invoice.findFirst({
          where: { tenantId, customerId: customer.id },
          orderBy: { createdAt: 'desc' },
          include: { customer: true },
        });
        if (!anyInvoice) {
          throw new NotFoundException(`No invoices found on file for customer '${customer.name}'`);
        }
        invoice = anyInvoice;
      }
    }

    // Validate Invoice Status
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot deliver documents for CANCELLED invoice #${invoice.number}`);
    }
    if (requestType === DocumentRequestType.PAYMENT_LINK && invoice.status === 'PAID') {
      throw new BadRequestException(`Invoice #${invoice.number} is already PAID in full. Payment link not required.`);
    }

    // 3. Scoped Idempotency Check
    const effectiveBaseKey = dto.idempotencyKey ||
      `dlv_${tenantId.slice(0, 8)}_${customer.id.slice(0, 8)}_${invoice.id.slice(0, 8)}_${requestType}_${deliveryChannel}_${dto.callSessionId || 'direct'}`;

    if (!dto.resend) {
      if (dto.idempotencyKey) {
        const existingByKey = await this.prisma.documentDeliveryRequest.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { attempts: true },
        });
        if (existingByKey) {
          this.logger.log(`[IDEMPOTENCY] Returning existing request ${existingByKey.id} for key ${dto.idempotencyKey}`);
          return {
            request: existingByKey,
            isDuplicate: true,
            message: 'A document delivery request with this idempotency key was already processed.',
          };
        }
      }

      // Time-based scoped deduplication (15 minute debounce window)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const recentExisting = await this.prisma.documentDeliveryRequest.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          invoiceId: invoice.id,
          requestType,
          deliveryChannel,
          callSessionId: dto.callSessionId || null,
          requestedAt: { gte: fifteenMinutesAgo },
          status: { in: [DocumentDeliveryStatus.COMPLETED, DocumentDeliveryStatus.PROCESSING] },
        },
        include: { attempts: true },
        orderBy: { requestedAt: 'desc' },
      });

      if (recentExisting) {
        this.logger.log(`[IDEMPOTENCY] Deduped duplicate delivery request for customer ${customer.id}, invoice ${invoice.id} within 15 min window`);
        return {
          request: recentExisting,
          isDuplicate: true,
          message: 'Documents were already sent to this customer recently. Set resend=true to dispatch an additional copy.',
        };
      }
    }

    const idempotencyKey = dto.resend
      ? `${effectiveBaseKey}_resend_${Date.now()}`
      : dto.idempotencyKey || `${effectiveBaseKey}_${Date.now()}`;

    // 4. Secure Short-Lived Signed PDF URL
    const appBaseUrl = baseUrl || process.env.API_BASE_URL || 'http://localhost:3000';
    const signedToken = this.generateSignedInvoiceToken(tenantId, invoice.id, customer.id);
    const signedPdfUrl = `${appBaseUrl}/api/voice/document-requests/invoices/${invoice.id}/download?token=${signedToken}`;
    const pdfExpiresAt = new Date(Date.now() + 86400000); // 24 hours

    // 5. Payment Link Service Integration with Reuse of Valid Active Links
    let paymentLinkUrl: string | undefined;
    let paymentLinkId: string | undefined;
    let isPaymentLinkReused = false;

    if (
      (requestType === DocumentRequestType.PAYMENT_LINK || requestType === DocumentRequestType.BOTH) &&
      invoice.status !== 'PAID'
    ) {
      // Check for existing valid pending payment link created within 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existingPayment = await this.prisma.payment.findFirst({
        where: {
          tenantId,
          invoiceId: invoice.id,
          method: PaymentMethod.PAYMENT_LINK,
          status: PaymentStatus.PENDING,
          createdAt: { gte: oneDayAgo },
          notes: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingPayment && existingPayment.notes && existingPayment.notes.startsWith('http')) {
        paymentLinkUrl = existingPayment.notes;
        paymentLinkId = existingPayment.providerRef || existingPayment.id;
        isPaymentLinkReused = true;
        this.logger.log(`[PAYMENT LINK] Reusing active pending payment link ${paymentLinkId} for invoice #${invoice.number}`);
      } else {
        try {
          const newLink = await this.paymentsService.createPaymentLink(user, {
            invoiceId: invoice.id,
            simulate: true,
            description: `Payment for Invoice #${invoice.number} (${customer.name})`,
          });
          paymentLinkUrl = newLink.shortUrl;
          paymentLinkId = newLink.paymentLinkId;
          isPaymentLinkReused = false;
        } catch (err: any) {
          this.logger.warn(`Failed to generate payment link: ${err?.message}`);
        }
      }
    }

    // 6. Create DocumentDeliveryRequest Record
    const deliveryRequest = await this.prisma.documentDeliveryRequest.create({
      data: {
        tenantId,
        customerId: customer.id,
        invoiceId: invoice.id,
        callSessionId: dto.callSessionId || null,
        requestType,
        deliveryChannel,
        status: DocumentDeliveryStatus.PROCESSING,
        requestedBy: dto.requestedBy || 'CHOTU_VOICE',
        idempotencyKey,
        metadata: {
          invoiceNumber: invoice.number,
          amount: Number(invoice.outstanding || invoice.amount),
          currency: invoice.currency,
          paymentLinkUrl,
          paymentLinkId,
          isPaymentLinkReused,
          signedPdfUrl,
          pdfExpiresAt: pdfExpiresAt.toISOString(),
          notes: dto.notes,
        },
      },
    });

    // 7. Orchestrate Independent Channel Dispatches in Simulation Mode
    const channelsToDispatch: DeliveryAttemptChannel[] = [];
    if (deliveryChannel === DeliveryChannelPreference.WHATSAPP || deliveryChannel === DeliveryChannelPreference.WHATSAPP_AND_EMAIL) {
      channelsToDispatch.push(DeliveryAttemptChannel.WHATSAPP);
    }
    if (deliveryChannel === DeliveryChannelPreference.EMAIL || deliveryChannel === DeliveryChannelPreference.WHATSAPP_AND_EMAIL) {
      channelsToDispatch.push(DeliveryAttemptChannel.EMAIL);
    }

    const attemptRecords: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const channel of channelsToDispatch) {
      if (channel === DeliveryAttemptChannel.WHATSAPP) {
        const phone = customer.phone?.trim();
        const maskedPhone = this.maskPhone(phone);

        if (!phone || phone.replace(/[^\d]/g, '').length < 8) {
          const failedAttempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.WHATSAPP,
              destinationMasked: maskedPhone,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'WHATSAPP_CLOUD',
              errorMessage: 'Customer has no valid phone number on file',
            },
          });
          attemptRecords.push(failedAttempt);
          failureCount++;
          continue;
        }

        // ── Centralized Structured Consent & DND Policy Guard ───────────────────
        const waConsentEval = evaluateCustomerConsent(customer, 'WHATSAPP');
        if (!waConsentEval.allowed) {
          this.logger.warn(`[CONSENT] Document delivery via WhatsApp suppressed for customer ${customer.id}: ${waConsentEval.reason}`);
          const suppressedAttempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.WHATSAPP,
              destinationMasked: maskedPhone,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'WHATSAPP_CLOUD',
              errorMessage: `Outreach suppressed: ${waConsentEval.reason}`,
              sentAt: null,
            },
          });
          attemptRecords.push(suppressedAttempt);
          failureCount++;
          continue;
        }

        const msgLines: string[] = [
          `Hello ${customer.name}, here are the requested documents for Invoice #${invoice.number}:`,
          `Outstanding: ${invoice.currency} ${Number(invoice.outstanding).toLocaleString('en-IN')}`,
          `Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : 'Immediate'}`,
        ];

        if (signedPdfUrl && requestType !== DocumentRequestType.PAYMENT_LINK) {
          msgLines.push(`View/Download Invoice: ${signedPdfUrl}`);
        }
        if (paymentLinkUrl && requestType !== DocumentRequestType.INVOICE) {
          msgLines.push(`Instant Payment Link: ${paymentLinkUrl}`);
        }

        try {
          const waResult = await this.integrations.whatsapp.send(
            {
              to: phone,
              recipientName: customer.name,
              message: msgLines.join('\n'),
              template: 'PAYMENT_REMINDER_OVERDUE',
              payload: {
                customerName: customer.name,
                invoiceNumber: invoice.number,
                amount: Number(invoice.outstanding),
                dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : 'Due',
                companyContactNumber: '+91 80 4000 1234',
                companyName: 'myCashflo Tech',
                paymentLink: paymentLinkUrl || signedPdfUrl,
                isCustomerInitiatedWindow: true,
              },
            },
            { isLive: false },
          );

          const isSuccess = waResult.status === 'SENT' || waResult.status === 'DELIVERED';
          const attempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.WHATSAPP,
              destinationMasked: maskedPhone,
              status: isSuccess
                ? (waResult.isSimulated ? DeliveryAttemptStatus.SIMULATED : DeliveryAttemptStatus.SENT)
                : DeliveryAttemptStatus.FAILED,
              provider: 'WHATSAPP_CLOUD',
              providerMessageId: waResult.messageId,
              errorMessage: isSuccess ? null : waResult.raw?.error || 'WhatsApp message failed to dispatch',
              sentAt: isSuccess ? new Date() : null,
            },
          });

          attemptRecords.push(attempt);
          if (isSuccess) successCount++;
          else failureCount++;
        } catch (err: any) {
          this.logger.error(`WhatsApp dispatch failed for customer ${customer.id}: ${err.message}`);
          const attempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.WHATSAPP,
              destinationMasked: maskedPhone,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'WHATSAPP_CLOUD',
              errorMessage: err.message || 'WhatsApp message failed to dispatch',
              sentAt: null,
            },
          });
          attemptRecords.push(attempt);
          failureCount++;
        }
      } else if (channel === DeliveryAttemptChannel.EMAIL) {
        const email = customer.email?.trim();
        const maskedEmail = this.maskEmail(email);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          const failedAttempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.EMAIL,
              destinationMasked: maskedEmail,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'RESEND',
              errorMessage: 'Customer has no valid email address on file',
            },
          });
          attemptRecords.push(failedAttempt);
          failureCount++;
          continue;
        }

        // ── Centralized Structured Consent & DND Policy Guard ───────────────────
        const emailConsentEval = evaluateCustomerConsent(customer, 'EMAIL');
        if (!emailConsentEval.allowed) {
          this.logger.warn(`[CONSENT] Document delivery via Email suppressed for customer ${customer.id}: ${emailConsentEval.reason}`);
          const suppressedAttempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.EMAIL,
              destinationMasked: maskedEmail,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'RESEND',
              errorMessage: `Outreach suppressed: ${emailConsentEval.reason}`,
              sentAt: null,
            },
          });
          attemptRecords.push(suppressedAttempt);
          failureCount++;
          continue;
        }

        const subject = `Requested Documents: Invoice #${invoice.number} (${invoice.currency} ${Number(invoice.outstanding).toLocaleString('en-IN')})`;
        const textContent = [
          `Invoice #${invoice.number} Documents`,
          `Dear ${customer.name},`,
          `As requested during your call with Chotu AI, please find your invoice and payment details below:`,
          `Invoice Number: #${invoice.number}`,
          `Outstanding: ${invoice.currency} ${Number(invoice.outstanding).toLocaleString('en-IN')}`,
          `Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '-'}`,
          paymentLinkUrl ? `Online Payment Link: ${paymentLinkUrl}` : '',
          signedPdfUrl ? `Download Invoice PDF (Valid for 24h): ${signedPdfUrl}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        try {
          const emailResult = await this.integrations.email.send(
            {
              to: email,
              recipientName: customer.name,
              subject,
              text: textContent,
              html: `<div style="font-family:sans-serif;line-height:1.5;">
                <h2>Invoice #${invoice.number} Documents</h2>
                <p>Dear ${customer.name},</p>
                <p>As requested during your call with Chotu AI, please find your invoice and payment details below:</p>
                <table style="border-collapse:collapse;width:100%;max-width:480px;margin:16px 0;">
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Invoice Number</strong></td><td style="padding:8px;border:1px solid #e2e8f0;">#${invoice.number}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Outstanding</strong></td><td style="padding:8px;border:1px solid #e2e8f0;">${invoice.currency} ${Number(invoice.outstanding).toLocaleString('en-IN')}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Due Date</strong></td><td style="padding:8px;border:1px solid #e2e8f0;">${invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '-'}</td></tr>
                </table>
                ${paymentLinkUrl ? `<p><a href="${paymentLinkUrl}" style="background:#2563eb;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block;">Pay Now Online</a></p>` : ''}
                ${signedPdfUrl ? `<p><a href="${signedPdfUrl}" style="color:#2563eb;text-decoration:underline;">Download Invoice PDF</a> (Valid for 24 hours)</p>` : ''}
                <hr style="margin-top:24px;border:none;border-top:1px solid #e2e8f0;" />
                <p style="font-size:12px;color:#64748b;">myCashflo Collections Assistant &bull; Tenant Isolation &bull; Automated Delivery</p>
              </div>`,
            },
            { deliveryEnabled: false }, // Simulation mode
          );

          const isSuccess = emailResult.status === 'SENT' || emailResult.status === 'DELIVERED';
          const attempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.EMAIL,
              destinationMasked: maskedEmail,
              status: isSuccess
                ? (emailResult.isSimulated ? DeliveryAttemptStatus.SIMULATED : DeliveryAttemptStatus.SENT)
                : DeliveryAttemptStatus.FAILED,
              provider: 'RESEND',
              providerMessageId: emailResult.messageId,
              errorMessage: isSuccess ? null : emailResult.error || 'Email message failed to dispatch',
              sentAt: isSuccess ? new Date() : null,
            },
          });

          attemptRecords.push(attempt);
          if (isSuccess) successCount++;
          else failureCount++;
        } catch (err: any) {
          this.logger.error(`Email dispatch failed for customer ${customer.id}: ${err.message}`);
          const attempt = await this.prisma.deliveryAttempt.create({
            data: {
              tenantId,
              requestId: deliveryRequest.id,
              channel: DeliveryAttemptChannel.EMAIL,
              destinationMasked: maskedEmail,
              status: DeliveryAttemptStatus.FAILED,
              provider: 'RESEND',
              errorMessage: err.message || 'Email message failed to dispatch',
              sentAt: null,
            },
          });
          attemptRecords.push(attempt);
          failureCount++;
        }
      }
    }

    // 8. Determine Aggregate Status
    let finalStatus: DocumentDeliveryStatus;
    if (successCount === channelsToDispatch.length) {
      finalStatus = DocumentDeliveryStatus.COMPLETED;
    } else if (successCount > 0 && failureCount > 0) {
      finalStatus = DocumentDeliveryStatus.PARTIAL_SUCCESS;
    } else {
      finalStatus = DocumentDeliveryStatus.FAILED;
    }

    const updatedRequest = await this.prisma.documentDeliveryRequest.update({
      where: { id: deliveryRequest.id },
      data: { status: finalStatus },
      include: {
        attempts: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
        invoice: { select: { id: true, number: true, amount: true, outstanding: true, status: true } },
      },
    });

    // 9. Audit Log
    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'document_delivery.processed',
      entityType: 'DocumentDeliveryRequest',
      entityId: updatedRequest.id,
      metadata: {
        invoiceNumber: invoice.number,
        customerId: customer.id,
        callSessionId: dto.callSessionId,
        requestType,
        deliveryChannel,
        status: finalStatus,
        successCount,
        failureCount,
        paymentLinkReused: isPaymentLinkReused,
      },
    });

    return {
      request: updatedRequest,
      isDuplicate: false,
      message:
        finalStatus === DocumentDeliveryStatus.COMPLETED
          ? 'Documents processed and dispatched successfully'
          : finalStatus === DocumentDeliveryStatus.PARTIAL_SUCCESS
            ? 'Documents partially dispatched; one channel could not be reached'
            : 'Failed to dispatch documents to configured channels',
    };
  }

  // ── Find Delivery Requests ─────────────────────────────────────────────────
  async findAll(user: AuthUser, query: DocumentDeliveryQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    let customerFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      customerFilter = { customerId: { in: allowedCustomerIds } };
    }

    const where: any = {
      tenantId,
      ...customerFilter,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.callSessionId ? { callSessionId: query.callSessionId } : {}),
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.documentDeliveryRequest.count({ where }),
      this.prisma.documentDeliveryRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { requestedAt: 'desc' },
        include: {
          attempts: true,
          customer: { select: { id: true, name: true, phone: true, email: true } },
          invoice: { select: { id: true, number: true, amount: true, outstanding: true, status: true } },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Find Single Delivery Request ───────────────────────────────────────────
  async findOne(id: string, user: AuthUser) {
    const { tenantId, role, userId } = user;
    const request = await this.prisma.documentDeliveryRequest.findFirst({
      where: { id, tenantId },
      include: {
        attempts: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
        invoice: { select: { id: true, number: true, amount: true, outstanding: true, status: true } },
        callSession: { select: { id: true, stage: true, outcome: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Document delivery request with ID '${id}' not found`);
    }

    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(request.customerId)) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer account');
      }
    }

    return request;
  }

  // ── Cancel Delivery Request ────────────────────────────────────────────────
  async cancelDelivery(user: AuthUser, id: string) {
    const { tenantId, role, userId } = user;
    const request = await this.prisma.documentDeliveryRequest.findFirst({
      where: { id, tenantId },
    });

    if (!request) {
      throw new NotFoundException(`Document delivery request with ID '${id}' not found`);
    }

    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(request.customerId)) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer account');
      }
    }

    const updated = await this.prisma.documentDeliveryRequest.update({
      where: { id },
      data: { status: DocumentDeliveryStatus.CANCELLED },
      include: {
        attempts: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
        invoice: { select: { id: true, number: true, amount: true, outstanding: true, status: true } },
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'document_delivery.cancelled',
      entityType: 'DocumentDeliveryRequest',
      entityId: id,
      metadata: { customerId: request.customerId, invoiceId: request.invoiceId },
    });

    return updated;
  }
}
