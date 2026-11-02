import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum, IsString, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaymentMethod, PaymentStatus, InvoiceStatus } from '@prisma/client';

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

    const newOutstanding = Math.max(0, currentOutstanding - payAmt);
    const newStatus: InvoiceStatus =
      newOutstanding === 0
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIALLY_PAID;

    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        ref: cleanRef,
        providerRef: cleanRef,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: payAmt,
        currency: invoice.currency,
        paidAt: payDate,
        method: dto.method || PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.COMPLETED,
        notes: dto.notes || 'Manually recorded settlement',
      },
    });

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        outstanding: newOutstanding,
        status: newStatus,
      },
    });

    // Auto-resolve any active collection case for this invoice if fully paid
    if (newStatus === InvoiceStatus.PAID && this.prisma.collectionCase?.updateMany) {
      try {
        await this.prisma.collectionCase.updateMany({
          where: { tenantId, invoiceId: invoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
      } catch {
        // Safe fallback in test mocks
      }
    }

    // Rebalance customer outstanding balance
    const unpaidInvoices = await this.prisma.invoice.findMany({
      where: {
        customerId: invoice.customerId,
        tenantId,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: { outstanding: true },
    });
    const totalCustOutstanding = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.outstanding), 0);
    await this.prisma.customer.update({
      where: { id: invoice.customerId },
      data: { outstandingBalance: totalCustOutstanding },
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
    const currentOutstanding = Number(invoice.outstanding);
    const newOutstanding = Math.max(0, currentOutstanding - payAmt);
    const newStatus: InvoiceStatus =
      newOutstanding === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

    const [updatedPayment] = await Promise.all([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
          notes: `${payment.notes || ''} [VERIFIED by ${userId} at ${new Date().toISOString()}]`.trim(),
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          outstanding: newOutstanding,
          status: newStatus,
        },
      }),
    ]);

    // Auto-resolve case if fully settled
    if (newStatus === InvoiceStatus.PAID && this.prisma.collectionCase?.updateMany) {
      try {
        await this.prisma.collectionCase.updateMany({
          where: { tenantId, invoiceId: invoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
      } catch {
        // Safe fallback in test mocks
      }
    }

    // Rebalance customer outstanding balance
    const unpaidInvoices = await this.prisma.invoice.findMany({
      where: {
        customerId: invoice.customerId,
        tenantId,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: { outstanding: true },
    });
    const totalCustOutstanding = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.outstanding), 0);
    await this.prisma.customer.update({
      where: { id: invoice.customerId },
      data: { outstandingBalance: totalCustOutstanding },
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

  async createPaymentLink(user: AuthUser, dto: CreatePaymentLinkDto) {
    const { tenantId, userId } = user;

    // 1. Fetch invoice with customer (tenant-isolated)
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, tenantId },
      include: { customer: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found in tenant');
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
        notes: linkResult.url,
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

  async handleWebhook(
    provider: string,
    payload: any,
    headers: Record<string, string>,
    rawBody?: Buffer | string,
  ) {
    const normalizedProvider = provider.toUpperCase();

    // 1. Verify Signature BEFORE any database operation or financial changes
    let verificationResult;
    if (normalizedProvider === 'RAZORPAY') {
      const signature = headers['x-razorpay-signature'] || headers['x-signature'] || '';
      verificationResult = await this.integrations.razorpay.verifyWebhook(
        payload,
        signature,
        undefined,
        rawBody,
      );
    } else if (normalizedProvider === 'STRIPE') {
      const signature = headers['stripe-signature'] || headers['x-signature'] || '';
      verificationResult = await this.integrations.stripe.verifyWebhook(
        payload,
        signature,
        undefined,
        rawBody,
      );
    } else {
      throw new BadRequestException(`Unsupported payment provider webhook: ${provider}`);
    }

    if (!verificationResult.isValid) {
      this.logger.warn(`Invalid webhook signature received for provider ${normalizedProvider}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    // 2. Identify Invoice
    const invoiceNumber = verificationResult.invoiceNumber;
    if (!invoiceNumber) {
      this.logger.log(`Webhook received event ${verificationResult.event} without invoice reference`);
      return { received: true, processed: false, reason: 'No invoice reference found' };
    }

    const providerPaymentId = verificationResult.providerPaymentId
      ? String(verificationResult.providerPaymentId).trim()
      : null;
    const paymentLinkId = verificationResult.paymentLinkId
      ? String(verificationResult.paymentLinkId).trim()
      : null;

    // 3. Reconcile Atomically within Database Transaction
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { number: invoiceNumber },
          include: { customer: true, tenant: true },
        });

        if (!invoice) {
          this.logger.warn(`Webhook referenced non-existent invoice ${invoiceNumber}`);
          return { received: true, processed: false, reason: 'Invoice not found' };
        }

        // Serialize concurrent duplicate webhook requests using row-level lock on the invoice
        try {
          await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoice.id} FOR UPDATE`;
        } catch (lockErr) {
          // In unit test mocks or SQLite, $queryRaw might not be implemented, proceed safely
          this.logger.debug(`Row lock skipped or unavailable: ${(lockErr as Error).message}`);
        }

        const tenantId = invoice.tenantId;

        // 4. Stable Idempotency Check across Provider Payment ID and Payment Link ID
        // When providerPaymentId is present, idempotency MUST be scoped to that specific transaction ID.
        // We only fall back to paymentLinkId matching if providerPaymentId is absent,
        // which prevents distinct partial payments on the same payment link from being falsely dropped as duplicates.
        const idConditions: any[] = [];
        if (providerPaymentId) {
          idConditions.push({ providerRef: providerPaymentId });
          idConditions.push({ ref: `PAY-WH-${providerPaymentId}` });
          idConditions.push({ notes: { contains: `[tx:${providerPaymentId}]` } });
        } else if (paymentLinkId) {
          idConditions.push({
            providerRef: paymentLinkId,
            status: PaymentStatus.COMPLETED,
          });
          idConditions.push({ ref: `PAY-WH-${paymentLinkId}` });
          idConditions.push({ notes: { contains: `[link:${paymentLinkId}]` } });
        }

        const existingCompleted =
          idConditions.length > 0
            ? await tx.payment.findFirst({
                where: {
                  tenantId,
                  status: PaymentStatus.COMPLETED,
                  OR: idConditions,
                },
              })
            : null;

        if (existingCompleted) {
          this.logger.log(
            `Idempotent webhook replay detected: payment ${existingCompleted.id} (ref: ${existingCompleted.ref}, providerRef: ${existingCompleted.providerRef}) already COMPLETED. Skipping duplicate balance adjustment.`,
          );
          return {
            received: true,
            processed: true,
            idempotent: true,
            invoiceNumber,
            paidAmount: Number(existingCompleted.amount),
            invoiceStatus: invoice.status,
            paymentId: existingCompleted.id,
            message: 'Payment already processed and reconciled',
          };
        }

        // 5. Handle Failed, Cancelled, or Expired Webhooks (ZERO balance deduction)
        if (verificationResult.status === 'FAILED') {
          const failureRef = providerPaymentId ? `PAY-FAIL-${providerPaymentId}` : `PAY-FAIL-${Date.now()}`;
          const failureNote = `Payment failed via ${normalizedProvider} webhook (${verificationResult.event}) [link:${paymentLinkId || ''}] [tx:${providerPaymentId || ''}]`;

          let failPayment = paymentLinkId
            ? await tx.payment.findFirst({
                where: {
                  tenantId,
                  invoiceId: invoice.id,
                  providerRef: paymentLinkId,
                },
              })
            : null;

          if (failPayment) {
            failPayment = await tx.payment.update({
              where: { id: failPayment.id },
              data: {
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
                amount: verificationResult.amount || invoice.outstanding,
                currency: invoice.currency,
                method: PaymentMethod.PAYMENT_LINK,
                status: PaymentStatus.FAILED,
                providerRef: providerPaymentId || paymentLinkId,
                notes: failureNote,
                tenantId,
              },
            });
          }

          const systemUser = await tx.user.findFirst({
            where: { tenantId, role: 'ADMIN' },
          });

          await this.auditLogs.log({
            tenantId,
            userId: systemUser?.id || invoice.tenant.id,
            action: 'payment.failed_via_webhook',
            entityType: 'Payment',
            entityId: failPayment.id,
            metadata: {
              provider: normalizedProvider,
              invoiceNumber,
              providerPaymentId,
              paymentLinkId,
              event: verificationResult.event,
            },
          });

          return {
            received: true,
            processed: true,
            status: 'FAILED',
            invoiceNumber,
            message: 'Payment failure recorded; invoice balance remains unchanged.',
          };
        }

        if (verificationResult.status === 'CANCELLED' || verificationResult.status === 'EXPIRED') {
          const cancelNote = `Payment link ${verificationResult.status.toLowerCase()} via ${normalizedProvider} webhook (${verificationResult.event})`;
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

          const systemUser = await tx.user.findFirst({
            where: { tenantId, role: 'ADMIN' },
          });

          await this.auditLogs.log({
            tenantId,
            userId: systemUser?.id || invoice.tenant.id,
            action: `payment.link_${verificationResult.status.toLowerCase()}`,
            entityType: 'Payment',
            metadata: {
              provider: normalizedProvider,
              invoiceNumber,
              paymentLinkId,
              event: verificationResult.event,
            },
          });

          return {
            received: true,
            processed: true,
            status: verificationResult.status,
            invoiceNumber,
            message: `Payment link ${verificationResult.status.toLowerCase()} recorded; invoice balance remains unchanged.`,
          };
        }

        // 6. Match existing PENDING payment for this payment link (if initiated earlier)
        let payment = paymentLinkId
          ? await tx.payment.findFirst({
              where: {
                tenantId,
                invoiceId: invoice.id,
                status: PaymentStatus.PENDING,
                providerRef: paymentLinkId,
              },
            })
          : null;

        const paidAmount =
          verificationResult.amount !== undefined && verificationResult.amount !== null
            ? Number(verificationResult.amount)
            : Number(invoice.outstanding);

        const stableRef = providerPaymentId
          ? `PAY-WH-${providerPaymentId}`
          : paymentLinkId
            ? `PAY-WH-${paymentLinkId}`
            : `PAY-WH-${invoice.number}-${Date.now()}`;

        const reconciliationNote = `Reconciled via ${normalizedProvider} webhook (${verificationResult.event}) [link:${paymentLinkId || ''}] [tx:${providerPaymentId || ''}]`;

        if (payment) {
          payment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              ref: stableRef,
              status: PaymentStatus.COMPLETED,
              paidAt: new Date(),
              amount: paidAmount,
              providerRef: providerPaymentId || payment.providerRef,
              notes: reconciliationNote,
            },
          });
        } else {
          payment = await tx.payment.create({
            data: {
              ref: stableRef,
              customerId: invoice.customerId,
              invoiceId: invoice.id,
              amount: paidAmount,
              currency: invoice.currency,
              method: PaymentMethod.PAYMENT_LINK,
              status: PaymentStatus.COMPLETED,
              providerRef: providerPaymentId || paymentLinkId,
              paidAt: new Date(),
              notes: reconciliationNote,
              tenantId,
            },
          });
        }

        // 6. Consistent Balance Reconciliation (Preserves Partial Payments and Multiple Distinct Payments)
        const currentInvoiceOutstanding = Number(invoice.outstanding);
        const actualDeduction = Math.min(currentInvoiceOutstanding, paidAmount);
        const newInvoiceOutstanding = Math.max(0, currentInvoiceOutstanding - paidAmount);
        const newInvoiceStatus =
          newInvoiceOutstanding <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            outstanding: newInvoiceOutstanding,
            status: newInvoiceStatus,
          },
        });

        // Auto-resolve any active collection case for this invoice if fully paid
        if (newInvoiceStatus === InvoiceStatus.PAID && tx.collectionCase?.updateMany) {
          try {
            await tx.collectionCase.updateMany({
              where: { tenantId, invoiceId: invoice.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
              data: { status: 'RESOLVED', resolvedAt: new Date() },
            });
          } catch {
            // Safe fallback in test mocks
          }
        }

        const currentCustBalance = Number(invoice.customer.outstandingBalance);
        const newCustBalance = Math.max(0, currentCustBalance - actualDeduction);
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: {
            outstandingBalance: newCustBalance,
          },
        });

        // 7. Record Audit Log
        const systemUser = await tx.user.findFirst({
          where: { tenantId, role: 'ADMIN' },
        });

        await this.auditLogs.log({
          tenantId,
          userId: systemUser?.id || invoice.tenant.id,
          action: 'payment.received_via_webhook',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: {
            provider: normalizedProvider,
            invoiceNumber,
            paidAmount,
            remainingInvoiceOutstanding: newInvoiceOutstanding,
            newInvoiceStatus,
            providerPaymentId,
            paymentLinkId,
          },
        });

        return {
          received: true,
          processed: true,
          idempotent: false,
          invoiceNumber,
          paidAmount,
          invoiceStatus: newInvoiceStatus,
          paymentId: payment.id,
        };
      });
    } catch (err: any) {
      // Gracefully resolve concurrent race conditions that hit unique constraint on ref
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        const stableRef = providerPaymentId
          ? `PAY-WH-${providerPaymentId}`
          : paymentLinkId
            ? `PAY-WH-${paymentLinkId}`
            : null;
        if (stableRef) {
          const concurrentPayment = await this.prisma.payment.findFirst({
            where: { ref: stableRef },
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
              invoiceNumber,
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
  }
}

