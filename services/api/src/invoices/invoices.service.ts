import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { InvoiceQueryDto } from '../common/dto/query.dto.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsString, IsNumber, IsDateString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  InvoiceStatus,
  PaymentStatus,
  OrderIntentStatus,
  RefundStatus,
  CaseStatus,
  PromiseStatus,
} from '@prisma/client';

export class CreateInvoiceDto {
  @ApiProperty({ example: 'INV-2024-001' }) @IsString() number: string;
  @ApiProperty({ example: 'customer-cuid' }) @IsString() customerId: string;
  @ApiProperty({ example: 45000 }) @Type(() => Number) @IsNumber() amount: number;
  @ApiProperty({ example: '2024-10-01' }) @IsDateString() issueDate: string;
  @ApiProperty({ example: '2024-10-31' }) @IsDateString() dueDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: 'INR' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional({ example: 'CUST-001' }) @IsOptional() @IsString() customerReference?: string;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs?: AuditLogsService,
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

  async findAll(user: AuthUser, query: InvoiceQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      assignedFilter = { customerId: { in: allowedCustomerIds } };
    }

    const where = {
      tenantId,
      ...assignedFilter,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { dueDate: 'asc' },
        include: { customer: { select: { name: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async exportCsv(user: AuthUser, query: InvoiceQueryDto): Promise<string> {
    const { tenantId, role, userId } = user;

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(tenantId, userId);
      assignedFilter = { customerId: { in: allowedCustomerIds } };
    }

    const where = {
      tenantId,
      ...assignedFilter,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status as any } : {}),
    };

    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: { customer: { select: { name: true } } },
    });

    const escapeCell = (val: any): string => {
      let str = val === null || val === undefined ? '' : String(val);
      // Formula injection defense: prepend apostrophe if string begins with =, +, -, @, \t, \r
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows: string[] = [];
    rows.push(
      ['Invoice #', 'Customer', 'Amount (INR)', 'Outstanding (INR)', 'Issue Date', 'Due Date', 'Status', 'Currency'].join(','),
    );

    for (const inv of invoices) {
      rows.push(
        [
          inv.number,
          inv.customer?.name ?? '',
          Number(inv.amount).toFixed(2),
          Number(inv.outstanding).toFixed(2),
          inv.issueDate.toISOString().slice(0, 10),
          inv.dueDate.toISOString().slice(0, 10),
          inv.status,
          inv.currency,
        ]
          .map(escapeCell)
          .join(','),
      );
    }

    return rows.join('\r\n');
  }

  async getInvoiceForPdf(id: string, user: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (user.role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(user.tenantId, user.userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException('Access denied: You are not assigned to this invoice or customer');
      }
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    return { invoice, tenantName: tenant?.name ?? 'myCashflo' };
  }

  async findOne(id: string, user: AuthUser) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        payments: { orderBy: { createdAt: 'desc' } },
        paymentPromises: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (user.role === 'AGENT') {
      const allowedCustomerIds = await this.getAgentCustomerIds(user.tenantId, user.userId);
      if (!allowedCustomerIds.includes(invoice.customerId)) {
        throw new ForbiddenException('Access denied: You are not assigned to this invoice or customer');
      }
    }

    return invoice;
  }

  async create(user: AuthUser, dto: CreateInvoiceDto) {
    const { tenantId, userId, role } = user;

    if (role === 'AGENT') {
      throw new ForbiddenException('Agents are not authorized to create invoices');
    }

    // Verify customer belongs to same tenant
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const amt = Number(dto.amount);
    if (isNaN(amt) || amt <= 0) {
      throw new BadRequestException('Invoice amount must be greater than 0');
    }

    const issueDate = new Date(dto.issueDate);
    const dueDate = new Date(dto.dueDate);
    if (isNaN(issueDate.getTime()) || isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid issue date or due date format');
    }
    if (dueDate < issueDate) {
      throw new BadRequestException('Due date cannot be earlier than issue date');
    }

    const invNum = dto.number.trim().toUpperCase();
    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId, number: invNum },
    });
    if (existing) {
      throw new BadRequestException(`Invoice number '${invNum}' already exists in this tenant`);
    }

    const now = new Date();
    const isOverdue = dueDate < now;
    const status: InvoiceStatus = isOverdue ? 'OVERDUE' : 'OPEN';

    const invoice = await this.prisma.invoice.create({
      data: {
        number: invNum,
        customerId: dto.customerId,
        amount: amt,
        outstanding: amt,
        status,
        issueDate,
        dueDate,
        description: dto.description,
        currency: dto.currency ?? 'INR',
        tenantId,
      },
    });

    // Recalculate customer's outstanding balance from invoices
    const unpaidInvoices = await this.prisma.invoice.findMany({
      where: {
        customerId: dto.customerId,
        tenantId,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: { outstanding: true },
    });
    const totalOutstanding = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.outstanding), 0);
    await this.prisma.customer.update({
      where: { id: dto.customerId },
      data: { outstandingBalance: totalOutstanding },
    });

    if (this.auditLogs) {
      await this.auditLogs.log({
        tenantId,
        userId,
        action: 'invoice.created',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: { number: invNum, amount: amt, customerId: dto.customerId },
      });
    }

    return invoice;
  }

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
        throw lockErr;
      }
    }
  }

  async update(id: string, user: AuthUser, dto: UpdateInvoiceDto) {
    if (user.role === 'AGENT') {
      throw new ForbiddenException('Agents are not authorized to update invoices');
    }

    const existing = await this.findOne(id, user);

    if (existing.status === InvoiceStatus.CANCELLED) {
      if (dto.status && dto.status !== InvoiceStatus.CANCELLED) {
        throw new BadRequestException('Cannot modify status of a CANCELLED invoice');
      }
      throw new BadRequestException('Cannot modify an invoice marked as CANCELLED');
    }

    if (dto.status === InvoiceStatus.PAID && existing.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Direct transition to PAID is not permitted. Invoices are marked PAID via payment reconciliation.',
      );
    }

    if (dto.status === InvoiceStatus.PARTIALLY_PAID && existing.status !== InvoiceStatus.PARTIALLY_PAID) {
      throw new BadRequestException(
        'Direct transition to PARTIALLY_PAID is not permitted. Invoices are marked PARTIALLY_PAID via payment reconciliation.',
      );
    }

    // ── Invoice Cancellation Flow ──────────────────────────────────────────
    if (dto.status === InvoiceStatus.CANCELLED) {
      return this.prisma.$transaction(async (tx) => {
        // 1. Strict lock ordering: Customer FIRST, Invoice SECOND
        await this.acquireCustomerAndInvoiceLocksTx(tx, existing.customerId, id, user.tenantId);

        // 2. Re-read fresh invoice state after acquiring row locks
        const lockedInvoice = await tx.invoice.findFirst({
          where: { id, tenantId: user.tenantId },
          include: {
            payments: true,
            paymentOrderIntents: true,
            paymentRefunds: true,
            collectionCases: true,
            paymentPromises: true,
          },
        });

        if (!lockedInvoice) {
          throw new NotFoundException('Invoice not found');
        }

        if (lockedInvoice.status === InvoiceStatus.CANCELLED) {
          throw new BadRequestException('Invoice is already marked as CANCELLED');
        }

        if (lockedInvoice.status === InvoiceStatus.PAID) {
          throw new BadRequestException('Cannot cancel an invoice marked as PAID');
        }

        // 3. Inspect all payment records and financial operations
        const completedPayments = lockedInvoice.payments?.filter(
          (p: any) => p.status === PaymentStatus.COMPLETED,
        ) ?? [];
        if (completedPayments.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: completed payment records exist');
        }

        const pendingPayments = lockedInvoice.payments?.filter(
          (p: any) => p.status === PaymentStatus.PENDING,
        ) ?? [];
        if (pendingPayments.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: pending payment operations or claims exist');
        }

        const activeIntents = lockedInvoice.paymentOrderIntents?.filter(
          (poi: any) =>
            poi.status === OrderIntentStatus.CREATED ||
            poi.status === OrderIntentStatus.CREATING ||
            poi.activeClaimKey !== null,
        ) ?? [];
        if (activeIntents.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: active payment intent in progress');
        }

        const pendingRefunds = lockedInvoice.paymentRefunds?.filter(
          (r: any) => r.status === RefundStatus.PENDING,
        ) ?? [];
        if (pendingRefunds.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: pending refund operations exist');
        }

        const activeCases = lockedInvoice.collectionCases?.filter(
          (c: any) => c.status === CaseStatus.OPEN || c.status === CaseStatus.IN_PROGRESS,
        ) ?? [];
        if (activeCases.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: active collection case in progress');
        }

        const pendingPromises = lockedInvoice.paymentPromises?.filter(
          (pp: any) => pp.status === PromiseStatus.PENDING,
        ) ?? [];
        if (pendingPromises.length > 0) {
          throw new BadRequestException('Cannot cancel invoice: pending payment promise exists');
        }

        // 4. Update status to CANCELLED (preserve historical amount and outstanding)
        const updatedInvoice = await tx.invoice.update({
          where: { id },
          data: {
            status: InvoiceStatus.CANCELLED,
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
          },
        });

        // 5. Recalculate customer's outstanding balance from active receivable invoices only
        const unpaidInvoices = await tx.invoice.findMany({
          where: {
            customerId: lockedInvoice.customerId,
            tenantId: user.tenantId,
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PARTIALLY_PAID] },
          },
          select: { outstanding: true },
        });

        const totalOutstanding = unpaidInvoices.reduce(
          (sum: number, inv: any) => sum + Number(inv.outstanding),
          0,
        );

        await tx.customer.update({
          where: { id: lockedInvoice.customerId },
          data: { outstandingBalance: totalOutstanding },
        });

        // 6. Record audit log entry within transaction flow
        if (this.auditLogs) {
          await this.auditLogs.log({
            tenantId: user.tenantId,
            userId: user.userId,
            action: 'invoice.cancelled',
            entityType: 'Invoice',
            entityId: id,
            metadata: {
              number: lockedInvoice.number,
              customerId: lockedInvoice.customerId,
              previousStatus: lockedInvoice.status,
              newStatus: InvoiceStatus.CANCELLED,
              amount: Number(lockedInvoice.amount),
              outstanding: Number(lockedInvoice.outstanding),
              recalculatedCustomerBalance: totalOutstanding,
              actor: user.userId,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return updatedInvoice;
      });
    }

    // ── Ordinary Invoice Updates (description, dueDate, status) ───────────
    const updateData: any = {};
    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }
    if (dto.dueDate) {
      const parsedDue = new Date(dto.dueDate);
      if (isNaN(parsedDue.getTime())) {
        throw new BadRequestException('Invalid due date format');
      }
      updateData.dueDate = parsedDue;
    }
    if (dto.status && dto.status !== existing.status) {
      if (dto.status === InvoiceStatus.OPEN || dto.status === InvoiceStatus.OVERDUE) {
        updateData.status = dto.status;
      } else {
        throw new BadRequestException(`Invalid status transition from ${existing.status} to ${dto.status}`);
      }
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: updateData,
    });

    if (this.auditLogs) {
      await this.auditLogs.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'invoice.updated',
        entityType: 'Invoice',
        entityId: id,
        metadata: {
          number: existing.number,
          customerId: existing.customerId,
          previousStatus: existing.status,
          newStatus: updated.status,
          changes: Object.keys(updateData),
          actor: user.userId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return updated;
  }

  // ── Dashboard helpers ──────────────────────────────────────────────────────
  async getOverdueInvoices(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId, status: 'OVERDUE' },
      include: { customer: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 50,
    });
  }
}
