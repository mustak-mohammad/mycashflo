import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsEnum, IsString, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CallOutcome } from '@prisma/client';

export class CallQueryDto {
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

  @ApiPropertyOptional({ enum: CallOutcome })
  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;
}

export class CreateCallDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  collectionCaseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  livekitRoom?: string;

  @ApiPropertyOptional({ example: 180 })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ enum: CallOutcome })
  @IsOptional()
  @IsEnum(CallOutcome)
  outcome?: CallOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transcript?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;
}

@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: CallQueryDto) {
    const { tenantId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.callSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          agent: { select: { id: true, name: true, email: true } },
          collectionCase: { select: { id: true, status: true, priority: true } },
        },
      }),
      this.prisma.callSession.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        agent: { select: { id: true, name: true, email: true } },
        collectionCase: true,
      },
    });

    if (!call) throw new NotFoundException('Call session not found');
    return call;
  }

  async create(user: AuthUser, dto: CreateCallDto) {
    return this.prisma.callSession.create({
      data: {
        customerId: dto.customerId,
        collectionCaseId: dto.collectionCaseId,
        userId: user.userId,
        livekitRoom: dto.livekitRoom,
        duration: dto.duration,
        outcome: dto.outcome,
        transcript: dto.transcript,
        summary: dto.summary,
        tenantId: user.tenantId,
        endedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });
  }
}
