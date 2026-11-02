import { NotifStatus } from '@prisma/client';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type ReminderStage =
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE_STAGE_1'
  | 'OVERDUE_STAGE_2'
  | 'OVERDUE_STAGE_3';

export type ReminderChannelPreference = 'EMAIL' | 'WHATSAPP' | 'BOTH' | 'DISABLED';

export interface QuietHoursConfig {
  startHour: number; // 0 - 23 (e.g. 19 for 7 PM)
  endHour: number; // 0 - 23 (e.g. 9 for 9 AM)
}

export interface TenantReminderSettings {
  enabled: boolean;
  dryRun: boolean;
  channels: ('EMAIL' | 'WHATSAPP')[];
  channelPreference: ReminderChannelPreference;
  scheduleCron: string;
  timezone: string;
  quietHours: QuietHoursConfig;
  maxDailyPerCustomer: number;
  minDaysBetweenReminders: number;
  testRecipientEmail?: string;
  testRecipientPhone?: string;
  companyContactNumber?: string;
}

export class UpdateReminderSettingsDto {
  @ApiPropertyOptional({ description: 'Enable or disable automated reminders for this tenant' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Dry-run mode: evaluates and simulates reminders without sending live messages',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    enum: ['EMAIL', 'WHATSAPP', 'BOTH', 'DISABLED'],
    description: 'Channel preference: EMAIL, WHATSAPP, BOTH, or DISABLED',
  })
  @IsOptional()
  @IsString()
  channelPreference?: ReminderChannelPreference;

  @ApiPropertyOptional({ description: 'Tenant timezone identifier (e.g. Asia/Kolkata, UTC)' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Quiet hours start hour (0 - 23, e.g. 19)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  quietHoursStart?: number;

  @ApiPropertyOptional({ description: 'Quiet hours end hour (0 - 23, e.g. 9)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  quietHoursEnd?: number;

  @ApiPropertyOptional({ description: 'Maximum reminders to send to a customer per day (across all invoices)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxDailyPerCustomer?: number;

  @ApiPropertyOptional({ description: 'Minimum days to wait between reminders for the same invoice' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minDaysBetweenReminders?: number;

  @ApiPropertyOptional({ description: 'Explicit test recipient email for safe testing' })
  @IsOptional()
  @IsString()
  testRecipientEmail?: string;

  @ApiPropertyOptional({ description: 'Explicit test recipient phone for safe testing' })
  @IsOptional()
  @IsString()
  testRecipientPhone?: string;

  @ApiPropertyOptional({ description: 'Tenant company contact phone number for customer reminder follow-up' })
  @IsOptional()
  @IsString()
  companyContactNumber?: string;
}

export class SendTestReminderDto {
  @ApiProperty({ description: 'Invoice ID to test reminder for' })
  @IsString()
  invoiceId: string;

  @ApiProperty({ enum: ['EMAIL', 'WHATSAPP'], description: 'Channel to test' })
  @IsString()
  channel: 'EMAIL' | 'WHATSAPP';

  @ApiPropertyOptional({ description: 'Explicit test recipient address override (must match test configuration)' })
  @IsOptional()
  @IsString()
  recipient?: string;
}

export class TriggerRunDto {
  @ApiPropertyOptional({ description: 'Force run in dry-run mode regardless of settings' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export interface ReminderEvaluationItem {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  outstandingAmount: number;
  dueDate: string;
  daysOverdue: number;
  stage: ReminderStage;
  channel: 'EMAIL' | 'WHATSAPP' | 'BOTH';
  idempotencyKey: string;
  isEligible: boolean;
  suppressionReason?: string;
  messagePreview?: {
    subject?: string;
    message: string;
    template: string;
  };
  dispatchedNotificationId?: string;
  dispatchStatus?: NotifStatus | 'SIMULATED' | 'SUPPRESSED';
}

export interface RemindersRunSummary {
  tenantId: string;
  evaluatedCount: number;
  eligibleCount: number;
  dispatchedCount: number;
  suppressedCount: number;
  failedCount: number;
  isDryRun: boolean;
  globalEnabled: boolean;
  timestamp: string;
  items: ReminderEvaluationItem[];
  totalTenantInvoices?: number;
  settledInvoicesCount?: number;
}

export interface ReminderStatsSummary {
  totalEvaluated: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  suppressedCount: number;
  pendingCount: number;
  lastRunAt?: string;
  isGloballyEnabled: boolean;
  isTenantEnabled: boolean;
  isDryRun: boolean;
}
