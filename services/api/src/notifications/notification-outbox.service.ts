import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  NotificationChannel,
  OutboxJobStatus,
  OutboxJobType,
  ReminderStage,
  EnqueueJobParams,
  EnqueueJobResult,
  EnqueueReminderParams,
  EnqueuePaymentReceiptParams,
  SuppressionResult,
} from './notification-outbox.types.js';
import { evaluateCustomerConsent } from '../common/consent-policy.js';

@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueues an outbox job strictly inside an existing Prisma transaction.
   *
   * Invariants:
   * 1. Never creates an independent transaction internally.
   * 2. Validates tenant, customer, invoice, payment, and channel relationships.
   * 3. Guarantees deterministic idempotency: if a job with (tenantId, idempotencyKey)
   *    already exists, returns the existing job without mutating completed/dispatched jobs.
   * 4. Enforces business check constraints (chk_outbox_job_type_refs) in code before insert.
   */
  async enqueueJobTx(tx: any, params: EnqueueJobParams): Promise<EnqueueJobResult> {
    this.assertTransactionClient(tx);

    const {
      tenantId,
      customerId,
      jobType,
      channel,
      template,
      idempotencyKey,
      invoiceId,
      paymentId,
      stage,
      scheduledFor,
      payload,
      initialStatus,
      suppressionReason,
    } = params;

    // 1. Mandatory parameter validation
    if (!tenantId || typeof tenantId !== 'string') {
      throw new BadRequestException('tenantId is required');
    }
    if (!customerId || typeof customerId !== 'string') {
      throw new BadRequestException('customerId is required');
    }
    if (!jobType) {
      throw new BadRequestException('jobType is required');
    }
    if (!channel) {
      throw new BadRequestException('channel is required');
    }
    if (!template || typeof template !== 'string') {
      throw new BadRequestException('template is required');
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new BadRequestException('idempotencyKey is required');
    }

    // 2. Business check constraint invariants (matching chk_outbox_job_type_refs)
    if (jobType === OutboxJobType.REMINDER) {
      if (!invoiceId) {
        throw new BadRequestException('invoiceId is required for REMINDER jobs');
      }
      if (paymentId) {
        throw new BadRequestException('paymentId must be null for REMINDER jobs');
      }
      if (!stage) {
        throw new BadRequestException('stage is required for REMINDER jobs');
      }
    } else if (jobType === OutboxJobType.PAYMENT_RECEIPT) {
      if (!paymentId) {
        throw new BadRequestException('paymentId is required for PAYMENT_RECEIPT jobs');
      }
      if (stage) {
        throw new BadRequestException('stage must be null for PAYMENT_RECEIPT jobs');
      }
    }

    // 3. Multi-tenant entity relationship validation inside transaction
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, status: true },
    });
    if (!customer) {
      throw new BadRequestException(
        `Customer ${customerId} does not exist in tenant ${tenantId}`,
      );
    }

    if (invoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { id: true, customerId: true },
      });
      if (!invoice) {
        throw new BadRequestException(
          `Invoice ${invoiceId} does not exist in tenant ${tenantId}`,
        );
      }
      if (invoice.customerId !== customerId) {
        throw new BadRequestException(
          `Invoice ${invoiceId} belongs to customer ${invoice.customerId}, but Outbox specifies customer ${customerId}`,
        );
      }
    }

    if (paymentId) {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, tenantId },
        select: { id: true, customerId: true, invoiceId: true },
      });
      if (!payment) {
        throw new BadRequestException(
          `Payment ${paymentId} does not exist in tenant ${tenantId}`,
        );
      }
      if (payment.customerId !== customerId) {
        throw new BadRequestException(
          `Payment ${paymentId} belongs to customer ${payment.customerId}, but Outbox specifies customer ${customerId}`,
        );
      }
      if (invoiceId && payment.invoiceId !== invoiceId) {
        throw new BadRequestException(
          `Payment ${paymentId} is associated with invoice ${payment.invoiceId}, but Outbox specifies invoice ${invoiceId}`,
        );
      }
    }

    // 4. Idempotency Check: Look for existing job inside transaction
    const existingJob = await tx.notificationOutbox.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey },
      },
    });

    if (existingJob) {
      this.logger.debug(
        `Deterministic idempotency hit for key ${idempotencyKey} (jobId: ${existingJob.id}, status: ${existingJob.status})`,
      );
      return {
        job: existingJob,
        isDuplicate: true,
        created: false,
      };
    }

    // 5. Create new Outbox row inside transaction
    const status = initialStatus ?? OutboxJobStatus.PENDING;
    const lastError = suppressionReason ? `SUPPRESSED: ${suppressionReason}` : null;

    try {
      const newJob = await tx.notificationOutbox.create({
        data: {
          tenantId,
          customerId,
          invoiceId: invoiceId ?? null,
          paymentId: paymentId ?? null,
          jobType,
          channel,
          template,
          stage: stage ?? null,
          idempotencyKey,
          status,
          scheduledFor: scheduledFor ?? new Date(),
          payload: payload ? (payload as any) : undefined,
          lastError,
          completedAt: status === OutboxJobStatus.SUPPRESSED ? new Date() : null,
        },
      });

      return {
        job: newJob,
        isDuplicate: false,
        created: true,
      };
    } catch (createErr: any) {
      // Handle concurrent race where another concurrent transaction committed the same key
      if (
        createErr?.code === 'P2002' ||
        createErr?.message?.includes('Unique constraint failed')
      ) {
        const racedJob = await tx.notificationOutbox.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        });
        if (racedJob) {
          return {
            job: racedJob,
            isDuplicate: true,
            created: false,
          };
        }
      }
      throw createErr;
    }
  }

  /**
   * Enqueues an automated or manual reminder job transactionally.
   *
   * Features:
   * - Deterministic channel-specific idempotency key: rem:{tenantId}:{invoiceId}:{stage}:{channel}
   * - Evaluates channel consent independently (EMAIL vs WHATSAPP).
   * - If consent is missing, unknown, or customer is inactive, safely enqueues the job as SUPPRESSED.
   */
  async enqueueReminderTx(
    tx: any,
    params: EnqueueReminderParams,
  ): Promise<EnqueueJobResult> {
    this.assertTransactionClient(tx);

    const {
      tenantId,
      customerId,
      invoiceId,
      channel,
      template,
      stage,
      scheduledFor,
      payload,
      idempotencyKey,
      validateConsent = true,
    } = params;

    // Generate stable channel-specific idempotency key if not explicitly provided
    const stableKey =
      idempotencyKey || `rem:${tenantId}:${invoiceId}:${stage}:${channel}`;

    let initialStatus: OutboxJobStatus = OutboxJobStatus.PENDING;
    let suppressionReason: string | null = null;

    if (validateConsent) {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
        select: {
          id: true,
          status: true,
          emailConsent: true,
          whatsappConsent: true,
          smsConsent: true,
          voiceConsent: true,
          notes: true,
          email: true,
          phone: true,
        },
      });

      if (!customer) {
        throw new BadRequestException(
          `Customer ${customerId} does not exist in tenant ${tenantId}`,
        );
      }

      // 1. Customer status guard
      if (customer.status !== 'ACTIVE') {
        initialStatus = OutboxJobStatus.SUPPRESSED;
        suppressionReason = `Customer status is ${customer.status || 'INACTIVE'}`;
      } else {
        // 2. Centralized independent consent evaluation
        const consentEval = evaluateCustomerConsent(customer, channel);
        if (!consentEval.allowed) {
          initialStatus = OutboxJobStatus.SUPPRESSED;
          suppressionReason = consentEval.reason || `Consent not granted for ${channel}`;
        } else {
          // 3. Channel destination validity check
          if (channel === NotificationChannel.EMAIL) {
            if (!customer.email || !customer.email.includes('@')) {
              initialStatus = OutboxJobStatus.SUPPRESSED;
              suppressionReason = 'Customer has missing or invalid email address';
            }
          } else if (channel === NotificationChannel.WHATSAPP) {
            const cleanPhone = (customer.phone || '').replace(/\D/g, '');
            if (!cleanPhone || cleanPhone.length < 10) {
              initialStatus = OutboxJobStatus.SUPPRESSED;
              suppressionReason = 'Customer has missing or invalid phone number for WhatsApp';
            }
          }
        }
      }
    }

    return this.enqueueJobTx(tx, {
      tenantId,
      customerId,
      invoiceId,
      paymentId: null,
      jobType: OutboxJobType.REMINDER,
      channel,
      template,
      stage,
      idempotencyKey: stableKey,
      scheduledFor,
      payload,
      initialStatus,
      suppressionReason,
    });
  }

  /**
   * Enqueues a payment receipt job transactionally.
   *
   * Features:
   * - Callable from within any payment settlement transaction.
   * - Deterministic payment-based idempotency key: receipt:{tenantId}:{paymentId}:{channel}
   * - Prevents duplicate receipts for repeated settlement events.
   * - Associates paymentId and invoiceId correctly without stage.
   */
  async enqueuePaymentReceiptTx(
    tx: any,
    params: EnqueuePaymentReceiptParams,
  ): Promise<EnqueueJobResult> {
    this.assertTransactionClient(tx);

    const {
      tenantId,
      customerId,
      paymentId,
      invoiceId,
      channel,
      template = 'payment_receipt_default',
      payload,
      idempotencyKey,
      validateConsent = true,
    } = params;

    const payment = await tx.payment.findFirst({
      where: { id: paymentId, tenantId },
      select: {
        id: true,
        customerId: true,
        invoiceId: true,
        amount: true,
        currency: true,
        status: true,
        paidAt: true,
      },
    });

    if (!payment) {
      throw new BadRequestException(
        `Payment ${paymentId} does not exist in tenant ${tenantId}`,
      );
    }

    if (payment.customerId !== customerId) {
      throw new BadRequestException(
        `Payment ${paymentId} belongs to customer ${payment.customerId}, but Outbox specifies customer ${customerId}`,
      );
    }

    const resolvedInvoiceId = invoiceId ?? payment.invoiceId;
    if (invoiceId && payment.invoiceId !== invoiceId) {
      throw new BadRequestException(
        `Payment ${paymentId} is associated with invoice ${payment.invoiceId}, but Outbox specifies invoice ${invoiceId}`,
      );
    }

    // Stable idempotency key tied to payment and channel
    const stableKey =
      idempotencyKey || `receipt:${tenantId}:${paymentId}:${channel}`;

    let initialStatus: OutboxJobStatus = OutboxJobStatus.PENDING;
    let suppressionReason: string | null = null;

    if (validateConsent) {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
        select: {
          id: true,
          status: true,
          emailConsent: true,
          whatsappConsent: true,
          smsConsent: true,
          notes: true,
          email: true,
          phone: true,
        },
      });

      if (!customer) {
        throw new BadRequestException(
          `Customer ${customerId} does not exist in tenant ${tenantId}`,
        );
      }

      if (customer.status !== 'ACTIVE') {
        initialStatus = OutboxJobStatus.SUPPRESSED;
        suppressionReason = `Customer status is ${customer.status || 'INACTIVE'}`;
      } else {
        const consentEval = evaluateCustomerConsent(customer, channel);
        if (!consentEval.allowed) {
          initialStatus = OutboxJobStatus.SUPPRESSED;
          suppressionReason = consentEval.reason || `Consent not granted for ${channel}`;
        }
      }
    }

    const defaultPayload = {
      paymentId: payment.id,
      invoiceId: resolvedInvoiceId,
      amount: Number(payment.amount),
      currency: payment.currency,
      paidAt: payment.paidAt?.toISOString() ?? new Date().toISOString(),
      ...payload,
    };

    return this.enqueueJobTx(tx, {
      tenantId,
      customerId,
      invoiceId: resolvedInvoiceId,
      paymentId,
      jobType: OutboxJobType.PAYMENT_RECEIPT,
      channel,
      template,
      stage: null,
      idempotencyKey: stableKey,
      payload: defaultPayload,
      initialStatus,
      suppressionReason,
    });
  }

  /**
   * Transactionally suppresses all pending reminder jobs for a settled or cancelled invoice.
   *
   * Safety Constraints:
   * - Suppresses PENDING, CLAIMED, and RETRY_WAIT jobs only.
   * - NEVER modifies jobs in DISPATCHING status (requires out-of-band reconciliation).
   * - NEVER modifies UNCERTAIN jobs (requires provider inquiry).
   * - Leaves already terminal jobs (COMPLETED, FAILED, SUPPRESSED, DEAD_LETTER) untouched.
   */
  async suppressPendingInvoiceRemindersTx(
    tx: any,
    tenantId: string,
    invoiceId: string,
    reason = 'INVOICE_SETTLED',
  ): Promise<SuppressionResult> {
    this.assertTransactionClient(tx);

    const result = await tx.notificationOutbox.updateMany({
      where: {
        tenantId,
        invoiceId,
        jobType: OutboxJobType.REMINDER,
        status: {
          in: [
            OutboxJobStatus.PENDING,
            OutboxJobStatus.CLAIMED,
            OutboxJobStatus.RETRY_WAIT,
          ],
        },
      },
      data: {
        status: OutboxJobStatus.SUPPRESSED,
        lastError: `SUPPRESSED: ${reason}`,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Suppressed ${result.count} pending reminder jobs for invoice ${invoiceId} in tenant ${tenantId} (${reason})`,
    );

    return {
      count: result.count,
      reason,
    };
  }

  /**
   * Transactionally suppresses all pending jobs for a customer whose consent was withdrawn
   * or whose status became INACTIVE.
   */
  async suppressPendingCustomerJobsTx(
    tx: any,
    tenantId: string,
    customerId: string,
    reason = 'CUSTOMER_CONSENT_WITHDRAWN',
    channel?: NotificationChannel,
  ): Promise<SuppressionResult> {
    this.assertTransactionClient(tx);

    const result = await tx.notificationOutbox.updateMany({
      where: {
        tenantId,
        customerId,
        ...(channel ? { channel } : {}),
        status: {
          in: [
            OutboxJobStatus.PENDING,
            OutboxJobStatus.CLAIMED,
            OutboxJobStatus.RETRY_WAIT,
          ],
        },
      },
      data: {
        status: OutboxJobStatus.SUPPRESSED,
        lastError: `SUPPRESSED: ${reason}`,
        completedAt: new Date(),
      },
    });

    return {
      count: result.count,
      reason,
    };
  }

  /**
   * Transactionally cancels an individual pending outbox job.
   * Fails if the job is actively DISPATCHING.
   */
  async cancelPendingJobByIdTx(
    tx: any,
    tenantId: string,
    jobId: string,
    reason = 'MANUAL_CANCELLATION',
  ): Promise<{ job: any; cancelled: boolean; message?: string }> {
    this.assertTransactionClient(tx);

    const job = await tx.notificationOutbox.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) {
      throw new NotFoundException(`Outbox job ${jobId} not found in tenant ${tenantId}`);
    }

    if (job.status === OutboxJobStatus.DISPATCHING) {
      throw new BadRequestException(
        `Cannot cancel job ${jobId}: job is currently in DISPATCHING status`,
      );
    }

    if (
      job.status === OutboxJobStatus.COMPLETED ||
      job.status === OutboxJobStatus.SUPPRESSED ||
      job.status === OutboxJobStatus.FAILED ||
      job.status === OutboxJobStatus.DEAD_LETTER
    ) {
      return {
        job,
        cancelled: false,
        message: `Job is already in terminal status ${job.status}`,
      };
    }

    const updatedJob = await tx.notificationOutbox.update({
      where: { id: jobId },
      data: {
        status: OutboxJobStatus.SUPPRESSED,
        lastError: `CANCELLED: ${reason}`,
        completedAt: new Date(),
      },
    });

    return {
      job: updatedJob,
      cancelled: true,
    };
  }

  private assertTransactionClient(tx: any): void {
    if (!tx || typeof tx !== 'object') {
      throw new BadRequestException(
        'A valid Prisma transaction client is required. Never invoke outbox methods without an active transaction.',
      );
    }
    if (typeof tx.$transaction === 'function') {
      throw new BadRequestException(
        'Root PrismaClient instance was passed instead of a transaction client. You must pass tx from prisma.$transaction(async (tx) => ...).',
      );
    }
  }
}
