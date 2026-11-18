import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import {
  isPlaceholderCredential,
  resolveRazorpayKeyPair,
} from '../integrations/adapters/razorpay.adapter.js';
import { claimWebhookReplayKey, pruneExpiredWebhookReplays } from '../common/webhook-replay.util.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum, IsString, IsNumber, IsBoolean, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  PaymentMethod,
  PaymentStatus,
  InvoiceStatus,
  OrderIntentStatus,
  RefundStatus,
} from '@prisma/client';

const RESERVED_PAYMENT_REF_PREFIXES = ['PLINK-', 'PAY-WH-', 'PAY-FAIL-', 'RZP-ORD-', 'PAY-RZP-'];
const WEBHOOK_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const ORDER_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const ORDER_INTENT_CREATING_STALE_MS = 30 * 1000;

// ── DTOs ─────────────────────────────────────────────────────────────────────
export class PaymentQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() limit?: number = 20;
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
}

export class CreatePaymentLinkDto {
  @ApiProperty({ description: 'Invoice ID' })
  @IsString()
  invoiceId: string;

  @ApiPropertyOptional({ enum: ['RAZORPAY', 'STRIPE'], description: 'Payment provider' })
  @IsOptional()
  @IsString()
  provider?: 'RAZORPAY' | 'STRIPE';

  @ApiPropertyOptional({ description: 'Optional custom description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Explicit simulation flag (allowed only in non-production development/test mode)' })
  @IsOptional()
  @IsBoolean()
  simulate?: boolean;
}

export class CreateRazorpayOrderDto {
  @ApiProperty({ description: 'Invoice ID' })
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @ApiPropertyOptional({ description: 'Optional payment amount in major currency units (must not exceed remaining outstanding)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ description: 'Optional currency override (must match invoice currency)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Explicit simulation flag (forbidden in production)' })
  @IsOptional()
  @IsBoolean()
  simulate?: boolean;

  @ApiPropertyOptional({ description: 'Optional client-supplied idempotency key for safe retries' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class VerifyRazorpayPaymentDto {
  @ApiProperty({ description: 'Invoice ID associated with the checkout order' })
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @ApiProperty({ description: 'Razorpay Order ID (order_*)' })
  @IsString()
  @IsNotEmpty()
  razorpay_order_id: string;

  @ApiProperty({ description: 'Razorpay Payment ID (pay_*)' })
  @IsString()
  @IsNotEmpty()
  razorpay_payment_id: string;

  @ApiProperty({ description: 'Razorpay Checkout HMAC-SHA256 signature' })
  @IsString()
  @IsNotEmpty()
  razorpay_signature: string;
}

export class RecordPaymentDto {
  @ApiProperty({ description: 'Invoice ID' })
  @IsString()
  invoiceId: string;

  @ApiProperty({ example: 10000, description: 'Payment amount' })
  @Type(() => Number)
  @IsNumber()
  amount: number;

  @ApiProperty({ example: '2026-10-15', description: 'Date payment received' })
  @IsString()
  paymentDate: string;

  @ApiProperty({ example: 'PAY-UTR-12345678', description: 'Transaction reference or UTR' })
  @IsString()
  reference: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: 'BANK_TRANSFER' })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod = PaymentMethod.BANK_TRANSFER;

  @ApiPropertyOptional({ example: 'NEFT Transfer from Axis Bank' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'INV-2026-01' })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: 'CUST-001' })
  @IsOptional()
  @IsString()
  customerReference?: string;
}

export class RecordPaymentClaimDto {
  @ApiProperty({ description: 'Invoice ID' })
  @IsString()
  invoiceId: string;

  @ApiProperty({ example: 10000, description: 'Claimed amount paid by customer' })
  @Type(() => Number)
  @IsNumber()
  amount: number;

  @ApiProperty({ example: '2026-10-22', description: 'Claimed date payment was made' })
  @IsString()
  paymentDate: string;

  @ApiProperty({ example: 'CLAIM-UTR-99887766', description: 'Transaction reference, UTR, or cheque #' })
  @IsString()
  reference: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.BANK_TRANSFER })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod = PaymentMethod.BANK_TRANSFER;

  @ApiPropertyOptional({ example: 'Customer sent receipt copy via email' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'https://storage.mycashflo.internal/claims/receipt-001.pdf' })
  @IsOptional()
  @IsString()
  evidenceUrl?: string;
}

export class RejectPaymentClaimDto {
  @ApiPropertyOptional({
    example: 'Payment reference could not be verified on bank records',
    description: 'Reason for rejecting the payment claim',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly integrations: IntegrationsService,
  ) {}

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

  async findAll(user: AuthUser, query: PaymentQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    let customerFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      customerFilter = { customerId: { in: allowedCustomerIds } };
    }

    const where = {
      tenantId,
      ...customerFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          invoice: { select: { id: true, number: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getStats(user: AuthUser) {
    const { tenantId, role, userId } = user;

    let customerFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      customerFilter = { customerId: { in: allowedCustomerIds } };
    }

    const [totalCollected, countByMethod] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED', ...customerFilter },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { tenantId, status: 'COMPLETED', ...customerFilter },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      totalCollected: totalCollected._sum.amount ?? 0,
      totalPayments: totalCollected._count,
      byMethod: countByMethod.map((m) => ({
        method: m.method,
        amount: m._sum.amount ?? 0,
        count: m._count,
      })),
    };
  }

  async recordPayment(user: AuthUser, dto: RecordPaymentDto) {
    const { tenantId, userId, role } = user;

    if (role === 'AGENT') {
      throw new ForbiddenException(
        'Agents cannot directly record settlement payments or adjust invoice balances. Please submit a payment claim for verification.',
      );
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment for a CANCELLED invoice');
    }

    const payAmt = Number(dto.amount);
    if (isNaN(payAmt) || payAmt <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const currentOutstanding = Number(invoice.outstanding);
    if (payAmt > currentOutstanding) {
      throw new BadRequestException(
        `Payment amount (₹${payAmt}) cannot exceed remaining invoice outstanding balance (₹${currentOutstanding})`,
      );
    }

    const cleanRef = dto.reference.trim();
    if (!cleanRef) {
      throw new BadRequestException('Payment reference/UTR is required');
    }
    if (RESERVED_PAYMENT_REF_PREFIXES.some((prefix) => cleanRef.toUpperCase().startsWith(prefix))) {
      throw new BadRequestException('Payment reference uses a reserved system prefix');
    }

    const existingPay = await this.prisma.payment.findFirst({
      where: { tenantId, ref: cleanRef },
    });
    if (existingPay) {
      throw new BadRequestException(`Payment with reference '${cleanRef}' already exists in this tenant`);
    }

    const payDate = new Date(dto.paymentDate);
    if (isNaN(payDate.getTime())) {
      throw new BadRequestException('Invalid payment date format. Expected YYYY-MM-DD');
    }

    const runInTx = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      if (typeof this.prisma.$transaction === 'function') {
        return this.prisma.$transaction(fn);
      }
      return fn(this.prisma);
    };

    const { payment, newOutstanding, newStatus } = await runInTx(async (tx) => {
      await this.acquireCustomerAndInvoiceLocksTx(tx, invoice.customerId, invoice.id, tenantId);
      const lockedInvoice =
        typeof tx.invoice?.findFirst === 'function'
          ? await tx.invoice.findFirst({
              where: { id: invoice.id, tenantId },
              include: { customer: true },
            })
          : invoice;
      if (!lockedInvoice) {
        throw new NotFoundException('Invoice not found in tenant');
      }
      if (lockedInvoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('Cannot record payment for a CANCELLED invoice');
      }
      const freshOutstanding = Number(lockedInvoice.outstanding);
      if (payAmt > freshOutstanding) {
        throw new BadRequestException(
          `Payment amount (₹${payAmt}) cannot exceed remaining invoice outstanding balance (₹${freshOutstanding})`,
        );
      }

      const computedOutstanding = Math.max(0, Number((freshOutstanding - payAmt).toFixed(4)));
      const computedStatus: InvoiceStatus =
        computedOutstanding === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

      const createdPay = await tx.payment.create({
        data: {
          tenantId,
          ref: cleanRef,
          providerRef: cleanRef,
          invoiceId: lockedInvoice.id,
          customerId: lockedInvoice.customerId,
          amount: payAmt,
          currency: lockedInvoice.currency,
          paidAt: payDate,
          method: dto.method || PaymentMethod.BANK_TRANSFER,
          status: PaymentStatus.COMPLETED,
          notes: dto.notes || 'Manually recorded settlement',
        },
      });

      await tx.invoice.update({
        where: { id: lockedInvoice.id },
        data: {
          outstanding: computedOutstanding,
          status: computedStatus,
        },
      });

      if (computedStatus === InvoiceStatus.PAID && tx.collectionCase?.updateMany) {
        try {
          await tx.collectionCase.updateMany({
            where: { tenantId, invoiceId: lockedInvoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
          });
        } catch {
          // Safe fallback in test mocks
        }
      }

      await this.recalculateCustomerOutstandingTx(
        tx,
        lockedInvoice.customerId,
        tenantId,
        Math.max(0, Number(lockedInvoice.customer?.outstandingBalance ?? 0) - payAmt),
      );

      return {
        payment: createdPay,
        newOutstanding: computedOutstanding,
        newStatus: computedStatus,
      };
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.manually_recorded',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: {
        invoiceNumber: invoice.number,
        amount: payAmt,
        reference: cleanRef,
        remainingOutstanding: newOutstanding,
      },
    });

    return {
      success: true,
      payment,
      invoiceNumber: invoice.number,
      remainingOutstanding: newOutstanding,
      newStatus,
    };
  }

  async recordPaymentClaim(user: AuthUser, dto: RecordPaymentClaimDto) {
    const { tenantId, userId, role } = user;

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment claim for a CANCELLED invoice');
    }

    // If caller is an AGENT, enforce customer/case assignment check
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this customer or collection case',
        );
      }
    }

    const claimAmt = Number(dto.amount);
    if (isNaN(claimAmt) || claimAmt <= 0) {
      throw new BadRequestException('Claimed payment amount must be greater than 0');
    }

    const cleanRef = dto.reference.trim();
    if (!cleanRef) {
      throw new BadRequestException('Payment reference/UTR is required');
    }
    if (RESERVED_PAYMENT_REF_PREFIXES.some((prefix) => cleanRef.toUpperCase().startsWith(prefix))) {
      throw new BadRequestException('Payment reference uses a reserved system prefix');
    }

    const existingPay = await this.prisma.payment.findFirst({
      where: { tenantId, ref: cleanRef },
    });
    if (existingPay) {
      throw new BadRequestException(`Payment with reference '${cleanRef}' already exists in this tenant`);
    }

    // Save claim with PENDING status (AWAITING_VERIFICATION)
    // CRITICAL: DO NOT reduce invoice.outstanding!
    // CRITICAL: DO NOT mark invoice PAID!
    // CRITICAL: DO NOT alter customer.outstandingBalance!
    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        ref: cleanRef,
        providerRef: dto.evidenceUrl ? `evidence:${dto.evidenceUrl}` : cleanRef,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: claimAmt,
        currency: invoice.currency,
        paidAt: null, // Left null until verified
        method: dto.method || PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.PENDING,
        notes: `AWAITING_VERIFICATION: ${dto.notes || 'Customer stated payment made'}${
          dto.evidenceUrl ? ` [Evidence: ${dto.evidenceUrl}]` : ''
        }`,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.claim_submitted',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerId: invoice.customerId,
        claimedAmount: claimAmt,
        reference: cleanRef,
        evidenceUrl: dto.evidenceUrl,
        status: 'AWAITING_VERIFICATION',
        outstandingRemaining: Number(invoice.outstanding),
      },
    });

    return {
      success: true,
      claimStatus: 'AWAITING_VERIFICATION',
      payment,
      invoiceNumber: invoice.number,
      outstandingBalance: Number(invoice.outstanding),
      invoiceStatus: invoice.status,
      message: 'Payment claim recorded successfully. Outstanding balance remains unchanged pending admin verification.',
    };
  }

  async verifyPaymentClaim(id: string, user: AuthUser) {
    const { tenantId, userId, role } = user;

    if (role === 'AGENT') {
      throw new ForbiddenException('Only Administrators and Managers can verify payment claims');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { invoice: true, customer: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment claim not found in current tenant');
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      return {
        success: true,
        alreadyVerified: true,
        payment,
        message: 'Payment claim has already been verified and reconciled.',
      };
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`Cannot verify payment with status '${payment.status}'`);
    }

    const invoice = payment.invoice;
    if (!invoice) {
      throw new NotFoundException('Associated invoice not found');
    }

    const payAmt = Number(payment.amount);
    const runInTx = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      if (typeof this.prisma.$transaction === 'function') {
        return this.prisma.$transaction(fn);
      }
      return fn(this.prisma);
    };

    const { updatedPayment, newOutstanding, newStatus } = await runInTx(async (tx) => {
      await this.acquireCustomerAndInvoiceLocksTx(tx, invoice.customerId, invoice.id, tenantId);
      const lockedInvoice =
        typeof tx.invoice?.findFirst === 'function'
          ? (await tx.invoice.findFirst({
              where: { id: invoice.id, tenantId },
              include: { customer: true },
            })) || invoice
          : invoice;

      const currentOutstanding = Number(lockedInvoice.outstanding);
      const computedOutstanding = Math.max(0, Number((currentOutstanding - payAmt).toFixed(4)));
      const computedStatus: InvoiceStatus =
        computedOutstanding === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

      const [savedPayment] = await Promise.all([
        tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            paidAt: new Date(),
            notes: `${payment.notes || ''} [VERIFIED by ${userId} at ${new Date().toISOString()}]`.trim(),
          },
        }),
        tx.invoice.update({
          where: { id: lockedInvoice.id },
          data: {
            outstanding: computedOutstanding,
            status: computedStatus,
          },
        }),
      ]);

      if (computedStatus === InvoiceStatus.PAID && tx.collectionCase?.updateMany) {
        try {
          await tx.collectionCase.updateMany({
            where: { tenantId, invoiceId: lockedInvoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
            data: { status: 'RESOLVED', resolvedAt: new Date() },
          });
        } catch {
          // Safe fallback in test mocks
        }
      }

      await this.recalculateCustomerOutstandingTx(
        tx,
        lockedInvoice.customerId,
        tenantId,
        Math.max(0, Number(lockedInvoice.customer?.outstandingBalance ?? 0) - payAmt),
      );

      return {
        updatedPayment: savedPayment,
        newOutstanding: computedOutstanding,
        newStatus: computedStatus,
      };
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.claim_verified',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: {
        invoiceNumber: invoice.number,
        verifiedAmount: payAmt,
        reference: payment.ref,
        remainingOutstanding: newOutstanding,
      },
    });

    return {
      success: true,
      payment: updatedPayment,
      invoiceNumber: invoice.number,
      remainingOutstanding: newOutstanding,
      newStatus,
    };
  }

  async rejectPaymentClaim(id: string, user: AuthUser, dto?: RejectPaymentClaimDto) {
    const { tenantId, userId, role } = user;

    if (role === 'AGENT') {
      throw new ForbiddenException('Only Administrators and Managers can reject payment claims');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: { invoice: true, customer: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment claim not found in current tenant');
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Cannot reject an already verified and completed payment');
    }

    if (payment.status === PaymentStatus.FAILED) {
      return {
        success: true,
        alreadyRejected: true,
        payment,
        invoiceNumber: payment.invoice?.number,
        outstandingBalance: Number(payment.invoice?.outstanding ?? 0),
        invoiceStatus: payment.invoice?.status,
        message: 'Payment claim has already been rejected.',
      };
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`Cannot reject payment with status '${payment.status}'`);
    }

    const rejectionReason = dto?.reason?.trim() || 'Claim rejected by administrator';

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        notes: `${payment.notes || ''} [REJECTED by ${userId}: ${rejectionReason} at ${new Date().toISOString()}]`.trim(),
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.claim_rejected',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: {
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice?.number,
        rejectedAmount: Number(payment.amount),
        reference: payment.ref,
        reason: rejectionReason,
        outstandingBalance: Number(payment.invoice?.outstanding ?? 0),
      },
    });

    return {
      success: true,
      payment: updatedPayment,
      invoiceNumber: payment.invoice?.number,
      outstandingBalance: Number(payment.invoice?.outstanding ?? 0),
      invoiceStatus: payment.invoice?.status,
      message: 'Payment claim has been rejected. Invoice balance remains unchanged.',
    };
  }

  async createPaymentLink(user: AuthUser, dto: CreatePaymentLinkDto) {
    const { tenantId, userId, role } = user;

    // 1. Fetch invoice with customer (tenant-isolated)
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
    }

    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this customer or collection case',
        );
      }
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already marked as PAID');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot generate payment link for CANCELLED invoice');
    }

    const outstanding = Number(invoice.outstanding);
    if (outstanding <= 0) {
      throw new BadRequestException('Invoice has no remaining outstanding balance');
    }

    // 2. Select Provider: Defaults to RAZORPAY for INR, STRIPE for others or if requested
    const selectedProvider: 'RAZORPAY' | 'STRIPE' =
      dto.provider || (invoice.currency.toUpperCase() === 'USD' ? 'STRIPE' : 'RAZORPAY');

    const providerConfig = await this.integrations.getRawConfig(tenantId, selectedProvider);

    if (process.env.NODE_ENV === 'production' && dto.simulate === true) {
      throw new BadRequestException('Payment link simulation mode is strictly prohibited in production');
    }

    const adapterConfig = {
      ...providerConfig,
      simulate: dto.simulate,
    };

    // 3. Generate Link via Adapter
    const linkInput = {
      invoiceNumber: invoice.number,
      amount: outstanding,
      currency: invoice.currency,
      customerName: invoice.customer.name,
      customerEmail: invoice.customer.email,
      customerPhone: invoice.customer.phone,
      description: dto.description || `Payment for Invoice ${invoice.number}`,
      tenantId,
      invoiceId: invoice.id,
      notifyCustomer: false,
    };

    const linkResult =
      selectedProvider === 'RAZORPAY'
        ? await this.integrations.razorpay.createPaymentLink(linkInput, adapterConfig)
        : await this.integrations.stripe.createPaymentLink(linkInput, adapterConfig);

    // 4. Create pending payment record
    const paymentRef = `PLINK-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const payment = await this.prisma.payment.create({
      data: {
        ref: paymentRef,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        amount: invoice.outstanding,
        currency: invoice.currency,
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.PENDING,
        providerRef: linkResult.id,
        notes: `${linkResult.url} [link:${linkResult.id}]`,
        tenantId,
      },
    });

    // 5. Audit Log
    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.link_created',
      entityType: 'Payment',
      entityId: payment.id,
      metadata: {
        invoiceNumber: invoice.number,
        provider: selectedProvider,
        paymentLinkId: linkResult.id,
        shortUrl: linkResult.url,
        isSimulated: linkResult.isSimulated,
        amount: outstanding,
      },
    });

    return {
      paymentLinkId: linkResult.id,
      paymentId: payment.id,
      provider: selectedProvider,
      shortUrl: linkResult.url,
      amount: outstanding,
      currency: invoice.currency,
      status: 'PENDING',
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      isSimulated: linkResult.isSimulated,
    };
  }

  private getHeaderValue(headers: Record<string, string | string[] | undefined>, key: string): string {
    const target = key.toLowerCase();
    for (const [k, v] of Object.entries(headers || {})) {
      if (k.toLowerCase() === target) {
        if (Array.isArray(v)) return String(v[0] || '').trim();
        return typeof v === 'string' ? v.trim() : '';
      }
    }
    return '';
  }

  private parseWebhookCandidateHints(
    normalizedProvider: string,
    payload: any,
    rawBody?: Buffer | string,
  ): {
    paymentLinkId?: string;
    providerPaymentId?: string;
    providerOrderId?: string;
    providerRefundId?: string;
    rawBodyStr: string;
  } {
    const rawBodyStr =
      rawBody !== undefined
        ? Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : String(rawBody)
        : typeof payload === 'string'
          ? payload
          : JSON.stringify(payload || {});

    let parsed: any = payload;
    if (rawBody !== undefined) {
      try {
        parsed = JSON.parse(rawBodyStr);
      } catch {
        parsed = typeof payload === 'object' && payload !== null ? payload : {};
      }
    } else if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload);
      } catch {
        parsed = {};
      }
    }

    if (normalizedProvider === 'STRIPE') {
      const obj = parsed?.data?.object || {};
      const paymentLinkId = obj?.id || parsed?.paymentLinkId;
      const providerPaymentId = obj?.payment_intent || parsed?.paymentId;
      return {
        paymentLinkId: paymentLinkId ? String(paymentLinkId).trim() : undefined,
        providerPaymentId: providerPaymentId ? String(providerPaymentId).trim() : undefined,
        rawBodyStr,
      };
    }

    const paymentEntity = parsed?.payload?.payment?.entity || parsed?.payment || {};
    const refundEntity = parsed?.payload?.refund?.entity || parsed?.refund || {};
    const linkEntity = parsed?.payload?.payment_link?.entity || parsed?.payment_link || {};
    const orderEntity = parsed?.payload?.order?.entity || parsed?.order || {};
    const paymentLinkId = linkEntity?.id || parsed?.paymentLinkId;
    const providerPaymentId = refundEntity?.payment_id || paymentEntity?.id || parsed?.paymentId;
    const providerOrderId = paymentEntity?.order_id || orderEntity?.id || parsed?.orderId;
    const providerRefundId = refundEntity?.id || parsed?.refundId;

    return {
      paymentLinkId: paymentLinkId ? String(paymentLinkId).trim() : undefined,
      providerPaymentId: providerPaymentId ? String(providerPaymentId).trim() : undefined,
      providerOrderId: providerOrderId ? String(providerOrderId).trim() : undefined,
      providerRefundId: providerRefundId ? String(providerRefundId).trim() : undefined,
      rawBodyStr,
    };
  }

  private async resolveTrustedAnchorPayment(
    paymentLinkId?: string,
    providerPaymentId?: string,
    providerOrderId?: string,
    providerRefundId?: string,
  ) {
    const anchorOr: any[] = [];
    if (paymentLinkId) {
      anchorOr.push({ providerRef: paymentLinkId, method: PaymentMethod.PAYMENT_LINK });
      anchorOr.push({
        method: PaymentMethod.PAYMENT_LINK,
        ref: { startsWith: 'PAY-WH-' },
        notes: { contains: `[link:${paymentLinkId}]` },
      });
      anchorOr.push({
        method: PaymentMethod.PAYMENT_LINK,
        ref: { startsWith: 'PAY-FAIL-' },
        notes: { contains: `[link:${paymentLinkId}]` },
      });
    }
    if (providerOrderId) {
      anchorOr.push({ providerRef: providerOrderId, ref: { startsWith: 'RZP-ORD-' } });
      anchorOr.push({ providerRef: providerOrderId, method: PaymentMethod.PAYMENT_LINK });
      anchorOr.push({
        ref: { startsWith: 'PAY-WH-' },
        notes: { contains: `[order:${providerOrderId}]` },
      });
      anchorOr.push({
        ref: { startsWith: 'PAY-FAIL-' },
        notes: { contains: `[order:${providerOrderId}]` },
      });
    }
    if (providerPaymentId) {
      anchorOr.push({ providerRef: providerPaymentId, method: PaymentMethod.PAYMENT_LINK });
      anchorOr.push({ ref: `PAY-WH-${providerPaymentId}` });
      anchorOr.push({ ref: `PAY-FAIL-${providerPaymentId}` });
    }

    if (anchorOr.length > 0) {
      const matches = await this.prisma.payment.findMany({
        where: { OR: anchorOr },
      });

      if (matches && matches.length > 0) {
        const distinctTenants = new Set(matches.map((m) => m.tenantId));
        const distinctInvoices = new Set(matches.map((m) => m.invoiceId));
        if (distinctTenants.size > 1 || distinctInvoices.size > 1) {
          this.logger.warn('Rejected webhook: provider reference matched ambiguous tenant/invoice records');
          throw new BadRequestException('Ambiguous payment reference in webhook');
        }
        return (
          matches.find(
            (m) => m.status === PaymentStatus.COMPLETED || m.status === PaymentStatus.REFUNDED,
          ) ||
          matches.find((m) => m.status === PaymentStatus.PENDING) ||
          matches[0]
        );
      }
    }

    // Refund webhook fallback anchor via PaymentRefund if payment link/payment match wasn't direct
    if (providerRefundId && (this.prisma as any).paymentRefund?.findFirst) {
      const refundRow = await (this.prisma as any).paymentRefund.findFirst({
        where: { providerRefundId },
        include: { payment: true },
      });
      if (refundRow?.payment) {
        return refundRow.payment;
      }
    }

    // Recovery anchor if DB payment insert failed right after Razorpay /v1/orders creation
    if (providerOrderId && (this.prisma as any).paymentOrderIntent?.findFirst) {
      const intent = await (this.prisma as any).paymentOrderIntent.findFirst({
        where: { providerOrderId },
      });
      if (intent?.tenantId && intent?.invoiceId && intent?.customerId) {
        const materialized = await this.ensureOrderPaymentForIntent(intent, providerOrderId);
        if (materialized) {
          return materialized;
        }
      }
    }

    return null;
  }

  /**
   * Acquires PostgreSQL FOR UPDATE row locks in a strict global parent -> child order
   * (Customer FIRST, Invoice SECOND) so concurrent settlements or refunds across different
   * invoices for the same customer serialize safely without deadlocks or lost balance updates.
   */
  private async acquireCustomerAndInvoiceLocksTx(
    tx: any,
    customerId: string,
    invoiceId: string,
    tenantId: string,
  ): Promise<void> {
    if (typeof tx.$queryRaw !== 'function') {
      return;
    }
    try {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    } catch (lockErr: any) {
      const isTestEnv = process.env.NODE_ENV === 'test';
      const hasPgErrorCode = Boolean(lockErr?.code || lockErr?.meta?.code);
      if (!isTestEnv || hasPgErrorCode) {
        this.logger.error(
          `PostgreSQL FOR UPDATE lock failure (customer=${customerId}, invoice=${invoiceId}): ${lockErr?.message || lockErr}`,
        );
        throw lockErr;
      }
      this.logger.debug(`Row lock skipped in unit test mock: ${lockErr?.message}`);
    }
  }

  private async recalculateCustomerOutstandingTx(tx: any, customerId: string, tenantId: string, fallbackBalance: number) {
    let newCustBalance = fallbackBalance;
    if (typeof tx.invoice.findMany === 'function') {
      const unpaidCustomerInvoices = await tx.invoice.findMany({
        where: {
          customerId,
          tenantId,
          status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
        },
        select: { outstanding: true },
      });
      newCustBalance = unpaidCustomerInvoices.reduce(
        (sum: number, inv: any) => sum + Number(inv.outstanding),
        0,
      );
    }

    await tx.customer.update({
      where: { id: customerId },
      data: {
        outstandingBalance: newCustBalance,
      },
    });
    return newCustBalance;
  }

  private async reconcileSettledPaymentTx(
    tx: any,
    params: {
      tenantId: string;
      invoice: any;
      pendingPayment: any | null;
      paidAmount: number;
      stableRef: string;
      providerRef: string | null;
      providerOrderId?: string | null;
      notePrefix: string;
      extraNoteTags: string;
    },
  ) {
    const {
      tenantId,
      invoice,
      pendingPayment,
      paidAmount,
      stableRef,
      providerRef,
      providerOrderId,
      notePrefix,
      extraNoteTags,
    } = params;

    const currentInvoiceOutstanding = Number(invoice.outstanding);
    const overpaymentAmount = Math.max(
      0,
      Number((paidAmount - currentInvoiceOutstanding).toFixed(4)),
    );
    const actualDeduction = Math.min(currentInvoiceOutstanding, paidAmount);
    const newInvoiceOutstanding = Math.max(
      0,
      Number((currentInvoiceOutstanding - actualDeduction).toFixed(4)),
    );
    const newInvoiceStatus =
      newInvoiceOutstanding <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

    const reconciliationNote = `${notePrefix} ${extraNoteTags}${
      overpaymentAmount > 0 ? ` [OVERPAYMENT:${overpaymentAmount}]` : ''
    }`.trim();

    let settledPayment;
    if (pendingPayment) {
      settledPayment = await tx.payment.update({
        where: { id: pendingPayment.id },
        data: {
          ref: stableRef,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
          amount: paidAmount,
          providerRef: providerRef || pendingPayment.providerRef,
          notes: reconciliationNote,
        },
      });
    } else {
      settledPayment = await tx.payment.create({
        data: {
          ref: stableRef,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          amount: paidAmount,
          currency: invoice.currency,
          method: PaymentMethod.PAYMENT_LINK,
          status: PaymentStatus.COMPLETED,
          providerRef,
          paidAt: new Date(),
          notes: reconciliationNote,
          tenantId,
        },
      });
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        outstanding: newInvoiceOutstanding,
        status: newInvoiceStatus,
      },
    });

    if (tx.paymentOrderIntent?.updateMany) {
      const intentOr: any[] = [];
      if (providerOrderId) intentOr.push({ providerOrderId });
      if (pendingPayment?.id) intentOr.push({ paymentId: pendingPayment.id });
      if (intentOr.length > 0) {
        await tx.paymentOrderIntent.updateMany({
          where: {
            tenantId,
            invoiceId: invoice.id,
            status: { in: [OrderIntentStatus.CREATING, OrderIntentStatus.CREATED] },
            OR: intentOr,
          },
          data: {
            status: OrderIntentStatus.COMPLETED,
            activeClaimKey: null,
            paymentId: settledPayment.id,
          },
        });
      }
    }

    if (newInvoiceStatus === InvoiceStatus.PAID && tx.collectionCase?.updateMany) {
      try {
        await tx.collectionCase.updateMany({
          where: { tenantId, invoiceId: invoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
      } catch {
        // Safe fallback in unit mocks lacking full Prisma collectionCase filtering
      }
    }

    const fallbackBalance = Math.max(
      0,
      Number(invoice.customer.outstandingBalance) - actualDeduction,
    );
    const newCustBalance = await this.recalculateCustomerOutstandingTx(
      tx,
      invoice.customerId,
      tenantId,
      fallbackBalance,
    );

    return {
      settledPayment,
      newInvoiceOutstanding,
      newInvoiceStatus,
      overpaymentAmount,
      newCustBalance,
    };
  }

  private async applyConfirmedRefundTx(
    tx: any,
    params: {
      tenantId: string;
      invoice: any;
      payment: any;
      provider: string;
      providerRefundId: string;
      providerPaymentId: string;
      refundAmount: number;
      currency: string;
      reason?: string;
      rawEvent?: string;
    },
  ) {
    const {
      tenantId,
      invoice,
      payment,
      provider,
      providerRefundId,
      providerPaymentId,
      refundAmount,
      currency,
      reason,
      rawEvent,
    } = params;

    const processedRefundsForPayment = await tx.paymentRefund.findMany({
      where: {
        tenantId,
        paymentId: payment.id,
        status: RefundStatus.PROCESSED,
      },
    });
    const alreadyRefundedOnPayment = (processedRefundsForPayment || []).reduce(
      (sum: number, r: any) => sum + Number(r.amount),
      0,
    );

    const existingRefund = await tx.paymentRefund.findFirst({
      where: { providerRefundId, tenantId },
    });

    if (existingRefund?.status === RefundStatus.PROCESSED) {
      return {
        idempotent: true,
        refund: existingRefund,
        paymentStatus: payment.status,
        newInvoiceOutstanding: Number(invoice.outstanding),
        newInvoiceStatus: invoice.status,
        newCustBalance: Number(invoice.customer?.outstandingBalance ?? 0),
        totalRefundedOnPayment: alreadyRefundedOnPayment,
      };
    }

    const paidAmount = Number(payment.amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new BadRequestException('Invalid refund amount');
    }
    if (alreadyRefundedOnPayment + refundAmount > paidAmount + 0.0001) {
      throw new BadRequestException(
        `Refund amount (${refundAmount}) exceeds remaining refundable amount (${Math.max(0, paidAmount - alreadyRefundedOnPayment)}) for payment ${payment.id}`,
      );
    }

    let refundRow;
    if (existingRefund) {
      refundRow = await tx.paymentRefund.update({
        where: { id: existingRefund.id },
        data: {
          amount: refundAmount,
          currency,
          status: RefundStatus.PROCESSED,
          processedAt: new Date(),
          reason: reason || existingRefund.reason,
          rawEvent: rawEvent || existingRefund.rawEvent,
        },
      });
    } else {
      refundRow = await tx.paymentRefund.create({
        data: {
          tenantId,
          paymentId: payment.id,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          provider,
          providerRefundId,
          providerPaymentId,
          amount: refundAmount,
          currency,
          status: RefundStatus.PROCESSED,
          reason,
          rawEvent,
          processedAt: new Date(),
        },
      });
    }

    const totalRefundedOnPayment = Number((alreadyRefundedOnPayment + refundAmount).toFixed(4));
    const isPaymentFullyRefunded = totalRefundedOnPayment >= paidAmount - 0.0001;
    const nextPaymentStatus = isPaymentFullyRefunded ? PaymentStatus.REFUNDED : payment.status;

    if (nextPaymentStatus !== payment.status) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: nextPaymentStatus },
      });
    }

    // Account for any prior unapplied overpayment before restoring invoice outstanding
    const overpayMatch = String(payment.notes || '').match(/\[OVERPAYMENT:([0-9.]+)\]/);
    const originalOverpayment = overpayMatch ? Number(overpayMatch[1]) : 0;
    const unrefundedOverpayment = Math.max(0, originalOverpayment - alreadyRefundedOnPayment);
    const invoiceRestoration = Math.max(
      0,
      Number((refundAmount - unrefundedOverpayment).toFixed(4)),
    );

    const invoiceAmount = Number(invoice.amount);
    const currentOutstanding = Number(invoice.outstanding);
    const newInvoiceOutstanding = Math.min(
      invoiceAmount,
      Math.max(0, Number((currentOutstanding + invoiceRestoration).toFixed(4))),
    );

    let newInvoiceStatus: InvoiceStatus;
    if (newInvoiceOutstanding <= 0) {
      newInvoiceStatus = InvoiceStatus.PAID;
    } else if (newInvoiceOutstanding < invoiceAmount) {
      newInvoiceStatus = InvoiceStatus.PARTIALLY_PAID;
    } else {
      const isPastDue = Boolean(invoice.dueDate && new Date(invoice.dueDate) < new Date());
      newInvoiceStatus = isPastDue ? InvoiceStatus.OVERDUE : InvoiceStatus.OPEN;
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        outstanding: newInvoiceOutstanding,
        status: newInvoiceStatus,
      },
    });

    if (newInvoiceStatus !== InvoiceStatus.PAID && tx.collectionCase?.updateMany) {
      try {
        await tx.collectionCase.updateMany({
          where: { tenantId, invoiceId: invoice.id, status: 'RESOLVED' },
          data: { status: 'OPEN', resolvedAt: null },
        });
      } catch {
        // Safe fallback in unit mocks
      }
    }

    const fallbackBalance = Math.max(
      0,
      Number(invoice.customer?.outstandingBalance ?? 0) + invoiceRestoration,
    );
    const newCustBalance = await this.recalculateCustomerOutstandingTx(
      tx,
      invoice.customerId,
      tenantId,
      fallbackBalance,
    );

    return {
      idempotent: false,
      refund: refundRow,
      paymentStatus: nextPaymentStatus,
      newInvoiceOutstanding,
      newInvoiceStatus,
      newCustBalance,
      totalRefundedOnPayment,
      invoiceRestoration,
    };
  }

  private async ensureOrderPaymentForIntent(intent: any, orderId: string) {
    try {
      const existing = await this.prisma.payment.findFirst({
        where: {
          tenantId: intent.tenantId,
          invoiceId: intent.invoiceId,
          OR: [{ ref: `RZP-ORD-${orderId}` }, { providerRef: orderId }],
        },
      });
      if (existing) {
        return existing;
      }
      const created = await this.prisma.payment.create({
        data: {
          ref: `RZP-ORD-${orderId}`,
          customerId: intent.customerId,
          invoiceId: intent.invoiceId,
          amount: Number(intent.amount),
          currency: intent.currency,
          method: PaymentMethod.PAYMENT_LINK,
          status: PaymentStatus.PENDING,
          providerRef: orderId,
          notes: `Razorpay Checkout Order [order:${orderId}] [receipt:${intent.receipt}]`,
          tenantId: intent.tenantId,
        },
      });
      if ((this.prisma as any).paymentOrderIntent?.update) {
        await (this.prisma as any).paymentOrderIntent
          .update({
            where: { id: intent.id },
            data: {
              status: OrderIntentStatus.CREATED,
              providerOrderId: orderId,
              paymentId: created.id,
            },
          })
          .catch(() => undefined);
      }
      return created;
    } catch {
      return null;
    }
  }

  private buildRazorpayOrderResponse(params: {
    orderId: string;
    paymentId: string;
    keyId: string;
    amount: number;
    amountInPaise: number;
    currency: string;
    receipt?: string;
    invoice: any;
    reusedExistingOrder: boolean;
    recoveredFromCrash?: boolean;
    isSimulated: boolean;
  }) {
    const {
      orderId,
      paymentId,
      keyId,
      amount,
      amountInPaise,
      currency,
      receipt,
      invoice,
      reusedExistingOrder,
      recoveredFromCrash,
      isSimulated,
    } = params;
    return {
      orderId,
      paymentId,
      provider: 'RAZORPAY' as const,
      keyId,
      amount,
      amountInPaise,
      currency,
      ...(receipt ? { receipt } : {}),
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.customer?.name || '',
      customerEmail: invoice.customer?.email || '',
      customerPhone: invoice.customer?.phone || '',
      status: 'CREATED',
      reusedExistingOrder,
      ...(recoveredFromCrash ? { recovered: true } : {}),
      isSimulated,
    };
  }

  async createRazorpayOrder(user: AuthUser, dto: CreateRazorpayOrderDto) {
    const { tenantId, userId, role } = user;

    // 1. Unified simulation check & invoice/ownership/amount/currency validation BEFORE claiming
    const isSimulation = this.integrations.razorpay.isSimulationEnabled(dto.simulate);

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
    }

    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this customer or collection case',
        );
      }
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Cannot create Razorpay order for DRAFT invoice');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already marked as PAID');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot create Razorpay order for CANCELLED invoice');
    }

    const invoiceCurrency = (invoice.currency || 'INR').trim().toUpperCase();
    if (dto.currency !== undefined) {
      const reqCurrency = dto.currency.trim().toUpperCase();
      if (!reqCurrency || reqCurrency !== invoiceCurrency) {
        throw new BadRequestException(
          `Currency mismatch: invoice currency is ${invoiceCurrency}, received ${reqCurrency || 'empty'}`,
        );
      }
    }

    const outstanding = Number(invoice.outstanding);
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      throw new BadRequestException('Invoice has no remaining outstanding balance');
    }

    const payableAmount = dto.amount !== undefined ? Number(dto.amount) : outstanding;
    if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
      throw new BadRequestException('Order amount must be greater than 0');
    }
    if (payableAmount > outstanding) {
      throw new BadRequestException(
        `Order amount (${payableAmount}) cannot exceed remaining invoice outstanding balance (${outstanding})`,
      );
    }

    const amountInPaise = Math.round(payableAmount * 100);
    if (amountInPaise < 100) {
      throw new BadRequestException('Razorpay order amount must be at least 1.00 (100 paise)');
    }

    const tenantConfig =
      typeof this.integrations?.getRawConfig === 'function'
        ? await this.integrations.getRawConfig(tenantId, 'RAZORPAY')
        : {};
    const adapterConfig = {
      ...tenantConfig,
      simulate: dto.simulate,
    };

    const keyPair = resolveRazorpayKeyPair(tenantConfig);
    if (keyPair.source === 'partial_tenant') {
      throw new BadRequestException(
        'Incomplete tenant Razorpay configuration: both Key ID and Key Secret must be provided together.',
      );
    }
    if (!isSimulation) {
      this.integrations.razorpay.validateCredentials(adapterConfig);
    }

    const publicKeyId =
      !isPlaceholderCredential(keyPair.keyId) &&
      (keyPair.keyId.startsWith('rzp_test_') || keyPair.keyId.startsWith('rzp_live_'))
        ? keyPair.keyId
        : 'rzp_test_simulation';

    const claimKey = `${tenantId}:${invoice.id}:${amountInPaise}:${invoiceCurrency}`;
    const explicitKey = dto.idempotencyKey?.trim();
    const requestIdempotencyKey = explicitKey
      ? `req:${tenantId}:${invoice.id}:${explicitKey}`
      : null;

    // 2. Acquire or reuse persistent order intent BEFORE calling Razorpay (no long lock held across HTTP)
    let claimedIntent: any = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = new Date();
      const existingIntent = await (this.prisma as any).paymentOrderIntent.findFirst({
        where: requestIdempotencyKey
          ? { OR: [{ idempotencyKey: requestIdempotencyKey }, { activeClaimKey: claimKey }] }
          : { activeClaimKey: claimKey },
        orderBy: { createdAt: 'desc' },
      });

      if (existingIntent) {
        if (
          requestIdempotencyKey &&
          existingIntent.idempotencyKey === requestIdempotencyKey &&
          (existingIntent.amountInPaise !== amountInPaise ||
            existingIntent.currency !== invoiceCurrency)
        ) {
          throw new BadRequestException(
            'Idempotency key already used with different order amount or currency',
          );
        }

        if (existingIntent.status === OrderIntentStatus.CREATED) {
          if (new Date(existingIntent.expiresAt).getTime() <= now.getTime()) {
            await (this.prisma as any).paymentOrderIntent.updateMany({
              where: { id: existingIntent.id, status: OrderIntentStatus.CREATED },
              data: { status: OrderIntentStatus.EXPIRED, activeClaimKey: null },
            });
            continue;
          }

          if (existingIntent.providerOrderId) {
            const linkedPayment =
              (await this.prisma.payment.findFirst({
                where: {
                  tenantId,
                  invoiceId: invoice.id,
                  OR: [
                    ...(existingIntent.paymentId ? [{ id: existingIntent.paymentId }] : []),
                    { ref: `RZP-ORD-${existingIntent.providerOrderId}` },
                    { providerRef: existingIntent.providerOrderId },
                  ],
                },
              })) ||
              (await this.ensureOrderPaymentForIntent(existingIntent, existingIntent.providerOrderId));

            if (linkedPayment?.status === PaymentStatus.FAILED) {
              await (this.prisma as any).paymentOrderIntent.updateMany({
                where: { id: existingIntent.id },
                data: { status: OrderIntentStatus.FAILED, activeClaimKey: null },
              });
              continue;
            }

            if (linkedPayment) {
              return this.buildRazorpayOrderResponse({
                orderId: existingIntent.providerOrderId,
                paymentId: linkedPayment.id,
                keyId: existingIntent.keyId || publicKeyId,
                amount: Number(existingIntent.amount),
                amountInPaise: existingIntent.amountInPaise,
                currency: existingIntent.currency,
                receipt: existingIntent.receipt,
                invoice,
                reusedExistingOrder: true,
                isSimulated: Boolean(existingIntent.isSimulated),
              });
            }
          }
        }

        if (existingIntent.status === OrderIntentStatus.CREATING) {
          // Recover from prior crash / DB failure that already persisted providerOrderId on the intent
          if (existingIntent.providerOrderId) {
            const recoveredPayment = await this.ensureOrderPaymentForIntent(
              existingIntent,
              existingIntent.providerOrderId,
            );
            if (recoveredPayment) {
              await (this.prisma as any).paymentOrderIntent.updateMany({
                where: { id: existingIntent.id },
                data: {
                  status: OrderIntentStatus.CREATED,
                  paymentId: recoveredPayment.id,
                  keyId: existingIntent.keyId || publicKeyId,
                },
              });
              return this.buildRazorpayOrderResponse({
                orderId: existingIntent.providerOrderId,
                paymentId: recoveredPayment.id,
                keyId: existingIntent.keyId || publicKeyId,
                amount: Number(existingIntent.amount),
                amountInPaise: existingIntent.amountInPaise,
                currency: existingIntent.currency,
                receipt: existingIntent.receipt,
                invoice,
                reusedExistingOrder: true,
                recoveredFromCrash: true,
                isSimulated: Boolean(existingIntent.isSimulated),
              });
            }
          }

          const updatedAgeMs =
            now.getTime() -
            new Date(existingIntent.updatedAt || existingIntent.createdAt).getTime();
          const isUncertainTimeout =
            existingIntent.errorMessage === 'UNCERTAIN_PROVIDER_TIMEOUT';

          if (!isUncertainTimeout && updatedAgeMs < ORDER_INTENT_CREATING_STALE_MS) {
            // Brief backoff for in-flight concurrent request creating the exact same order
            await new Promise((resolve) => setTimeout(resolve, 40));
            continue;
          }

          // Reclaim stale or uncertain CREATING intent after checking Razorpay by deterministic receipt
          if (!isSimulation && typeof this.integrations.razorpay.fetchOrderByReceipt === 'function') {
            const foundByReceipt = await this.integrations.razorpay
              .fetchOrderByReceipt(existingIntent.receipt, adapterConfig)
              .catch(() => null);
            if (
              foundByReceipt?.id &&
              Number(foundByReceipt.amountInPaise) === Number(existingIntent.amountInPaise) &&
              String(foundByReceipt.currency || '').toUpperCase() === existingIntent.currency
            ) {
              const recoveredPayment = await this.ensureOrderPaymentForIntent(
                existingIntent,
                foundByReceipt.id,
              );
              if (recoveredPayment) {
                await (this.prisma as any).paymentOrderIntent.updateMany({
                  where: { id: existingIntent.id },
                  data: {
                    status: OrderIntentStatus.CREATED,
                    providerOrderId: foundByReceipt.id,
                    paymentId: recoveredPayment.id,
                    keyId: foundByReceipt.keyId || publicKeyId,
                    errorMessage: null,
                  },
                });
                return this.buildRazorpayOrderResponse({
                  orderId: foundByReceipt.id,
                  paymentId: recoveredPayment.id,
                  keyId: foundByReceipt.keyId || publicKeyId,
                  amount: Number(existingIntent.amount),
                  amountInPaise: existingIntent.amountInPaise,
                  currency: existingIntent.currency,
                  receipt: existingIntent.receipt,
                  invoice,
                  reusedExistingOrder: true,
                  recoveredFromCrash: true,
                  isSimulated: false,
                });
              }
            }
          }

          await (this.prisma as any).paymentOrderIntent.updateMany({
            where: { id: existingIntent.id, status: OrderIntentStatus.CREATING },
            data: {
              status: OrderIntentStatus.FAILED,
              activeClaimKey: null,
              errorMessage: isUncertainTimeout
                ? 'Uncertain provider order creation not found on recovery lookup'
                : 'Stale order creation claim expired',
            },
          });
          continue;
        }

        if (
          existingIntent.status === OrderIntentStatus.COMPLETED &&
          requestIdempotencyKey &&
          existingIntent.idempotencyKey === requestIdempotencyKey &&
          existingIntent.providerOrderId &&
          existingIntent.paymentId
        ) {
          return this.buildRazorpayOrderResponse({
            orderId: existingIntent.providerOrderId,
            paymentId: existingIntent.paymentId,
            keyId: existingIntent.keyId || publicKeyId,
            amount: Number(existingIntent.amount),
            amountInPaise: existingIntent.amountInPaise,
            currency: existingIntent.currency,
            receipt: existingIntent.receipt,
            invoice,
            reusedExistingOrder: true,
            isSimulated: Boolean(existingIntent.isSimulated),
          });
        }

        // Release lingering activeClaimKey on FAILED/EXPIRED/COMPLETED intent before claiming fresh slot
        if (existingIntent.activeClaimKey) {
          await (this.prisma as any).paymentOrderIntent.updateMany({
            where: { id: existingIntent.id },
            data: { activeClaimKey: null },
          });
        }
        if (requestIdempotencyKey && existingIntent.idempotencyKey === requestIdempotencyKey) {
          // Allow clean retry under explicit idempotencyKey when prior attempt FAILED or EXPIRED
          const refreshedReceipt = `rcpt_${crypto
            .createHash('sha256')
            .update(`${claimKey}:${Date.now()}:${crypto.randomUUID()}`)
            .digest('hex')
            .slice(0, 24)}`.slice(0, 40);
          const expiresAt = new Date(Date.now() + ORDER_INTENT_TTL_MS);
          try {
            claimedIntent = await (this.prisma as any).paymentOrderIntent.update({
              where: { id: existingIntent.id },
              data: {
                status: OrderIntentStatus.CREATING,
                activeClaimKey: claimKey,
                receipt: refreshedReceipt,
                errorMessage: null,
                expiresAt,
              },
            });
            break;
          } catch (err: any) {
            if (err?.code === 'P2002') continue;
            throw err;
          }
        }
      }

      const receipt = `rcpt_${crypto
        .createHash('sha256')
        .update(`${claimKey}:${Date.now()}:${crypto.randomUUID()}`)
        .digest('hex')
        .slice(0, 24)}`.slice(0, 40);
      const idempotencyKey = requestIdempotencyKey || `auto:${claimKey}:${crypto.randomUUID()}`;
      const expiresAt = new Date(Date.now() + ORDER_INTENT_TTL_MS);

      try {
        claimedIntent = await (this.prisma as any).paymentOrderIntent.create({
          data: {
            tenantId,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            idempotencyKey,
            activeClaimKey: claimKey,
            receipt,
            amount: payableAmount,
            amountInPaise,
            currency: invoiceCurrency,
            status: OrderIntentStatus.CREATING,
            provider: 'RAZORPAY',
            keyId: publicKeyId,
            isSimulated: isSimulation,
            expiresAt,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' || err?.message?.includes('Unique constraint')) {
          continue;
        }
        throw err;
      }
    }

    if (!claimedIntent) {
      throw new BadRequestException(
        'Concurrent order creation in progress for this invoice; please retry shortly.',
      );
    }

    // 3. Call Razorpay Orders API using the durable deterministic receipt
    let orderResult: any;
    try {
      orderResult = await this.integrations.razorpay.createOrder(
        {
          amount: payableAmount,
          currency: invoiceCurrency,
          receipt: claimedIntent.receipt,
          invoiceNumber: invoice.number,
          invoiceId: invoice.id,
          tenantId,
        },
        adapterConfig,
      );
    } catch (providerErr: any) {
      // On uncertain/network/5xx failure, check Razorpay by receipt before abandoning the intent
      const errMsg = String(providerErr?.message || '');
      const isUncertainFailure =
        errMsg.includes('connection failed') ||
        errMsg.includes('(500)') ||
        errMsg.includes('(502)') ||
        errMsg.includes('(503)') ||
        errMsg.includes('(504)') ||
        !providerErr?.status ||
        providerErr.status >= 500;

      if (
        isUncertainFailure &&
        !isSimulation &&
        typeof this.integrations.razorpay.fetchOrderByReceipt === 'function'
      ) {
        const recoveredOrder = await this.integrations.razorpay
          .fetchOrderByReceipt(claimedIntent.receipt, adapterConfig)
          .catch(() => null);
        if (
          recoveredOrder?.id &&
          Number(recoveredOrder.amountInPaise) === Number(claimedIntent.amountInPaise) &&
          String(recoveredOrder.currency || '').toUpperCase() === claimedIntent.currency
        ) {
          orderResult = recoveredOrder;
        }
      }

      if (!orderResult) {
        if (isUncertainFailure && !isSimulation) {
          // Keep CREATING + activeClaimKey briefly with UNCERTAIN_PROVIDER_TIMEOUT so an immediate retry
          // re-checks fetchOrderByReceipt (handling delayed Razorpay indexing) before creating another order.
          await (this.prisma as any).paymentOrderIntent
            .update({
              where: { id: claimedIntent.id },
              data: {
                errorMessage: 'UNCERTAIN_PROVIDER_TIMEOUT',
              },
            })
            .catch(() => undefined);
        } else {
          await (this.prisma as any).paymentOrderIntent
            .update({
              where: { id: claimedIntent.id },
              data: {
                status: OrderIntentStatus.FAILED,
                activeClaimKey: null,
                errorMessage: errMsg.slice(0, 500),
              },
            })
            .catch(() => undefined);
        }
        throw providerErr;
      }
    }

    // 4. Durably persist Payment + update OrderIntent (bounded retries; never delete intent if provider order exists)
    let persistedPayment: any = null;
    let lastPersistErr: any = null;
    for (let dbAttempt = 0; dbAttempt < 3; dbAttempt++) {
      try {
        persistedPayment = await this.prisma.$transaction(async (tx: any) => {
          const existingPay = await tx.payment.findFirst({
            where: {
              tenantId,
              invoiceId: invoice.id,
              OR: [{ ref: `RZP-ORD-${orderResult.id}` }, { providerRef: orderResult.id }],
            },
          });
          const payRow =
            existingPay ||
            (await tx.payment.create({
              data: {
                ref: `RZP-ORD-${orderResult.id}`,
                customerId: invoice.customerId,
                invoiceId: invoice.id,
                amount: payableAmount,
                currency: invoiceCurrency,
                method: PaymentMethod.PAYMENT_LINK,
                status: PaymentStatus.PENDING,
                providerRef: orderResult.id,
                notes: `Razorpay Checkout Order [order:${orderResult.id}] [receipt:${claimedIntent.receipt}]`,
                tenantId,
              },
            }));

          if (tx.paymentOrderIntent?.update) {
            await tx.paymentOrderIntent.update({
              where: { id: claimedIntent.id },
              data: {
                status: OrderIntentStatus.CREATED,
                providerOrderId: orderResult.id,
                paymentId: payRow.id,
                keyId: orderResult.keyId,
                isSimulated: Boolean(orderResult.isSimulated),
                errorMessage: null,
              },
            });
          }
          return payRow;
        });
        break;
      } catch (dbErr: any) {
        lastPersistErr = dbErr;
        if (dbAttempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    }

    if (!persistedPayment) {
      // Preserve intent with providerOrderId (never delete!) so retry recovers the existing Razorpay order cleanly
      await (this.prisma as any).paymentOrderIntent
        .update({
          where: { id: claimedIntent.id },
          data: {
            providerOrderId: orderResult.id,
            keyId: orderResult.keyId,
            isSimulated: Boolean(orderResult.isSimulated),
            errorMessage: String(lastPersistErr?.message || 'DB persistence failed').slice(0, 500),
          },
        })
        .catch(() => undefined);
      this.logger.error(
        `CRITICAL: Created Razorpay order ${orderResult.id} (receipt ${claimedIntent.receipt}) for invoice ${invoice.id}, but local DB persistence failed. Intent preserved for recovery.`,
      );
      throw lastPersistErr;
    }

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'payment.razorpay_order_created',
      entityType: 'Payment',
      entityId: persistedPayment.id,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        orderId: orderResult.id,
        receipt: claimedIntent.receipt,
        amount: payableAmount,
        amountInPaise,
        currency: invoiceCurrency,
        isSimulated: orderResult.isSimulated,
      },
    });

    return this.buildRazorpayOrderResponse({
      orderId: orderResult.id,
      paymentId: persistedPayment.id,
      keyId: orderResult.keyId,
      amount: orderResult.amount,
      amountInPaise: orderResult.amountInPaise,
      currency: orderResult.currency,
      receipt: orderResult.receipt,
      invoice,
      reusedExistingOrder: false,
      isSimulated: Boolean(orderResult.isSimulated),
    });
  }

  async verifyRazorpayPayment(user: AuthUser, dto: VerifyRazorpayPaymentDto) {
    const { tenantId, userId, role } = user;
    const orderId = dto.razorpay_order_id.trim();
    const paymentId = dto.razorpay_payment_id.trim();
    const signature = dto.razorpay_signature.trim();

    if (!orderId || !paymentId || !signature) {
      throw new BadRequestException('Order ID, Payment ID, and Signature are required');
    }

    // 1. Verify invoice and tenant/agent ownership on server side
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
    }

    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException(
          'Access denied: You are not assigned to this customer or collection case',
        );
      }
    }

    // 2. Locate stored Razorpay order mapping inside the same tenant and invoice, preferring canonical RZP-ORD-*
    const orderPayments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        invoiceId: invoice.id,
        OR: [
          { ref: `RZP-ORD-${orderId}` },
          { providerRef: orderId },
          { notes: { contains: `[order:${orderId}]` } },
        ],
      },
    });

    if (!orderPayments || orderPayments.length === 0) {
      throw new NotFoundException('Associated Razorpay order was not found for this invoice');
    }

    const targetOrderPayment =
      orderPayments.find((p) => p.ref === `RZP-ORD-${orderId}`) ||
      orderPayments.find((p) => p.providerRef === orderId && p.ref?.startsWith('RZP-ORD-')) ||
      orderPayments.find(
        (p) =>
          (p.status === PaymentStatus.COMPLETED || p.status === PaymentStatus.REFUNDED) &&
          String(p.notes || '').includes(`[order:${orderId}]`),
      ) ||
      orderPayments.find((p) => !String(p.ref || '').startsWith('PAY-FAIL-')) ||
      orderPayments[0];

    if (
      targetOrderPayment.tenantId !== tenantId ||
      targetOrderPayment.invoiceId !== invoice.id ||
      targetOrderPayment.customerId !== invoice.customerId
    ) {
      throw new ForbiddenException('Order ownership verification failed');
    }

    // 3. Resolve cohesive tenant/env Razorpay credentials (never mix tenant keyId with env keySecret)
    const tenantConfig =
      typeof this.integrations?.getRawConfig === 'function'
        ? await this.integrations.getRawConfig(tenantId, 'RAZORPAY')
        : {};
    const keyPair = resolveRazorpayKeyPair(tenantConfig);

    if (keyPair.source === 'partial_tenant') {
      throw new BadRequestException(
        'Incomplete tenant Razorpay configuration: both Key ID and Key Secret must be provided together.',
      );
    }

    const effectiveKeySecret = !isPlaceholderCredential(keyPair.keySecret) ? keyPair.keySecret : '';
    const isProd = process.env.NODE_ENV === 'production';
    const orderIntent = (this.prisma as any).paymentOrderIntent?.findFirst
      ? await (this.prisma as any).paymentOrderIntent.findFirst({
          where: {
            tenantId,
            invoiceId: invoice.id,
            providerOrderId: orderId,
          },
        })
      : null;

    const isSimulationPolicyActive = !isProd && process.env.PAYMENT_SIMULATION_MODE === 'true';
    const isSimulatedOrder =
      !isProd &&
      orderId.startsWith('order_sim_') &&
      (Boolean(orderIntent?.isSimulated) || isSimulationPolicyActive);

    if (!effectiveKeySecret && !isSimulatedOrder) {
      throw new BadRequestException('Razorpay key secret is not configured for signature verification');
    }

    // 4. Timing-safe HMAC-SHA256 verification of "<order_id>|<payment_id>" BEFORE any mutation
    const isSigValid = this.integrations.razorpay.verifyCheckoutSignature({
      orderId,
      paymentId,
      signature,
      secret: effectiveKeySecret || undefined,
      allowSimulation: isSimulatedOrder,
    });

    if (!isSigValid) {
      this.logger.warn(
        `Invalid Razorpay checkout signature rejected for invoice ${invoice.id} order ${orderId}`,
      );
      throw new BadRequestException('Invalid Razorpay payment signature');
    }

    // 5. Independent server-side payment status/amount/currency verification with Razorpay API
    let verifiedStatus = 'captured';
    let verifiedAmount = Number(targetOrderPayment.amount);
    let verifiedCurrency = (invoice.currency || 'INR').toUpperCase();

    if (!isSimulatedOrder) {
      const gatewayPayment = await this.integrations.razorpay.fetchPayment(paymentId, tenantConfig);
      if (gatewayPayment.id !== paymentId) {
        throw new BadRequestException('Verified payment ID mismatch from Razorpay');
      }
      if (gatewayPayment.order_id && gatewayPayment.order_id !== orderId) {
        throw new BadRequestException('Payment does not belong to the specified Razorpay order');
      }
      if (!gatewayPayment.order_id) {
        throw new BadRequestException('Gateway payment is missing order_id binding');
      }
      if (gatewayPayment.currency && gatewayPayment.currency !== verifiedCurrency) {
        throw new BadRequestException(
          `Payment currency mismatch: expected ${verifiedCurrency}, received ${gatewayPayment.currency}`,
        );
      }

      const expectedPaise = Math.round(Number(targetOrderPayment.amount) * 100);
      if (
        gatewayPayment.status === 'captured' &&
        Number(gatewayPayment.amount) !== expectedPaise
      ) {
        throw new BadRequestException(
          `Payment amount mismatch: expected ${expectedPaise} paise, received ${gatewayPayment.amount} paise`,
        );
      }

      verifiedStatus = gatewayPayment.status;
      if (Number.isFinite(gatewayPayment.amount) && gatewayPayment.amount > 0) {
        verifiedAmount = Number(gatewayPayment.amount) / 100;
      }
      if (gatewayPayment.currency) {
        verifiedCurrency = gatewayPayment.currency;
      }
    }

    if (verifiedStatus === 'created' || verifiedStatus === 'authorized') {
      await this.auditLogs.log({
        tenantId,
        userId,
        action: 'payment.authorized_pending_capture',
        entityType: 'Payment',
        entityId: targetOrderPayment.id,
        metadata: {
          provider: 'RAZORPAY',
          orderId,
          providerPaymentId: paymentId,
          gatewayStatus: verifiedStatus,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
        },
      });
      return {
        verified: false,
        idempotent: false,
        status: 'PENDING',
        orderId,
        paymentId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceStatus: invoice.status,
        remainingOutstanding: Number(invoice.outstanding),
        message: 'Payment is authorized/pending capture; invoice balance unchanged.',
      };
    }

    const stableRef = `PAY-WH-${paymentId}`;

    // 5b. If gateway reports payment as refunded, reconcile via PaymentRefund (NEVER mark as FAILED!)
    if (verifiedStatus === 'refunded') {
      const gatewayRefunds =
        !isSimulatedOrder && typeof this.integrations.razorpay.fetchPaymentRefunds === 'function'
          ? await this.integrations.razorpay.fetchPaymentRefunds(paymentId, tenantConfig).catch(() => [])
          : [];
      const confirmedRefunds = (gatewayRefunds || []).filter((r) => r.status === 'processed');

      const refundOutcome = await this.prisma.$transaction(async (tx) => {
        await this.acquireCustomerAndInvoiceLocksTx(
          tx,
          invoice.customerId,
          invoice.id,
          tenantId,
        );
        const lockedInvoice = await tx.invoice.findFirst({
          where: { id: invoice.id, tenantId },
          include: { customer: true, tenant: true },
        });
        if (!lockedInvoice) {
          throw new NotFoundException('Invoice not found in tenant');
        }

        const settledPayment = await tx.payment.findFirst({
          where: {
            tenantId,
            invoiceId: lockedInvoice.id,
            status: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
            OR: [
              { providerRef: paymentId },
              { ref: stableRef },
              { notes: { contains: `[tx:${paymentId}]` } },
            ],
          },
        });

        let appliedCount = 0;
        let lastInvoiceStatus = lockedInvoice.status;
        let lastOutstanding = Number(lockedInvoice.outstanding);
        let totalRefunded = 0;

        if (settledPayment && confirmedRefunds.length > 0 && (tx as any).paymentRefund) {
          for (const rfnd of confirmedRefunds) {
            const rfndAmt = Number(rfnd.amount) / 100;
            const res = await this.applyConfirmedRefundTx(tx, {
              tenantId,
              invoice: lockedInvoice,
              payment: settledPayment,
              provider: 'RAZORPAY',
              providerRefundId: rfnd.id,
              providerPaymentId: paymentId,
              refundAmount: rfndAmt,
              currency: rfnd.currency || verifiedCurrency,
              reason: 'Synced via checkout verification on refunded gateway payment',
            });
            lockedInvoice.outstanding = res.newInvoiceOutstanding as any;
            lockedInvoice.status = res.newInvoiceStatus;
            lastInvoiceStatus = res.newInvoiceStatus;
            lastOutstanding = res.newInvoiceOutstanding;
            totalRefunded = res.totalRefundedOnPayment;
            if (!res.idempotent) appliedCount++;
          }
        }

        return {
          settledPaymentId: settledPayment?.id || targetOrderPayment.id,
          appliedCount,
          lastInvoiceStatus,
          lastOutstanding,
          totalRefunded,
        };
      });

      return {
        verified: false,
        idempotent: refundOutcome.appliedCount === 0,
        status: 'REFUNDED',
        orderId,
        paymentId: refundOutcome.settledPaymentId,
        providerPaymentId: paymentId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceStatus: refundOutcome.lastInvoiceStatus,
        remainingOutstanding: refundOutcome.lastOutstanding,
        totalRefunded: refundOutcome.totalRefunded,
        message: 'Payment was refunded at gateway.',
      };
    }

    // 6. Atomic transactional reconciliation or failure recording
    let txOutcome: {
      response: Record<string, any>;
      auditEntry?: {
        tenantId: string;
        userId: string;
        action: string;
        entityType: string;
        entityId: string;
        metadata: Record<string, any>;
      };
    };

    try {
      txOutcome = await this.prisma.$transaction(async (tx) => {
        // C1: Acquire Customer -> Invoice FOR UPDATE locks BEFORE reading mutable fields
        await this.acquireCustomerAndInvoiceLocksTx(
          tx,
          invoice.customerId,
          invoice.id,
          tenantId,
        );

        const lockedInvoice = await tx.invoice.findFirst({
          where: { id: invoice.id, tenantId },
          include: { customer: true, tenant: true },
        });
        if (!lockedInvoice) {
          throw new NotFoundException('Invoice not found in tenant');
        }

        // Handle gateway failure cleanly without altering invoice/customer balances
        if (verifiedStatus === 'failed') {
          const failRef = `PAY-FAIL-${paymentId}`;
          const existingFailed = await tx.payment.findFirst({
            where: {
              tenantId,
              invoiceId: lockedInvoice.id,
              status: PaymentStatus.FAILED,
              OR: [{ ref: failRef }, { providerRef: paymentId }],
            },
          });

          if (existingFailed) {
            return {
              response: {
                verified: false,
                idempotent: true,
                status: 'FAILED',
                orderId,
                paymentId: existingFailed.id,
                invoiceId: lockedInvoice.id,
                invoiceNumber: lockedInvoice.number,
                invoiceStatus: lockedInvoice.status,
                remainingOutstanding: Number(lockedInvoice.outstanding),
                message: 'Payment failure already recorded; invoice balance remains unchanged.',
              },
            };
          }

          const failedRow = await tx.payment.create({
            data: {
              ref: failRef,
              customerId: lockedInvoice.customerId,
              invoiceId: lockedInvoice.id,
              amount: verifiedAmount,
              currency: verifiedCurrency,
              method: PaymentMethod.PAYMENT_LINK,
              status: PaymentStatus.FAILED,
              providerRef: paymentId,
              notes: `Checkout payment ${verifiedStatus} at RAZORPAY [order:${orderId}] [tx:${paymentId}]`,
              tenantId,
            },
          });

          return {
            response: {
              verified: false,
              idempotent: false,
              status: 'FAILED',
              orderId,
              paymentId: failedRow.id,
              invoiceId: lockedInvoice.id,
              invoiceNumber: lockedInvoice.number,
              invoiceStatus: lockedInvoice.status,
              remainingOutstanding: Number(lockedInvoice.outstanding),
              message: `Payment ${verifiedStatus} at gateway; invoice balance remains unchanged.`,
            },
            auditEntry: {
              tenantId,
              userId,
              action: 'payment.checkout_failed',
              entityType: 'Payment',
              entityId: failedRow.id,
              metadata: {
                provider: 'RAZORPAY',
                orderId,
                providerPaymentId: paymentId,
                gatewayStatus: verifiedStatus,
                invoiceNumber: lockedInvoice.number,
              },
            },
          };
        }

        if (verifiedStatus !== 'captured') {
          throw new BadRequestException(`Unsupported Razorpay payment status: ${verifiedStatus}`);
        }

        // Idempotency guard against duplicate verify calls or already-committed webhook reconciliation
        const existingCompleted = await tx.payment.findFirst({
          where: {
            tenantId,
            invoiceId: lockedInvoice.id,
            status: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
            OR: [
              { providerRef: paymentId },
              { ref: stableRef },
              { ref: `PAY-RZP-${paymentId}` },
              { notes: { contains: `[tx:${paymentId}]` } },
              { notes: { contains: `[order:${orderId}]` } },
            ],
          },
        });

        if (existingCompleted) {
          return {
            response: {
              verified: true,
              idempotent: true,
              status: existingCompleted.status,
              orderId,
              providerPaymentId: paymentId,
              paymentId: existingCompleted.id,
              invoiceId: lockedInvoice.id,
              invoiceNumber: lockedInvoice.number,
              paidAmount: Number(existingCompleted.amount),
              remainingOutstanding: Number(lockedInvoice.outstanding),
              invoiceStatus: lockedInvoice.status,
              message: 'Payment already verified and reconciled',
            },
          };
        }

        if (lockedInvoice.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('Cannot reconcile checkout payment for CANCELLED invoice');
        }

        const pendingOrder = await tx.payment.findFirst({
          where: {
            tenantId,
            invoiceId: lockedInvoice.id,
            status: PaymentStatus.PENDING,
            OR: [{ ref: `RZP-ORD-${orderId}` }, { providerRef: orderId }],
          },
        });

        const settled = await this.reconcileSettledPaymentTx(tx, {
          tenantId,
          invoice: lockedInvoice,
          pendingPayment: pendingOrder,
          paidAmount: verifiedAmount,
          stableRef,
          providerRef: paymentId,
          providerOrderId: orderId,
          notePrefix: 'Verified via RAZORPAY checkout',
          extraNoteTags: `[order:${orderId}] [tx:${paymentId}]`,
        });

        return {
          response: {
            verified: true,
            idempotent: false,
            status: 'COMPLETED',
            orderId,
            providerPaymentId: paymentId,
            paymentId: settled.settledPayment.id,
            invoiceId: lockedInvoice.id,
            invoiceNumber: lockedInvoice.number,
            paidAmount: verifiedAmount,
            remainingOutstanding: settled.newInvoiceOutstanding,
            overpaymentDetected: settled.overpaymentAmount > 0,
            ...(settled.overpaymentAmount > 0 ? { overpaymentAmount: settled.overpaymentAmount } : {}),
            invoiceStatus: settled.newInvoiceStatus,
          },
          auditEntry: {
            tenantId,
            userId,
            action: 'payment.verified_via_checkout',
            entityType: 'Payment',
            entityId: settled.settledPayment.id,
            metadata: {
              provider: 'RAZORPAY',
              orderId,
              providerPaymentId: paymentId,
              invoiceNumber: lockedInvoice.number,
              paidAmount: verifiedAmount,
              remainingInvoiceOutstanding: settled.newInvoiceOutstanding,
              newInvoiceStatus: settled.newInvoiceStatus,
            },
          },
        };
      });
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        const concurrentPayment = await this.prisma.payment.findFirst({
          where: { ref: stableRef, tenantId },
          include: { invoice: true },
        });
        if (concurrentPayment) {
          return {
            verified: true,
            idempotent: true,
            status: 'COMPLETED',
            orderId,
            providerPaymentId: paymentId,
            paymentId: concurrentPayment.id,
            invoiceId: concurrentPayment.invoiceId,
            invoiceNumber: concurrentPayment.invoice?.number,
            paidAmount: Number(concurrentPayment.amount),
            remainingOutstanding: Number(concurrentPayment.invoice?.outstanding ?? 0),
            invoiceStatus: concurrentPayment.invoice?.status || InvoiceStatus.PAID,
            message: 'Payment already reconciled concurrently',
          };
        }
      }
      throw err;
    }

    if (txOutcome.auditEntry) {
      await this.auditLogs.log(txOutcome.auditEntry);
    }

    return txOutcome.response;
  }

  async handleWebhook(
    provider: string,
    payload: any,
    headers: Record<string, string>,
    rawBody?: Buffer | string,
  ) {
    const normalizedProvider = provider.toUpperCase();
    if (normalizedProvider !== 'RAZORPAY' && normalizedProvider !== 'STRIPE') {
      throw new BadRequestException(`Unsupported payment provider webhook: ${provider}`);
    }

    const isProd = process.env.NODE_ENV === 'production';
    const isExplicitSimulation = !isProd && process.env.PAYMENT_SIMULATION_MODE === 'true';

    // 1. Extract provider reference hints ONLY to locate the trusted stored payment record & its tenant webhook secret
    const hints = this.parseWebhookCandidateHints(normalizedProvider, payload, rawBody);
    const anchorPayment = await this.resolveTrustedAnchorPayment(
      hints.paymentLinkId,
      hints.providerPaymentId,
      hints.providerOrderId,
      hints.providerRefundId,
    );

    // 2. Resolve tenant-specific webhook secret (fallback to global env secret ONLY when tenant secret is unset)
    let tenantSecret = '';
    if (anchorPayment?.tenantId && typeof this.integrations?.getRawConfig === 'function') {
      const tenantConfig = await this.integrations.getRawConfig(
        anchorPayment.tenantId,
        normalizedProvider,
      );
      if (typeof tenantConfig?.webhookSecret === 'string') {
        tenantSecret = tenantConfig.webhookSecret.trim();
      }
    }

    const envSecret = (
      (normalizedProvider === 'RAZORPAY'
        ? process.env.RAZORPAY_WEBHOOK_SECRET
        : process.env.STRIPE_WEBHOOK_SECRET) || ''
    ).trim();

    if (tenantSecret && isPlaceholderCredential(tenantSecret)) {
      this.logger.warn(
        `Rejected webhook: tenant ${anchorPayment?.tenantId} has placeholder ${normalizedProvider} webhook secret`,
      );
      throw new BadRequestException('Webhook secret configuration is invalid');
    }

    const selectedSecret = tenantSecret || (!isPlaceholderCredential(envSecret) ? envSecret : '');

    // Fail closed if no valid webhook secret exists (unless explicit non-prod simulation mode is active)
    if (!selectedSecret && !isExplicitSimulation) {
      this.logger.warn(`Rejected webhook: missing or placeholder ${normalizedProvider} webhook secret`);
      throw new BadRequestException('Webhook secret is not configured');
    }

    // 3. Verify raw-body HMAC signature BEFORE any financial DB mutation or replay claim
    const signature =
      normalizedProvider === 'RAZORPAY'
        ? this.getHeaderValue(headers, 'x-razorpay-signature') || this.getHeaderValue(headers, 'x-signature')
        : this.getHeaderValue(headers, 'stripe-signature') || this.getHeaderValue(headers, 'x-signature');

    const verificationResult =
      normalizedProvider === 'RAZORPAY'
        ? await this.integrations.razorpay.verifyWebhook(
            payload,
            signature,
            selectedSecret || undefined,
            rawBody,
          )
        : await this.integrations.stripe.verifyWebhook(
            payload,
            signature,
            selectedSecret || undefined,
            rawBody,
          );

    if (!verificationResult.isValid) {
      this.logger.warn(`Invalid webhook signature received for provider ${normalizedProvider}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    // 4. Require trusted stored payment anchor (NEVER fall back to unscoped invoiceNumber lookup)
    if (!anchorPayment || !anchorPayment.tenantId || !anchorPayment.invoiceId) {
      this.logger.warn(
        `Rejected ${normalizedProvider} webhook: no matching stored payment anchor found`,
      );
      throw new BadRequestException(
        'Unable to securely associate webhook with a stored tenant payment record',
      );
    }

    const providerPaymentId = verificationResult.providerPaymentId
      ? String(verificationResult.providerPaymentId).trim()
      : hints.providerPaymentId || null;
    const providerOrderId = verificationResult.providerOrderId
      ? String(verificationResult.providerOrderId).trim()
      : hints.providerOrderId || null;
    const providerRefundId = verificationResult.providerRefundId
      ? String(verificationResult.providerRefundId).trim()
      : hints.providerRefundId || null;
    const paymentLinkId = verificationResult.paymentLinkId
      ? String(verificationResult.paymentLinkId).trim()
      : hints.paymentLinkId || null;
    const eventIdHeader =
      normalizedProvider === 'RAZORPAY'
        ? this.getHeaderValue(headers, 'x-razorpay-event-id')
        : this.getHeaderValue(headers, 'stripe-event-id');

    const payloadDigest = crypto
      .createHash('sha256')
      .update(hints.rawBodyStr)
      .digest('hex')
      .slice(0, 24);
    const replayKey = eventIdHeader
      ? `${normalizedProvider.toLowerCase()}:event:${eventIdHeader}`
      : `${normalizedProvider.toLowerCase()}:payload:${anchorPayment.tenantId}:${verificationResult.event}:${verificationResult.status || 'PENDING'}:${providerRefundId || providerPaymentId || paymentLinkId || providerOrderId || payloadDigest}`;

    // Best-effort pruning of strictly expired replay rows outside the transaction
    await pruneExpiredWebhookReplays(this.prisma).catch(() => 0);

    // 5. Reconcile & claim replay key atomically inside a single PostgreSQL transaction
    let txOutcome: {
      response: Record<string, any>;
      auditEntry?: {
        tenantId: string;
        userId: string;
        action: string;
        entityType: string;
        entityId?: string;
        metadata: Record<string, any>;
      };
    };

    try {
      txOutcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await claimWebhookReplayKey(
          tx as any,
          normalizedProvider,
          replayKey,
          WEBHOOK_REPLAY_TTL_MS,
        );

        if (!claimed) {
          this.logger.log(`Duplicate webhook replay ignored for key ${replayKey}`);
          return {
            response: {
              received: true,
              processed: true,
              idempotent: true,
              message: 'Duplicate webhook event ignored',
            },
          };
        }

        const lockedPayment = await tx.payment.findFirst({
          where: { id: anchorPayment.id, tenantId: anchorPayment.tenantId },
        });
        if (!lockedPayment) {
          throw new BadRequestException('Associated payment record not found in tenant');
        }

        const tenantId = lockedPayment.tenantId;

        // C1: Acquire PostgreSQL Customer -> Invoice FOR UPDATE locks BEFORE reading mutable fields
        await this.acquireCustomerAndInvoiceLocksTx(
          tx,
          lockedPayment.customerId,
          lockedPayment.invoiceId,
          tenantId,
        );

        const invoice = await tx.invoice.findFirst({
          where: { id: lockedPayment.invoiceId, tenantId },
          include: { customer: true, tenant: true },
        });

        if (!invoice) {
          throw new BadRequestException('Associated invoice not found in tenant');
        }

        if (
          invoice.tenantId !== tenantId ||
          invoice.customerId !== lockedPayment.customerId ||
          (invoice.customer?.tenantId && invoice.customer.tenantId !== tenantId)
        ) {
          this.logger.warn(
            `Cross-tenant relationship mismatch blocked for payment ${lockedPayment.id}`,
          );
          throw new ForbiddenException('Cross-tenant payment reconciliation rejected');
        }

        if (verificationResult.invoiceNumber && invoice.number !== verificationResult.invoiceNumber) {
          this.logger.warn(
            `Webhook invoice mismatch rejected for payment ${lockedPayment.id}`,
          );
          throw new BadRequestException('Webhook invoice reference does not match payment record');
        }

        const systemUser = await tx.user.findFirst({
          where: { tenantId, role: 'ADMIN' },
        });
        const auditActorId = systemUser?.id || invoice.tenant?.id || tenantId;

        // 5b. Explicit Refund Webhook Handling BEFORE payment idempotency short-circuit (C2)
        if (
          verificationResult.status === 'REFUND_PENDING' ||
          verificationResult.status === 'REFUND_PROCESSED' ||
          verificationResult.status === 'REFUND_FAILED'
        ) {
          if (!providerRefundId) {
            throw new BadRequestException('Refund webhook is missing provider refund ID');
          }
          if (!providerPaymentId) {
            throw new BadRequestException('Refund webhook is missing provider payment ID');
          }

          const refundCurrency = (verificationResult.currency || invoice.currency || 'INR')
            .trim()
            .toUpperCase();
          if (refundCurrency !== invoice.currency.toUpperCase()) {
            throw new BadRequestException(
              `Webhook refund currency mismatch: expected ${invoice.currency}, received ${refundCurrency}`,
            );
          }

          const settledPayment = await tx.payment.findFirst({
            where: {
              tenantId,
              invoiceId: invoice.id,
              status: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
              OR: [
                { providerRef: providerPaymentId },
                { ref: `PAY-WH-${providerPaymentId}` },
                { notes: { contains: `[tx:${providerPaymentId}]` } },
              ],
            },
          });

          if (verificationResult.status === 'REFUND_PENDING') {
            let alreadyProcessed = false;
            if (settledPayment && (tx as any).paymentRefund) {
              const existingRefund = await (tx as any).paymentRefund.findFirst({
                where: { providerRefundId, tenantId },
              });
              if (existingRefund?.status === RefundStatus.PROCESSED) {
                alreadyProcessed = true;
              } else if (!existingRefund) {
                await (tx as any).paymentRefund.create({
                  data: {
                    tenantId,
                    paymentId: settledPayment.id,
                    invoiceId: invoice.id,
                    customerId: invoice.customerId,
                    provider: normalizedProvider,
                    providerRefundId,
                    providerPaymentId,
                    amount: verificationResult.amount ?? Number(settledPayment.amount),
                    currency: refundCurrency,
                    status: RefundStatus.PENDING,
                    rawEvent: verificationResult.event,
                  },
                });
              }
            }

            return {
              response: {
                received: true,
                processed: true,
                idempotent: alreadyProcessed,
                status: alreadyProcessed ? 'REFUND_PROCESSED' : 'REFUND_PENDING',
                providerRefundId,
                providerPaymentId,
                invoiceNumber: invoice.number,
                invoiceStatus: invoice.status,
                remainingInvoiceOutstanding: Number(invoice.outstanding),
                message: alreadyProcessed
                  ? 'Refund already processed; ignoring out-of-order pending event.'
                  : 'Refund initiation recorded as pending; invoice balance unchanged.',
              },
            };
          }

          if (verificationResult.status === 'REFUND_FAILED') {
            let alreadyProcessed = false;
            if (settledPayment && (tx as any).paymentRefund) {
              const existingRefund = await (tx as any).paymentRefund.findFirst({
                where: { providerRefundId, tenantId },
              });
              if (existingRefund?.status === RefundStatus.PROCESSED) {
                alreadyProcessed = true;
              } else if (existingRefund) {
                await (tx as any).paymentRefund.update({
                  where: { id: existingRefund.id },
                  data: {
                    status: RefundStatus.FAILED,
                    reason: verificationResult.event,
                  },
                });
              } else {
                await (tx as any).paymentRefund.create({
                  data: {
                    tenantId,
                    paymentId: settledPayment.id,
                    invoiceId: invoice.id,
                    customerId: invoice.customerId,
                    provider: normalizedProvider,
                    providerRefundId,
                    providerPaymentId,
                    amount: verificationResult.amount ?? Number(settledPayment.amount),
                    currency: refundCurrency,
                    status: RefundStatus.FAILED,
                    reason: verificationResult.event,
                    rawEvent: verificationResult.event,
                  },
                });
              }
            }

            return {
              response: {
                received: true,
                processed: true,
                idempotent: alreadyProcessed,
                status: alreadyProcessed ? 'REFUND_PROCESSED' : 'REFUND_FAILED',
                providerRefundId,
                providerPaymentId,
                invoiceNumber: invoice.number,
                invoiceStatus: invoice.status,
                remainingInvoiceOutstanding: Number(invoice.outstanding),
                message: alreadyProcessed
                  ? 'Refund already processed; ignoring out-of-order failed event.'
                  : 'Failed refund recorded; invoice balance remains unchanged.',
              },
              ...(alreadyProcessed
                ? {}
                : {
                    auditEntry: {
                      tenantId,
                      userId: auditActorId,
                      action: 'payment.refund_failed_via_webhook',
                      entityType: 'Payment',
                      entityId: settledPayment?.id || lockedPayment.id,
                      metadata: {
                        provider: normalizedProvider,
                        providerRefundId,
                        providerPaymentId,
                        invoiceNumber: invoice.number,
                      },
                    },
                  }),
            };
          }

          // REFUND_PROCESSED: Never restore balances unless the payment settlement has already been recorded!
          if (!settledPayment) {
            throw new BadRequestException(
              `Cannot process refund ${providerRefundId} before payment ${providerPaymentId} settlement is recorded`,
            );
          }

          const refundAmount =
            verificationResult.amount !== undefined && verificationResult.amount !== null
              ? Number(verificationResult.amount)
              : Number(settledPayment.amount);

          const refundOutcome = await this.applyConfirmedRefundTx(tx, {
            tenantId,
            invoice,
            payment: settledPayment,
            provider: normalizedProvider,
            providerRefundId,
            providerPaymentId,
            refundAmount,
            currency: refundCurrency,
            rawEvent: verificationResult.event,
          });

          return {
            response: {
              received: true,
              processed: true,
              idempotent: refundOutcome.idempotent,
              status: 'REFUND_PROCESSED',
              providerRefundId,
              providerPaymentId,
              refundAmount: Number(refundOutcome.refund.amount),
              totalRefundedOnPayment: refundOutcome.totalRefundedOnPayment,
              paymentStatus: refundOutcome.paymentStatus,
              invoiceNumber: invoice.number,
              remainingInvoiceOutstanding: refundOutcome.newInvoiceOutstanding,
              invoiceStatus: refundOutcome.newInvoiceStatus,
              paymentId: settledPayment.id,
            },
            ...(refundOutcome.idempotent
              ? {}
              : {
                  auditEntry: {
                    tenantId,
                    userId: auditActorId,
                    action: 'payment.refund_processed_via_webhook',
                    entityType: 'Payment',
                    entityId: settledPayment.id,
                    metadata: {
                      provider: normalizedProvider,
                      providerRefundId,
                      providerPaymentId,
                      refundAmount: Number(refundOutcome.refund.amount),
                      totalRefundedOnPayment: refundOutcome.totalRefundedOnPayment,
                      paymentStatus: refundOutcome.paymentStatus,
                      invoiceNumber: invoice.number,
                      remainingInvoiceOutstanding: refundOutcome.newInvoiceOutstanding,
                      newInvoiceStatus: refundOutcome.newInvoiceStatus,
                    },
                  },
                }),
          };
        }

        // Cross-event idempotency check (e.g., payment_link.paid / checkout / order.paid / payment.captured)
        const idConditions: any[] = [];
        if (providerPaymentId) {
          idConditions.push({ providerRef: providerPaymentId });
          idConditions.push({ ref: `PAY-WH-${providerPaymentId}` });
          idConditions.push({
            ref: { startsWith: 'PAY-WH-' },
            notes: { contains: `[tx:${providerPaymentId}]` },
          });
          if (providerOrderId && !paymentLinkId) {
            idConditions.push({ notes: { contains: `[order:${providerOrderId}]` } });
          }
        } else if (paymentLinkId) {
          idConditions.push({ providerRef: paymentLinkId, status: PaymentStatus.COMPLETED });
          idConditions.push({ ref: `PAY-WH-${paymentLinkId}` });
          idConditions.push({
            ref: { startsWith: 'PAY-WH-' },
            notes: { contains: `[link:${paymentLinkId}]` },
          });
        } else if (providerOrderId) {
          idConditions.push({ providerRef: providerOrderId, status: PaymentStatus.COMPLETED });
          idConditions.push({ ref: `PAY-WH-${providerOrderId}` });
          idConditions.push({ notes: { contains: `[order:${providerOrderId}]` } });
        }

        const existingCompleted =
          idConditions.length > 0
            ? await tx.payment.findFirst({
                where: {
                  tenantId,
                  invoiceId: invoice.id,
                  status: { in: [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED] },
                  OR: idConditions,
                },
              })
            : null;

        if (existingCompleted) {
          this.logger.log(
            `Idempotent webhook replay detected: payment ${existingCompleted.id} already ${existingCompleted.status}.`,
          );
          return {
            response: {
              received: true,
              processed: true,
              idempotent: true,
              invoiceNumber: invoice.number,
              paidAmount: Number(existingCompleted.amount),
              invoiceStatus: invoice.status,
              paymentId: existingCompleted.id,
              message: 'Payment already processed and reconciled',
            },
          };
        }

        // 6. Handle Failed, Cancelled, or Expired Webhooks (ZERO balance deduction)
        if (verificationResult.status === 'FAILED') {
          const failureRef = providerPaymentId
            ? `PAY-FAIL-${providerPaymentId}`
            : paymentLinkId
              ? `PAY-FAIL-${paymentLinkId}`
              : providerOrderId
                ? `PAY-FAIL-${providerOrderId}`
                : `PAY-FAIL-${lockedPayment.id}`;
          const failureNote = `Payment failed via ${normalizedProvider} webhook (${verificationResult.event}) [link:${paymentLinkId || ''}] [order:${providerOrderId || ''}] [tx:${providerPaymentId || ''}]`;

          // Deduplicate failed payment rows across distinct event IDs for the same failed attempt
          const existingFailed = await tx.payment.findFirst({
            where: {
              tenantId,
              invoiceId: invoice.id,
              status: PaymentStatus.FAILED,
              OR: [
                { ref: failureRef },
                ...(providerPaymentId ? [{ providerRef: providerPaymentId }] : []),
              ],
            },
          });

          if (existingFailed) {
            return {
              response: {
                received: true,
                processed: true,
                idempotent: true,
                status: 'FAILED',
                invoiceNumber: invoice.number,
                paymentId: existingFailed.id,
                message: 'Failed payment already recorded; invoice balance remains unchanged.',
              },
            };
          }

          let failPayment;
          if (!providerPaymentId && lockedPayment.status === PaymentStatus.PENDING) {
            failPayment = await tx.payment.update({
              where: { id: lockedPayment.id },
              data: {
                ref: failureRef,
                status: PaymentStatus.FAILED,
                notes: failureNote,
              },
            });
          } else {
            failPayment = await tx.payment.create({
              data: {
                ref: failureRef,
                customerId: invoice.customerId,
                invoiceId: invoice.id,
                amount:
                  verificationResult.amount ??
                  (lockedPayment.ref?.startsWith('RZP-ORD-')
                    ? Number(lockedPayment.amount)
                    : invoice.outstanding),
                currency: invoice.currency,
                method: PaymentMethod.PAYMENT_LINK,
                status: PaymentStatus.FAILED,
                providerRef: providerPaymentId || paymentLinkId,
                notes: failureNote,
                tenantId,
              },
            });
          }

          return {
            response: {
              received: true,
              processed: true,
              idempotent: false,
              status: 'FAILED',
              invoiceNumber: invoice.number,
              paymentId: failPayment.id,
              message: 'Payment failure recorded; invoice balance remains unchanged.',
            },
            auditEntry: {
              tenantId,
              userId: auditActorId,
              action: 'payment.failed_via_webhook',
              entityType: 'Payment',
              entityId: failPayment.id,
              metadata: {
                provider: normalizedProvider,
                invoiceNumber: invoice.number,
                providerPaymentId,
                paymentLinkId,
                event: verificationResult.event,
              },
            },
          };
        }

        if (verificationResult.status === 'CANCELLED' || verificationResult.status === 'EXPIRED') {
          const cancelNote = `Payment link ${verificationResult.status.toLowerCase()} via ${normalizedProvider} webhook (${verificationResult.event}) [link:${paymentLinkId || ''}]`;
          if (paymentLinkId) {
            await tx.payment.updateMany({
              where: {
                tenantId,
                invoiceId: invoice.id,
                providerRef: paymentLinkId,
                status: PaymentStatus.PENDING,
              },
              data: { notes: cancelNote },
            });
          }

          return {
            response: {
              received: true,
              processed: true,
              idempotent: false,
              status: verificationResult.status,
              invoiceNumber: invoice.number,
              message: `Payment link ${verificationResult.status.toLowerCase()} recorded; invoice balance remains unchanged.`,
            },
            auditEntry: {
              tenantId,
              userId: auditActorId,
              action: `payment.link_${verificationResult.status.toLowerCase()}`,
              entityType: 'Payment',
              entityId: lockedPayment.id,
              metadata: {
                provider: normalizedProvider,
                invoiceNumber: invoice.number,
                paymentLinkId,
                event: verificationResult.event,
              },
            },
          };
        }

        if (verificationResult.status === 'PENDING') {
          return {
            response: {
              received: true,
              processed: true,
              idempotent: false,
              status: 'PENDING',
              invoiceNumber: invoice.number,
              message: `Event ${verificationResult.event} recorded as pending; invoice balance remains unchanged.`,
            },
            auditEntry: {
              tenantId,
              userId: auditActorId,
              action: 'payment.authorized_pending_via_webhook',
              entityType: 'Payment',
              entityId: lockedPayment.id,
              metadata: {
                provider: normalizedProvider,
                invoiceNumber: invoice.number,
                providerPaymentId,
                providerOrderId,
                paymentLinkId,
                event: verificationResult.event,
              },
            },
          };
        }

        // 7. Validate currency and amount before financial settlement
        const webhookCurrency = (verificationResult.currency || '').trim().toUpperCase();
        if (webhookCurrency && webhookCurrency !== invoice.currency.toUpperCase()) {
          this.logger.warn(
            `Webhook currency mismatch for invoice ${invoice.id}: expected ${invoice.currency}, got ${webhookCurrency}`,
          );
          throw new BadRequestException(
            `Webhook currency mismatch: expected ${invoice.currency}, received ${webhookCurrency}`,
          );
        }

        const paidAmount =
          verificationResult.amount !== undefined && verificationResult.amount !== null
            ? Number(verificationResult.amount)
            : Number(invoice.outstanding);

        if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
          throw new BadRequestException('Invalid webhook payment amount');
        }

        // Match PENDING anchor payment for this payment link or checkout order if still open
        const orderOrLinkPendingRef = paymentLinkId || providerOrderId;
        const pendingPayment =
          lockedPayment.status === PaymentStatus.PENDING
            ? lockedPayment
            : orderOrLinkPendingRef
              ? await tx.payment.findFirst({
                  where: {
                    tenantId,
                    invoiceId: invoice.id,
                    status: PaymentStatus.PENDING,
                    OR: [
                      ...(paymentLinkId ? [{ providerRef: paymentLinkId }] : []),
                      ...(providerOrderId
                        ? [{ providerRef: providerOrderId }, { ref: `RZP-ORD-${providerOrderId}` }]
                        : []),
                    ],
                  },
                })
              : null;

        const stableRef = providerPaymentId
          ? `PAY-WH-${providerPaymentId}`
          : paymentLinkId
            ? `PAY-WH-${paymentLinkId}`
            : providerOrderId
              ? `PAY-WH-${providerOrderId}`
              : `PAY-WH-${invoice.number}-${Date.now()}`;

        const settled = await this.reconcileSettledPaymentTx(tx, {
          tenantId,
          invoice,
          pendingPayment,
          paidAmount,
          stableRef,
          providerRef: providerPaymentId || paymentLinkId || providerOrderId,
          providerOrderId,
          notePrefix: `Reconciled via ${normalizedProvider} webhook (${verificationResult.event})`,
          extraNoteTags: `[link:${paymentLinkId || ''}] [order:${providerOrderId || ''}] [tx:${providerPaymentId || ''}]`,
        });

        return {
          response: {
            received: true,
            processed: true,
            idempotent: false,
            invoiceNumber: invoice.number,
            paidAmount,
            remainingInvoiceOutstanding: settled.newInvoiceOutstanding,
            overpaymentDetected: settled.overpaymentAmount > 0,
            ...(settled.overpaymentAmount > 0 ? { overpaymentAmount: settled.overpaymentAmount } : {}),
            invoiceStatus: settled.newInvoiceStatus,
            paymentId: settled.settledPayment.id,
          },
          auditEntry: {
            tenantId,
            userId: auditActorId,
            action:
              settled.overpaymentAmount > 0
                ? 'payment.overpayment_received_via_webhook'
                : 'payment.received_via_webhook',
            entityType: 'Payment',
            entityId: settled.settledPayment.id,
            metadata: {
              provider: normalizedProvider,
              invoiceNumber: invoice.number,
              paidAmount,
              remainingInvoiceOutstanding: settled.newInvoiceOutstanding,
              overpaymentDetected: settled.overpaymentAmount > 0,
              ...(settled.overpaymentAmount > 0 ? { overpaymentAmount: settled.overpaymentAmount } : {}),
              newInvoiceStatus: settled.newInvoiceStatus,
              providerPaymentId,
              providerOrderId,
              paymentLinkId,
            },
          },
        };
      });
    } catch (err: any) {
      // Gracefully resolve concurrent race conditions that hit unique constraint on Payment.ref or PaymentRefund.providerRefundId
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        if (
          (verificationResult.status === 'REFUND_PROCESSED' ||
            verificationResult.status === 'REFUND_PENDING' ||
            verificationResult.status === 'REFUND_FAILED') &&
          providerRefundId &&
          (this.prisma as any).paymentRefund?.findFirst
        ) {
          const concurrentRefund = await (this.prisma as any).paymentRefund.findFirst({
            where: { providerRefundId, tenantId: anchorPayment.tenantId },
          });
          if (concurrentRefund) {
            return {
              received: true,
              processed: true,
              idempotent: true,
              status:
                concurrentRefund.status === RefundStatus.PROCESSED
                  ? 'REFUND_PROCESSED'
                  : concurrentRefund.status === RefundStatus.FAILED
                    ? 'REFUND_FAILED'
                    : 'REFUND_PENDING',
              providerRefundId,
              providerPaymentId,
              message: 'Refund event already processed concurrently',
            };
          }
        }
        const stableRef = providerPaymentId
          ? `PAY-WH-${providerPaymentId}`
          : paymentLinkId
            ? `PAY-WH-${paymentLinkId}`
            : providerOrderId
              ? `PAY-WH-${providerOrderId}`
              : null;
        if (stableRef) {
          const concurrentPayment = await this.prisma.payment.findFirst({
            where: { ref: stableRef, tenantId: anchorPayment.tenantId },
            include: { invoice: true },
          });
          if (concurrentPayment) {
            this.logger.log(
              `Concurrent duplicate webhook delivery resolved idempotently for ref: ${stableRef}`,
            );
            return {
              received: true,
              processed: true,
              idempotent: true,
              invoiceNumber: concurrentPayment.invoice?.number,
              paidAmount: Number(concurrentPayment.amount),
              invoiceStatus: concurrentPayment.invoice?.status || InvoiceStatus.PAID,
              paymentId: concurrentPayment.id,
              message: 'Payment already processed concurrently and reconciled',
            };
          }
        }
      }
      throw err;
    }

    if (txOutcome.auditEntry) {
      await this.auditLogs.log(txOutcome.auditEntry);
    }

    return txOutcome.response;
  }
}

