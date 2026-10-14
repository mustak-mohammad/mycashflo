import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
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
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: InvoiceQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
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
    return invoice;
  }

  async create(user: AuthUser, dto: CreateInvoiceDto) {
    // Verify customer belongs to same tenant
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId: user.tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.invoice.create({
      data: {
        ...dto,
        amount: dto.amount,
        outstanding: dto.amount,
        status: 'OPEN',
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        currency: dto.currency ?? 'INR',
        tenantId: user.tenantId,
      },
    });
  }

  async update(id: string, user: AuthUser, dto: UpdateInvoiceDto) {
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
