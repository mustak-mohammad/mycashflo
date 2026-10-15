import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecorderService } from '../voice/recorder.service.js';
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

  @ApiPropertyOptional({ description: 'LiveKit egress job id for the call recording' })
  @IsOptional()
  @IsString()
  recordingEgressId?: string;

  @ApiPropertyOptional({ description: 'Public URL of the call recording, if already available' })
  @IsOptional()
  @IsString()
  recordingUrl?: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: RecorderService,
  ) {}

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

  async exportCsv(user: AuthUser, query: CallQueryDto): Promise<string> {
    const { tenantId } = user;

    const where = {
      tenantId,
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const calls = await this.prisma.callSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: {
        customer: { select: { name: true, phone: true } },
        agent: { select: { name: true } },
      },
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
    rows.push(['Customer', 'Phone', 'Duration (s)', 'Date & Time', 'Outcome', 'Agent', 'Summary'].join(','));

    for (const call of calls) {
      rows.push(
        [
          call.customer?.name ?? '',
          call.customer?.phone ?? '',
          call.duration ?? '',
          call.startedAt ? call.startedAt.toISOString() : '',
          call.outcome ?? '',
          call.agent?.name ?? 'Chotu AI',
          call.summary ?? '',
        ]
          .map(escapeCell)
          .join(','),
      );
    }

    return rows.join('\r\n');
  }

  async getCallForReport(id: string, user: AuthUser) {
    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        agent: { select: { name: true, email: true } },
      },
    });
    if (!call) throw new NotFoundException('Call session not found');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    return { call, tenantName: tenant?.name ?? 'myCashflo' };
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
        recordingEgressId: dto.recordingEgressId,
        recordingUrl: dto.recordingUrl,
        recordingStatus: dto.recordingUrl
          ? 'AVAILABLE'
          : dto.recordingEgressId
            ? 'PROCESSING'
            : undefined,
        tenantId: user.tenantId,
        endedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Resolve the recording for a call session. Lazily polls LiveKit egress and
   * persists the output URL once the recording finishes.
   */
  async resolveRecording(id: string, user: AuthUser) {
    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, recordingUrl: true, recordingStatus: true, recordingEgressId: true },
    });
    if (!call) throw new NotFoundException('Call session not found');

    if (call.recordingStatus === 'AVAILABLE' && call.recordingUrl) {
      return { status: 'AVAILABLE' as const, url: call.recordingUrl };
    }
    if (!call.recordingEgressId) {
      return { status: 'NONE' as const };
    }

    const result = await this.recorder.getRecording(call.recordingEgressId);

    if (result.status === 'COMPLETE' && result.url) {
      await this.prisma.callSession.update({
        where: { id: call.id },
        data: { recordingUrl: result.url, recordingStatus: 'AVAILABLE' },
      });
      return { status: 'AVAILABLE' as const, url: result.url };
    }
    if (result.status === 'FAILED') {
      await this.prisma.callSession.update({
        where: { id: call.id },
        data: { recordingStatus: 'FAILED' },
      });
      return { status: 'FAILED' as const };
    }
    return { status: 'PROCESSING' as const };
  }
}
