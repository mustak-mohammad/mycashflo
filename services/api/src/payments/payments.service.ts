import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

// ── DTOs ─────────────────────────────────────────────────────────────────────
export class PaymentQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() limit?: number = 20;
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
}

// ── Service ───────────────────────────────────────────────────────────────────
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: PaymentQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
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
    const { tenantId } = user;

    const [totalCollected, countByMethod] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { tenantId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { tenantId, status: 'COMPLETED' },
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
}
