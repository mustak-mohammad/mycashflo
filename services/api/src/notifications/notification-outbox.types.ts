import {
  NotificationChannel,
  OutboxJobStatus,
  OutboxJobType,
  ReminderStage,
} from '@prisma/client';

export { NotificationChannel, OutboxJobStatus, OutboxJobType, ReminderStage };

export interface EnqueueJobParams {
  tenantId: string;
  customerId: string;
  jobType: OutboxJobType;
  channel: NotificationChannel;
  template: string;
  idempotencyKey: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  stage?: ReminderStage | null;
  scheduledFor?: Date;
  payload?: Record<string, any> | null;
  initialStatus?: OutboxJobStatus;
  suppressionReason?: string | null;
}

export interface EnqueueJobResult {
  job: any;
  isDuplicate: boolean;
  created: boolean;
}

export interface EnqueueReminderParams {
  tenantId: string;
  customerId: string;
  invoiceId: string;
  channel: NotificationChannel;
  template: string;
  stage: ReminderStage;
  scheduledFor?: Date;
  payload?: Record<string, any>;
  idempotencyKey?: string;
  validateConsent?: boolean;
}

export interface EnqueuePaymentReceiptParams {
  tenantId: string;
  customerId: string;
  paymentId: string;
  invoiceId?: string | null;
  channel: NotificationChannel;
  template?: string;
  payload?: Record<string, any>;
  idempotencyKey?: string;
  validateConsent?: boolean;
}

export interface SuppressionResult {
  count: number;
  reason: string;
}
