import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PromptQueryDto {
  @ApiPropertyOptional({ description: 'Filter by category: COLLECTIONS, OVERDUE, DISPUTE, COURTESY, LEGAL' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Search name, description, or prompt text' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter active status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true || value === 1 || value === '1')
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePromptDto {
  @ApiProperty({ example: 'Standard Polite AR Collection' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Courteous multi-stage reminder for 1-30 days overdue accounts' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example:
      'You are Chotu, an empathetic yet persistent collection assistant for {{companyName}} speaking with {{customerName}} regarding pending balance of {{outstandingAmount}}...',
  })
  @IsString()
  promptText: string;

  @ApiPropertyOptional({ example: 'COLLECTIONS', default: 'COLLECTIONS' })
  @IsOptional()
  @IsString()
  category?: string = 'COLLECTIONS';

  @ApiPropertyOptional({ example: 'en-IN', default: 'en-IN' })
  @IsOptional()
  @IsString()
  language?: string = 'en-IN';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdatePromptDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  promptText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Safe variable substitution for template placeholders:
   * {{customerName}}, {{outstandingAmount}}, {{invoiceNumber}}, {{dueDate}}, {{companyName}}
   */
  substituteVariables(promptText: string, vars: Record<string, string | number | undefined | null>): string {
    let result = promptText;
    for (const [key, val] of Object.entries(vars)) {
      const safeVal = val !== undefined && val !== null ? String(val) : '—';
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, safeVal);
    }
    return result;
  }

  async findAll(user: AuthUser, query?: PromptQueryDto) {
    const { tenantId } = user;

    // Check if tenant has any prompts, if not seed standard default prompts
    const count = await this.prisma.voicePrompt.count({ where: { tenantId } });
    if (count === 0) {
      await this.seedDefaultPrompts(tenantId, user.userId);
    }

    const where: any = {
      tenantId,
      ...(query?.category ? { category: query.category } : {}),
      ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query?.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { promptText: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.voicePrompt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const prompt = await this.prisma.voicePrompt.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (!prompt) {
      throw new NotFoundException('Voice prompt not found');
    }
    return prompt;
  }

  async create(user: AuthUser, dto: CreatePromptDto) {
    const { tenantId, userId } = user;

    const prompt = await this.prisma.voicePrompt.create({
      data: {
        name: dto.name,
        description: dto.description,
        promptText: dto.promptText,
        category: dto.category ?? 'COLLECTIONS',
        language: dto.language ?? 'en-IN',
        isActive: dto.isActive ?? true,
        tenantId,
        createdBy: userId,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'prompt.created',
      entityType: 'VoicePrompt',
      entityId: prompt.id,
      metadata: { name: prompt.name, category: prompt.category },
    });

    return prompt;
  }

  async update(id: string, user: AuthUser, dto: UpdatePromptDto) {
    const { tenantId, userId } = user;
    const existing = await this.findOne(id, user);

    const updated = await this.prisma.voicePrompt.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.promptText !== undefined ? { promptText: dto.promptText } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'prompt.updated',
      entityType: 'VoicePrompt',
      entityId: updated.id,
      metadata: { name: updated.name },
    });

    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const { tenantId, userId } = user;
    const existing = await this.findOne(id, user);

    await this.prisma.voicePrompt.delete({
      where: { id: existing.id },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'prompt.deleted',
      entityType: 'VoicePrompt',
      entityId: id,
      metadata: { name: existing.name },
    });

    return { success: true, message: `Prompt '${existing.name}' deleted` };
  }

  /**
   * Simulates variable interpolation for a prompt template.
   */
  async preview(template: string) {
    const sampleData = {
      customerName: 'Raj Enterprises',
      outstandingAmount: '₹1,45,000',
      invoiceNumber: 'INV-2026-088',
      dueDate: '2026-10-25',
      companyName: 'myCashflo Demo',
    };

    const preview = this.substituteVariables(template, sampleData);
    const variables = ['customerName', 'outstandingAmount', 'invoiceNumber', 'dueDate', 'companyName'];
    const missingVariables = variables.filter((v) => !template.includes(`{{${v}}}`));

    return {
      preview,
      missingVariables,
    };
  }

  private async seedDefaultPrompts(tenantId: string, userId: string) {
    const defaults = [
      {
        name: 'Standard Polite AR Collection (10-Stage)',
        description: 'Comprehensive 10-stage empathetic accounts receivable collection flow',
        category: 'COLLECTIONS',
        language: 'en-IN',
        promptText: `You are Chotu, an empathetic, courteous, and persistent collection AI assistant representing {{companyName}}.
Your objective is to connect with the finance representative at {{customerName}}, verify their invoice balance of {{outstandingAmount}}, negotiate payment commitments, identify reasons for delays, confirm preferred payment channels (UPI, NEFT, NetBanking), and confirm a definitive Promise-to-Pay.

Rules:
1. Always maintain a respectful, professional tone. Never threaten or use aggressive language.
2. If customer requests a callback, schedule it politely.
3. If customer disputes the invoice, record the dispute reason and offer immediate reconciliation.
4. Confirm payment commitment details before ending call.`,
      },
      {
        name: 'Urgent Overdue Escalation (30+ Days)',
        description: 'Firm yet professional escalation for critically aged accounts',
        category: 'OVERDUE',
        language: 'en-IN',
        promptText: `You are Chotu, senior credit recovery specialist at {{companyName}} speaking with {{customerName}}.
Invoice {{invoiceNumber}} with pending balance of {{outstandingAmount}} was due on {{dueDate}} and is critically overdue.
Prioritize securing an immediate RTGS or UPI transfer, or a split payment commitment within 48 hours to avoid credit line hold.`,
      },
      {
        name: 'Friendly Courtesy Reminder (Upcoming Due Date)',
        description: 'Warm, low-friction reminder for upcoming or recently issued invoices',
        category: 'COURTESY',
        language: 'en-IN',
        promptText: `You are Chotu, client relations representative for {{companyName}}.
This is a courtesy check-in with {{customerName}} regarding invoice {{invoiceNumber}} in the amount of {{outstandingAmount}}.
Inquire if they have received the invoice statement, if all items are approved, and if remittance is scheduled.`,
      },
      {
        name: 'Dispute Resolution & Reconciliation',
        description: 'Specialized prompt for customers reviewing discrepancies or credit notes',
        category: 'DISPUTE',
        language: 'en-IN',
        promptText: `You are Chotu, accounts reconciliation specialist for {{companyName}}.
Listen carefully to {{customerName}} regarding their questions on invoice {{invoiceNumber}}.
Capture specific item discrepancies, quantity mismatches, or missing credit notes, and log an official dispute for same-day management review.`,
      },
    ];

    for (const d of defaults) {
      await this.prisma.voicePrompt.create({
        data: {
          ...d,
          tenantId,
          createdBy: userId,
        },
      });
    }
  }
}
