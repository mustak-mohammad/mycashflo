import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { CustomerQueryDto } from '../common/dto/query.dto.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsString, IsEmail, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsentState } from '@prisma/client';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Raj Enterprises' })
  @IsString() name: string;

  @ApiProperty({ example: 'raj@rajent.in' })
  @IsEmail() email: string;

  @ApiProperty({ example: '+91 98765 43210' })
  @IsString() phone: string;

  @ApiPropertyOptional() @IsOptional() @IsString() company?: string;
  @ApiPropertyOptional({ example: 'CUST-001' }) @IsOptional() @IsString() customerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gstNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() billingAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  emailConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  whatsappConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  smsConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  voiceConsent?: ConsentState;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() company?: string;
  @ApiPropertyOptional({ example: 'CUST-001' }) @IsOptional() @IsString() customerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gstNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() billingAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional() @IsEnum(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  emailConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  whatsappConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  smsConsent?: ConsentState;

  @ApiPropertyOptional({ enum: ConsentState })
  @IsOptional()
  @IsEnum(ConsentState)
  voiceConsent?: ConsentState;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs?: AuditLogsService,
  ) {}

  private extractCustomerReference(notes?: string | null): string | undefined {
    if (!notes) return undefined;
    const match = notes.match(/\[Ref:\s*([^\]]+)\]/);
    return match ? match[1] : undefined;
  }

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

  async findAll(user: AuthUser, query: CustomerQueryDto) {
    const { tenantId, role, userId } = user;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    let assignedFilter: any = {};
    if (role === 'AGENT') {
      const allowedIds = await this.getAgentCustomerIds(tenantId, userId);
      assignedFilter = { id: { in: allowedIds } };
    }

    const where = {
      tenantId,
      ...assignedFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search } },
              { notes: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const mapped = data.map((c) => ({
      ...c,
      customerReference: this.extractCustomerReference(c.notes),
    }));

    return { data: mapped, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (user.role === 'AGENT') {
      const allowedIds = await this.getAgentCustomerIds(user.tenantId, user.userId);
      if (!allowedIds.includes(customer.id)) {
        throw new ForbiddenException('Access denied: You are not assigned to this customer');
      }
    }

    return {
      ...customer,
      customerReference: this.extractCustomerReference(customer.notes),
    };
  }

  async create(user: AuthUser, dto: CreateCustomerDto) {
    const { customerReference, ...rest } = dto;
    let notes = rest.notes;
    if (customerReference) {
      notes = notes ? `${notes} [Ref: ${customerReference}]` : `[Ref: ${customerReference}]`;
    }

    const now = new Date();
    const customer = await this.prisma.customer.create({
      data: {
        ...rest,
        notes,
        tenantId: user.tenantId,
        ...(dto.emailConsent ? { emailConsentAt: now, emailConsentSource: 'PORTAL_CREATE' } : {}),
        ...(dto.whatsappConsent ? { whatsappConsentAt: now, whatsappConsentSource: 'PORTAL_CREATE' } : {}),
        ...(dto.smsConsent ? { smsConsentAt: now, smsConsentSource: 'PORTAL_CREATE' } : {}),
        ...(dto.voiceConsent ? { voiceConsentAt: now, voiceConsentSource: 'PORTAL_CREATE' } : {}),
      },
    });

    if (this.auditLogs) {
      await this.auditLogs.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'customer.created',
        entityType: 'Customer',
        entityId: customer.id,
        metadata: {
          name: customer.name,
          email: customer.email,
          customerReference,
          emailConsent: customer.emailConsent,
          whatsappConsent: customer.whatsappConsent,
          smsConsent: customer.smsConsent,
          voiceConsent: customer.voiceConsent,
        },
      });
    }

    return {
      ...customer,
      customerReference: customerReference || undefined,
    };
  }

  async update(id: string, user: AuthUser, dto: UpdateCustomerDto) {
    const existing = await this.findOne(id, user); // ensures tenant owns it
    const { customerReference, emailConsent, whatsappConsent, smsConsent, voiceConsent, ...rest } = dto;
    let notes = rest.notes;
    if (customerReference) {
      notes = notes ? `${notes} [Ref: ${customerReference}]` : `[Ref: ${customerReference}]`;
    }

    const now = new Date();
    const dataToUpdate: any = {
      ...rest,
      ...(notes !== undefined ? { notes } : {}),
    };

    const consentChanges: Record<string, { from: any; to: any }> = {};

    if (emailConsent !== undefined && emailConsent !== (existing as any).emailConsent) {
      dataToUpdate.emailConsent = emailConsent;
      dataToUpdate.emailConsentAt = now;
      dataToUpdate.emailConsentSource = 'PORTAL_UPDATE';
      consentChanges.emailConsent = { from: (existing as any).emailConsent, to: emailConsent };
    }

    if (whatsappConsent !== undefined && whatsappConsent !== (existing as any).whatsappConsent) {
      dataToUpdate.whatsappConsent = whatsappConsent;
      dataToUpdate.whatsappConsentAt = now;
      dataToUpdate.whatsappConsentSource = 'PORTAL_UPDATE';
      consentChanges.whatsappConsent = { from: (existing as any).whatsappConsent, to: whatsappConsent };
    }

    if (smsConsent !== undefined && smsConsent !== (existing as any).smsConsent) {
      dataToUpdate.smsConsent = smsConsent;
      dataToUpdate.smsConsentAt = now;
      dataToUpdate.smsConsentSource = 'PORTAL_UPDATE';
      consentChanges.smsConsent = { from: (existing as any).smsConsent, to: smsConsent };
    }

    if (voiceConsent !== undefined && voiceConsent !== (existing as any).voiceConsent) {
      dataToUpdate.voiceConsent = voiceConsent;
      dataToUpdate.voiceConsentAt = now;
      dataToUpdate.voiceConsentSource = 'PORTAL_UPDATE';
      consentChanges.voiceConsent = { from: (existing as any).voiceConsent, to: voiceConsent };
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: dataToUpdate,
    });

    if (this.auditLogs) {
      if (Object.keys(consentChanges).length > 0) {
        await this.auditLogs.log({
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'customer.consent_updated',
          entityType: 'Customer',
          entityId: updated.id,
          metadata: {
            changes: consentChanges,
            previous: {
              emailConsent: (existing as any).emailConsent,
              whatsappConsent: (existing as any).whatsappConsent,
              smsConsent: (existing as any).smsConsent,
              voiceConsent: (existing as any).voiceConsent,
            },
            updated: {
              emailConsent: updated.emailConsent,
              whatsappConsent: updated.whatsappConsent,
              smsConsent: updated.smsConsent,
              voiceConsent: updated.voiceConsent,
            },
          },
        });
      }

      await this.auditLogs.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'customer.updated',
        entityType: 'Customer',
        entityId: updated.id,
        metadata: { changes: Object.keys(dto) },
      });
    }

    return {
      ...updated,
      customerReference: customerReference || this.extractCustomerReference(updated.notes),
    };
  }
}
