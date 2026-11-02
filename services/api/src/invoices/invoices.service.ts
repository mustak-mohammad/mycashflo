import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { InvoiceQueryDto } from '../common/dto/query.dto.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsString, IsNumber, IsDateString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { InvoiceStatus } from '@prisma/client';

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

  async update(id: string, user: AuthUser, dto: UpdateInvoiceDto) {
    if (user.role === 'AGENT') {
      throw new ForbiddenException('Agents are not authorized to update invoices');
    }
    await this.findOne(id, user);
    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
    });
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
