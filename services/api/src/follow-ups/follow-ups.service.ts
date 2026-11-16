import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum, IsString, IsBoolean, IsDateString, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { CasePriority } from '@prisma/client';

export class FollowUpQueryDto {
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

  @ApiPropertyOptional({ enum: CasePriority })
  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class CreateFollowUpDto {
  @ApiProperty({ example: 'Call to confirm payment' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'Customer mentioned paying by Friday' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-10-20T10:00:00Z' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ enum: CasePriority, default: CasePriority.MEDIUM })
  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority = CasePriority.MEDIUM;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  collectionCaseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class UpdateFollowUpDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: CasePriority })
  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedTo?: string;
}

@Injectable()
export class FollowUpsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: FollowUpQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const assignedFilter =
      role === 'AGENT'
        ? { assignedTo: userId }
        : query.assignedTo
        ? { assignedTo: query.assignedTo }
        : {};

    const where = {
      tenantId,
      ...assignedFilter,
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.done !== undefined ? { done: query.done } : {}),
    };

    const summaryWhere = {
      tenantId,
      ...assignedFilter,
    };

    const [data, total, pendingCount, completedCount] = await Promise.all([
      this.prisma.followUpTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ done: 'asc' }, { dueDate: 'asc' }],
        include: {
          assignedAgent: { select: { id: true, name: true, email: true } },
          collectionCase: {
            include: {
              customer: { select: { id: true, name: true, phone: true, company: true } },
            },
          },
        },
      }),
      this.prisma.followUpTask.count({ where }),
      this.prisma.followUpTask.count({ where: { ...summaryWhere, done: false } }),
      this.prisma.followUpTask.count({ where: { ...summaryWhere, done: true } }),
    ]);

    // Defense-in-depth: Ensure eager-loaded relations cannot leak cross-tenant data
    const sanitizedData = data.map((t) => {
      if (
        t.collectionCase &&
        (t.collectionCase as any).tenantId &&
        (t.collectionCase as any).tenantId !== tenantId
      ) {
        return { ...t, collectionCase: null, collectionCaseId: null };
      }
      return t;
    });

    return {
      data: sanitizedData,
      total,
      page,
      limit,
      summary: {
        pendingCount,
        completedCount,
      },
    };
  }

  async findOne(id: string, user: AuthUser) {
    const task = await this.prisma.followUpTask.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        collectionCase: {
          include: {
            customer: true,
            invoice: true,
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Follow-up task not found');

    if (user.role === 'AGENT' && task.assignedTo !== user.userId) {
      throw new ForbiddenException('Access denied: You are not assigned to this follow-up task');
    }

    // Defense-in-depth: Ensure eager-loaded relations cannot leak cross-tenant data
    if (
      task.collectionCase &&
      (task.collectionCase as any).tenantId &&
      (task.collectionCase as any).tenantId !== user.tenantId
    ) {
      task.collectionCase = null as any;
      task.collectionCaseId = null as any;
    }

    return task;
  }

  async create(user: AuthUser, dto: CreateFollowUpDto) {
    const { tenantId, userId, role } = user;

    let effectiveCustomerId = dto.customerId;
    let colCase: any = null;

    if (dto.collectionCaseId) {
      colCase = await this.prisma.collectionCase.findFirst({
        where: { id: dto.collectionCaseId, tenantId },
      });
      if (!colCase) {
        throw new NotFoundException('Collection case not found in current tenant');
      }

      if (dto.customerId) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: dto.customerId, tenantId },
        });
        if (!customer) {
          throw new NotFoundException('Customer not found in current tenant');
        }
        if (colCase.customerId !== customer.id) {
          throw new BadRequestException('Collection case does not belong to the specified customer');
        }
      } else {
        effectiveCustomerId = colCase.customerId;
      }

      if (role === 'AGENT' && colCase.assignedTo && colCase.assignedTo !== userId) {
        throw new ForbiddenException('Access denied: You are not assigned to this collection case');
      }
    } else if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
      });
      if (!customer) {
        throw new NotFoundException('Customer not found in current tenant');
      }
      effectiveCustomerId = customer.id;
    }

    let assignedTo = userId;
    if (role === 'AGENT') {
      assignedTo = userId;
    } else if (dto.assignedTo) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: dto.assignedTo, tenantId, isActive: true },
      });
      if (!assignee) {
        throw new BadRequestException('Assigned user not found in current tenant or is inactive');
      }
      assignedTo = assignee.id;
    }

    return this.prisma.followUpTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: new Date(dto.dueDate),
        priority: dto.priority ?? CasePriority.MEDIUM,
        collectionCaseId: dto.collectionCaseId ? colCase.id : undefined,
        customerId: effectiveCustomerId,
        assignedTo,
        tenantId,
      },
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        collectionCase: {
          include: {
            customer: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async update(id: string, user: AuthUser, dto: UpdateFollowUpDto) {
    const task = await this.findOne(id, user);

    let assignedTo = task.assignedTo;
    if (dto.assignedTo !== undefined && dto.assignedTo !== task.assignedTo) {
      if (user.role === 'AGENT' && dto.assignedTo !== user.userId) {
        throw new ForbiddenException('Agents are not authorized to reassign tasks to other users');
      }
      if (user.role !== 'AGENT' && dto.assignedTo) {
        const assignee = await this.prisma.user.findFirst({
          where: { id: dto.assignedTo, tenantId: user.tenantId, isActive: true },
        });
        if (!assignee) {
          throw new BadRequestException('Assigned user not found in current tenant or is inactive');
        }
        assignedTo = assignee.id;
      }
    }

    return this.prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.assignedTo !== undefined ? { assignedTo } : {}),
        ...(dto.done !== undefined
          ? {
              done: dto.done,
              completedAt: dto.done ? new Date() : null,
            }
          : {}),
      },
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        collectionCase: {
          include: {
            customer: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.prisma.followUpTask.delete({ where: { id } });
  }
}
