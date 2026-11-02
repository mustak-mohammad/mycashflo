import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

    return {
      data,
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

    return task;
  }

  async create(user: AuthUser, dto: CreateFollowUpDto) {
    const assignedTo = user.role === 'AGENT' ? user.userId : (dto.assignedTo ?? user.userId);

    return this.prisma.followUpTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: new Date(dto.dueDate),
        priority: dto.priority ?? CasePriority.MEDIUM,
        collectionCaseId: dto.collectionCaseId,
        customerId: dto.customerId,
        assignedTo,
        tenantId: user.tenantId,
      },
      include: {
        assignedAgent: { select: { id: true, name: true } },
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

    if (user.role === 'AGENT' && dto.assignedTo && dto.assignedTo !== user.userId) {
      throw new ForbiddenException('Agents are not authorized to reassign tasks to other users');
    }

    return this.prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.assignedTo !== undefined ? { assignedTo: dto.assignedTo } : {}),
        ...(dto.done !== undefined
          ? {
              done: dto.done,
              completedAt: dto.done ? new Date() : null,
            }
          : {}),
      },
      include: {
        assignedAgent: { select: { id: true, name: true } },
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
