import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { CasePriority, CaseStatus } from '@prisma/client';

// ── DTOs ─────────────────────────────────────────────────────────────────────
export class CollectionQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsNumber() page?: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsNumber() limit?: number = 20;
  @ApiPropertyOptional({ enum: CaseStatus }) @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @ApiPropertyOptional({ enum: CasePriority }) @IsOptional() @IsEnum(CasePriority) priority?: CasePriority;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedTo?: string;
}

export class PatchCollectionCaseDto {
  @ApiPropertyOptional({ enum: CaseStatus }) @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedTo?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────
@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: CollectionQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignedTo ? { assignedTo: query.assignedTo } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.collectionCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, outstandingBalance: true } },
          invoice: { select: { id: true, number: true, outstanding: true } },
          assignedAgent: { select: { id: true, name: true } },
          followUpTasks: { where: { done: false }, orderBy: { dueDate: 'asc' }, take: 1 },
        },
      }),
      this.prisma.collectionCase.count({ where }),
    ]);

    // Summary counts
    const [openCount, highCount] = await Promise.all([
      this.prisma.collectionCase.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.collectionCase.count({ where: { tenantId, priority: { in: ['HIGH', 'URGENT'] } } }),
    ]);

    return { data, total, page, limit, summary: { openCount, highCount } };
  }

  async findOne(id: string, user: AuthUser) {
    const c = await this.prisma.collectionCase.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        invoice: true,
        assignedAgent: { select: { id: true, name: true, email: true } },
        followUpTasks: { orderBy: { dueDate: 'asc' } },
        paymentPromises: { orderBy: { createdAt: 'desc' } },
        callSessions: { orderBy: { startedAt: 'desc' }, take: 5 },
      },
    });
    if (!c) throw new NotFoundException('Collection case not found');
    return c;
  }

  async patch(id: string, user: AuthUser, dto: PatchCollectionCaseDto) {
    await this.findOne(id, user);
    return this.prisma.collectionCase.update({
      where: { id },
      data: { ...dto, ...(dto.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}) },
    });
  }
}
