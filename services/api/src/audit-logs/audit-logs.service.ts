import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AuditLogQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by action name, e.g. ai.tool_executed' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by entity type, e.g. Customer, Invoice' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ description: 'Filter by entity ID' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;
}

export interface CreateAuditLogParams {
  tenantId: string;
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: any;
  ipAddress?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: CreateAuditLogParams) {
    try {
      let resolvedUserId = params.userId;
      const userExists = await this.prisma.user.findFirst({
        where: { id: params.userId, tenantId: params.tenantId },
        select: { id: true },
      });

      if (!userExists) {
        const tenantUser = await this.prisma.user.findFirst({
          where: { tenantId: params.tenantId },
          orderBy: { role: 'asc' },
          select: { id: true },
        });
        if (tenantUser) {
          resolvedUserId = tenantUser.id;
        } else {
          return null;
        }
      }

      return await this.prisma.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId: resolvedUserId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          metadata: {
            ...(params.metadata ?? {}),
            ...(resolvedUserId !== params.userId ? { actor: params.userId } : {}),
          },
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      console.error('[AuditLogsService] Failed to create audit log:', err);
      return null;
    }
  }

  async findAll(user: AuthUser, query: AuditLogQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
