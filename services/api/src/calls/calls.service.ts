import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecorderService } from '../voice/recorder.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SipRequestBuilder } from '../integrations/builders/sip-request.builder.js';
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

export class InitiateOutboundCallDto {
  @ApiProperty({ description: 'Target Customer ID' })
  @IsString()
  customerId: string;

  @ApiPropertyOptional({ description: 'Optional phone override' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Associated collection case ID' })
  @IsOptional()
  @IsString()
  collectionCaseId?: string;

  @ApiPropertyOptional({ description: 'Reason for outreach' })
  @IsOptional()
  @IsString()
  reason?: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: RecorderService,
    @Optional() private readonly auditLogs?: AuditLogsService,
    @Optional() private readonly integrations?: IntegrationsService,
  ) {}

  async findAll(user: AuthUser, query: CallQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const agentFilter = role === 'AGENT' ? { userId } : {};

    const where = {
      tenantId,
      ...agentFilter,
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
    const { tenantId, role, userId } = user;
    const agentFilter = role === 'AGENT' ? { userId } : {};

    const where = {
      tenantId,
      ...agentFilter,
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

    if (user.role === 'AGENT' && call.userId && call.userId !== user.userId) {
      throw new ForbiddenException('Access denied: You are not assigned to this call session');
    }

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

    if (user.role === 'AGENT' && call.userId && call.userId !== user.userId) {
      throw new ForbiddenException('Access denied: You are not assigned to this call session');
    }

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
   * Helper to resolve the recordings directory consistently across working directories
   */
  getUploadsDir(tenantId: string): string {
    if (fs.existsSync(path.join(process.cwd(), 'services', 'api', 'uploads'))) {
      return path.join(process.cwd(), 'services', 'api', 'uploads', 'recordings', tenantId);
    }
    return path.join(process.cwd(), 'uploads', 'recordings', tenantId);
  }

  /**
   * Resolve recording file on disk if exists
   */
  async getRecordingFilePath(id: string, user: AuthUser) {
    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { customer: { select: { name: true } } },
    });
    if (!call) throw new NotFoundException('Call session not found');

    if (user.role === 'AGENT' && call.userId && call.userId !== user.userId) {
      throw new ForbiddenException('Access denied: You are not authorized to access this call recording');
    }

    const tenantDir = this.getUploadsDir(user.tenantId);
    if (!fs.existsSync(tenantDir)) return null;

    const files = await fs.promises.readdir(tenantDir);
    const targetFile = files.find((f) => f.startsWith(`${id}.`));
    if (!targetFile) return null;

    const filePath = path.join(tenantDir, targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    const mimeType =
      ext === '.webm'
        ? 'audio/webm'
        : ext === '.ogg'
          ? 'audio/ogg'
          : ext === '.mp3'
            ? 'audio/mpeg'
            : ext === '.wav'
              ? 'audio/wav'
              : 'audio/webm';

    return { filePath, mimeType, call };
  }

  /**
   * Save uploaded audio recording buffer to disk and mark CallSession as AVAILABLE
   */
  async saveRecording(id: string, user: AuthUser, buffer: Buffer, mimeType: string = 'audio/webm') {
    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!call) throw new NotFoundException('Call session not found');

    if (user.role === 'AGENT' && call.userId && call.userId !== user.userId) {
      throw new ForbiddenException('Access denied: You are not authorized to upload recordings for this call session');
    }

    const tenantDir = this.getUploadsDir(user.tenantId);
    await fs.promises.mkdir(tenantDir, { recursive: true });

    let ext = '.webm';
    if (mimeType.includes('ogg')) ext = '.ogg';
    else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = '.mp3';
    else if (mimeType.includes('wav')) ext = '.wav';

    const filePath = path.join(tenantDir, `${id}${ext}`);
    await fs.promises.writeFile(filePath, buffer);

    const streamUrl = `/api/calls/${id}/recording/stream`;
    const downloadUrl = `/api/calls/${id}/recording/download`;

    await this.prisma.callSession.update({
      where: { id },
      data: {
        recordingUrl: streamUrl,
        recordingStatus: 'AVAILABLE',
      },
    });

    return {
      status: 'AVAILABLE' as const,
      url: streamUrl,
      streamUrl,
      downloadUrl,
      size: buffer.length,
      fileSize: buffer.length,
    };
  }

  /**
   * Resolve the recording for a call session. Checks local disk first,
   * then LiveKit egress, and persists the output URL once the recording finishes.
   */
  async resolveRecording(id: string, user: AuthUser) {
    const local = await this.getRecordingFilePath(id, user);
    if (local) {
      const streamUrl = `/api/calls/${id}/recording/stream`;
      const downloadUrl = `/api/calls/${id}/recording/download`;
      if (local.call.recordingStatus !== 'AVAILABLE') {
        await this.prisma.callSession.update({
          where: { id },
          data: { recordingStatus: 'AVAILABLE', recordingUrl: streamUrl },
        });
      }
      return {
        status: 'AVAILABLE' as const,
        url: streamUrl,
        streamUrl,
        downloadUrl,
      };
    }

    const call = await this.prisma.callSession.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, recordingUrl: true, recordingStatus: true, recordingEgressId: true },
    });
    if (!call) throw new NotFoundException('Call session not found');

    if (call.recordingStatus === 'AVAILABLE' && call.recordingUrl) {
      if (call.recordingUrl.includes('/recording/stream')) {
        // Local file does not exist on disk
        return { status: 'NONE' as const };
      }
      return {
        status: 'AVAILABLE' as const,
        url: call.recordingUrl,
        streamUrl: `/api/calls/${id}/recording/stream`,
        downloadUrl: `/api/calls/${id}/recording/download`,
      };
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
      return {
        status: 'AVAILABLE' as const,
        url: result.url,
        streamUrl: `/api/calls/${id}/recording/stream`,
        downloadUrl: `/api/calls/${id}/recording/download`,
      };
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


  async initiateOutboundCall(user: AuthUser, dto: InitiateOutboundCallDto) {
    const { tenantId, userId } = user;

    // 1. Tenant-isolated Customer Verification
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found in tenant');
    }

    // 2. Strict DND / Opt-Out Enforcement
    if (
      (customer.notes &&
        (customer.notes.includes('DND:NO_CONTACT') ||
          customer.notes.includes('NO_CONTACT') ||
          customer.notes.includes('OPT_OUT'))) ||
      (customer as any).preferredChannel === 'NO_CONTACT'
    ) {
      throw new BadRequestException(
        'Outbound call suppressed: Customer has an active Do-Not-Contact (cease-contact) preference',
      );
    }

    // 3. Indian Mobile Number Pre-Validation
    const rawPhone = dto.phone || customer.phone;
    const phoneValidation = SipRequestBuilder.validateIndianMobileNumber(rawPhone);
    if (!phoneValidation.isValid) {
      throw new BadRequestException(phoneValidation.error);
    }
    const recipientPhone = phoneValidation.value!;

    // 4. 60-Second Duplicate Request Guard (Database-Backed & Multi-Process Safe)
    const DUPLICATE_WINDOW_SECONDS = 60;
    const duplicateWindowStart = new Date(Date.now() - DUPLICATE_WINDOW_SECONDS * 1000);
    const existingRecentCall = await this.prisma.callSession.findFirst({
      where: {
        tenantId,
        customerId: customer.id,
        startedAt: { gte: duplicateWindowStart },
      },
    });

    if (existingRecentCall) {
      throw new ConflictException(
        `Duplicate call request suppressed: An outbound call for customer ${customer.id} was already initiated within the last ${DUPLICATE_WINDOW_SECONDS} seconds (Session ID: ${existingRecentCall.id}).`,
      );
    }

    // 5. Tenant Concurrency Cap (Database-Backed)
    const DEFAULT_MAX_CONCURRENCY = 5;
    const maxConcurrency =
      Number(process.env.TENANT_MAX_CONCURRENT_CALLS) || DEFAULT_MAX_CONCURRENCY;

    const activeCallsCount = await this.prisma.callSession.count({
      where: {
        tenantId,
        endedAt: null,
        startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // active in last 30m
      },
    });

    if (activeCallsCount >= maxConcurrency) {
      throw new BadRequestException(
        `Tenant outbound call concurrency limit reached (${activeCallsCount}/${maxConcurrency} active calls). Please wait for ongoing calls to complete.`,
      );
    }

    // 6. Tenant Daily Usage Cap (Database-Backed)
    const DEFAULT_MAX_DAILY = 100;
    const maxDaily = Number(process.env.TENANT_MAX_DAILY_CALLS) || DEFAULT_MAX_DAILY;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dailyCallsCount = await this.prisma.callSession.count({
      where: {
        tenantId,
        startedAt: { gte: startOfToday },
      },
    });

    if (dailyCallsCount >= maxDaily) {
      throw new BadRequestException(
        `Tenant daily outbound call limit reached (${dailyCallsCount}/${maxDaily} calls today). Limit resets at midnight.`,
      );
    }

    // 7. Safe Dispatch Execution (Dry-Run / Simulation Adapter)
    const config = this.integrations ? await this.integrations.getRawConfig(tenantId, 'SIP_TELEPHONY') : {};

    const dispatchResult = this.integrations?.telephony
      ? await this.integrations.telephony.initiateCall(
          {
            to: recipientPhone,
            customerId: customer.id,
            customerName: customer.name,
            callReason: dto.reason || 'Payment Follow-up',
            collectionCaseId: dto.collectionCaseId,
          },
          config,
        )
      : {
          callSid: `CA_sim_${Date.now()}`,
          provider: 'SIP_GATEWAY',
          status: 'SIMULATED' as const,
          isSimulated: true,
          notes: 'Outbound telephony is disabled by policy. Simulation session initiated.',
        };

    const session = await this.prisma.callSession.create({
      data: {
        customerId: customer.id,
        userId,
        collectionCaseId: dto.collectionCaseId,
        livekitRoom: `sip-${dispatchResult.callSid}`,
        stage: 'GREETING_AND_VERIFICATION',
        tenantId,
        metadata: {
          callSid: dispatchResult.callSid,
          provider: dispatchResult.provider,
          isSimulated: dispatchResult.isSimulated,
          recipientPhone,
          notes: dispatchResult.notes,
          reason: dto.reason,
        },
      },
    });

    if (this.auditLogs) {
      await this.auditLogs.log({
        tenantId,
        userId,
        action: 'telephony.outbound_initiated',
        entityType: 'CallSession',
        entityId: session.id,
        metadata: {
          callSid: dispatchResult.callSid,
          recipientPhone,
          isSimulated: dispatchResult.isSimulated,
          status: dispatchResult.status,
        },
      });
    }

    return {
      callSid: dispatchResult.callSid,
      provider: dispatchResult.provider,
      status: dispatchResult.status,
      isSimulated: dispatchResult.isSimulated,
      notes: dispatchResult.notes,
      sessionId: session.id,
    };
  }

  async handleTelephonyWebhook(provider: string, payload: any) {
    const callback = this.integrations?.telephony
      ? this.integrations.telephony.parseStatusCallback(payload)
      : { callSid: payload?.CallSid || payload?.callSid || `CA_${Date.now()}`, status: 'completed', duration: 0, timestamp: new Date() };

    const sessions = await this.prisma.callSession.findMany({
      where: {
        livekitRoom: `sip-${callback.callSid}`,
      },
      take: 1,
    });

    if (sessions.length > 0) {
      const session = sessions[0];
      await this.prisma.callSession.update({
        where: { id: session.id },
        data: {
          duration: callback.duration || session.duration,
          endedAt: callback.status === 'completed' ? new Date() : undefined,
        },
      });
    }

    return { received: true, callSid: callback.callSid, status: callback.status };
  }
}

