import { Injectable, Logger } from '@nestjs/common';
import { ConsentState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import {
  claimWebhookReplayKey,
  DEFAULT_WEBHOOK_REPLAY_TTL_MS,
} from '../common/webhook-replay.util.js';
import type { InboundMessageEvent } from '../integrations/interfaces/messaging-provider.interface.js';

export type InboundResolutionStatus =
  | 'RESOLVED'
  | 'UNKNOWN_SENDER'
  | 'AMBIGUOUS_TENANT'
  | 'AMBIGUOUS_CUSTOMER';

export type InboundMessageClassification =
  | 'STANDARD_MESSAGE'
  | 'OPT_OUT'
  | 'PAYMENT_CLAIM'
  | 'UNSUPPORTED_MEDIA';

export interface InboundResolutionResult {
  messageId: string;
  senderPhone: string;
  resolution: InboundResolutionStatus;
  tenantId?: string;
  customerId?: string;
  customerName?: string;
  classification: InboundMessageClassification;
  optOutEnforced: boolean;
  paymentClaimDetected: boolean;
  isDuplicate: boolean;
  summary: string;
}

export interface SenderResolution {
  resolution: InboundResolutionStatus;
  tenantId?: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
    notes?: string | null;
    tenantId: string;
  };
  candidateTenants?: string[];
  candidateCustomerIds?: string[];
}

export function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

export function phonesMatch(phoneA: string, phoneB: string): boolean {
  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);
  if (!digitsA || !digitsB) return false;
  if (digitsA === digitsB) return true;

  // Compare last 10 digits for standard phone numbers (with/without country code 91 or leading 0)
  const last10A = digitsA.length >= 10 ? digitsA.slice(-10) : digitsA;
  const last10B = digitsB.length >= 10 ? digitsB.slice(-10) : digitsB;
  return last10A.length === 10 && last10B.length === 10 && last10A === last10B;
}

export function isOptOutMessage(text?: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();
  if (!clean) return false;

  // 1. Exact single-word or short commands
  const exactKeywords = [
    'stop',
    'unsubscribe',
    'dnd',
    'optout',
    'opt-out',
    'opt out',
    'quit',
    'cancel',
    'stop all',
  ];
  if (exactKeywords.includes(clean)) return true;

  // 2. Boundary-aware matching for clear cease-contact commands
  // Matches "unsubscribe", "dnd", "opt-out" anywhere with word boundaries
  const dndBoundaryRegex = /\b(unsubscribe|dnd|opt-?out)\b/i;
  if (dndBoundaryRegex.test(clean)) return true;

  // 3. "Stop" keyword in short instructions (<= 35 chars) or with cease-contact context
  // Prevents false positives on words like "bus stop" or "stopwatch"
  if (clean.length <= 35 && /\bstop\b/i.test(clean)) {
    const ceasePhrases = [
      'stop',
      'please stop',
      'stop it',
      'stop message',
      'stop messaging',
      'stop sending',
      'stop calling',
      'stop reminders',
      'stop contact',
    ];
    if (ceasePhrases.some((p) => clean.includes(p))) return true;
  }

  // 4. Extended cease-contact phrases
  const extendedPhrases = [
    'do not contact',
    'don\'t contact',
    'dont contact',
    'do not message',
    'don\'t message',
    'dont message',
    'remove my number',
    'remove me',
  ];
  return extendedPhrases.some((phrase) => clean.includes(phrase));
}

export function isPaymentClaimMessage(text?: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();
  if (!clean) return false;

  const paymentClaimRegex =
    /\b(paid|payment made|already paid|have paid|transferred|sent money|cleared the bill|payment done|payed)\b|(\butr\b|\bupi\s+ref|\bneft\b|\brtgs\b|\bcheque\s+given|\bcheck\s+given)/i;
  return paymentClaimRegex.test(clean);
}

@Injectable()
export class WhatsAppInboundSafetyService {
  private readonly logger = new Logger(WhatsAppInboundSafetyService.name);

  // In-flight concurrency lock to prevent simultaneous duplicate execution
  private readonly inFlightLocks = new Set<string>();

  // Processed message cache for high-throughput duplicate suppression (24-hour retention)
  private readonly processedCache = new Map<
    string,
    { timestamp: number; result: InboundResolutionResult }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Resolves the inbound sender against active Customer records.
   * Enforces multi-tenant isolation:
   * - Never guesses a tenant when a phone number matches multiple tenants.
   * - Leaves sender unassigned if unknown or ambiguous.
   */
  async resolveSender(senderPhone: string): Promise<SenderResolution> {
    const senderDigits = normalizePhoneDigits(senderPhone);
    if (!senderDigits || senderDigits.length < 7) {
      return { resolution: 'UNKNOWN_SENDER' };
    }

    const last10 = senderDigits.length >= 10 ? senderDigits.slice(-10) : senderDigits;

    // Fetch active candidates whose phone contains the last 10 digits
    const candidates = await this.prisma.customer.findMany({
      where: {
        status: 'ACTIVE',
        phone: { contains: last10 },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        tenantId: true,
      },
    });

    // Exact phone match filtering
    const matched = candidates.filter((c) => phonesMatch(c.phone, senderPhone));

    if (matched.length === 0) {
      return { resolution: 'UNKNOWN_SENDER' };
    }

    // Group matching customers by tenantId
    const tenantMap = new Map<string, typeof candidates>();
    for (const cust of matched) {
      const group = tenantMap.get(cust.tenantId) || [];
      group.push(cust);
      tenantMap.set(cust.tenantId, group);
    }

    // Cross-tenant ambiguity: Phone belongs to multiple distinct tenants.
    // NEVER guess a tenant!
    if (tenantMap.size > 1) {
      this.logger.warn(
        `[INBOUND SAFETY] Sender phone ${senderPhone} matches customers across ${tenantMap.size} distinct tenants. Remaining unassigned for tenant isolation.`,
      );
      return {
        resolution: 'AMBIGUOUS_TENANT',
        candidateTenants: Array.from(tenantMap.keys()),
      };
    }

    const [tenantId, custs] = Array.from(tenantMap.entries())[0];

    // Single-tenant ambiguity: Multiple customer records in the same tenant share this phone number.
    if (custs.length > 1) {
      this.logger.warn(
        `[INBOUND SAFETY] Sender phone ${senderPhone} matches ${custs.length} customer records in tenant ${tenantId}. Remaining unassigned.`,
      );
      return {
        resolution: 'AMBIGUOUS_CUSTOMER',
        tenantId,
        candidateCustomerIds: custs.map((c) => c.id),
      };
    }

    // Unambiguous 1:1 match
    return {
      resolution: 'RESOLVED',
      tenantId,
      customer: custs[0],
    };
  }

  /**
   * Main Safety Evaluation Pipeline for incoming WhatsApp messages.
   *
   * Responsibilities:
   * 1. Inbound Idempotency & Concurrency Lock (by Meta wamid)
   * 2. Tenant-Safe Sender Resolution
   * 3. Opt-Out Protection (enforce DND before any AI invocation)
   * 4. Financial Safety (classify payment claims, NEVER mutate invoices/balances)
   * 5. Zero Outbound Message Guarantee
   */
  async processInboundMessage(event: InboundMessageEvent): Promise<InboundResolutionResult> {
    const messageId = event.messageId;

    // ── 1. Idempotency & Concurrency Lock ─────────────────────────────────────
    if (this.processedCache.has(messageId)) {
      this.logger.debug(`[INBOUND SAFETY] Duplicate inbound WhatsApp message replay suppressed: ${messageId}`);
      const cached = this.processedCache.get(messageId)!.result;
      return { ...cached, isDuplicate: true };
    }

    if (this.inFlightLocks.has(messageId)) {
      this.logger.warn(`[INBOUND SAFETY] Concurrent duplicate inbound delivery detected for ${messageId}. Discarding duplicate execution.`);
      return {
        messageId,
        senderPhone: event.senderPhone,
        resolution: 'UNKNOWN_SENDER',
        classification: 'STANDARD_MESSAGE',
        optOutEnforced: false,
        paymentClaimDetected: false,
        isDuplicate: true,
        summary: 'Concurrent duplicate delivery ignored safely.',
      };
    }

    // ── 1b. Persistent Multi-Instance Database Replay Claim ──────────────────
    const replayKey = `wa_in_${messageId}`;
    let isPersistentClaimed = true;
    if (this.prisma?.webhookReplay && typeof this.prisma.webhookReplay.create === 'function') {
      try {
        isPersistentClaimed = await claimWebhookReplayKey(
          this.prisma,
          'WHATSAPP_CLOUD_INBOUND',
          replayKey,
          DEFAULT_WEBHOOK_REPLAY_TTL_MS,
        );
      } catch (err: any) {
        this.logger.error(`[INBOUND SAFETY] Failed to claim persistent replay key: ${err?.message}`);
        throw err;
      }
    }

    if (!isPersistentClaimed) {
      this.logger.warn(`[INBOUND SAFETY] Duplicate inbound WhatsApp message replay suppressed by persistent database guard: ${messageId}`);
      return {
        messageId,
        senderPhone: event.senderPhone,
        resolution: 'UNKNOWN_SENDER',
        classification: 'STANDARD_MESSAGE',
        optOutEnforced: false,
        paymentClaimDetected: false,
        isDuplicate: true,
        summary: `Duplicate inbound WhatsApp message replay suppressed by persistent replay guard: ${messageId}`,
      };
    }

    this.inFlightLocks.add(messageId);

    try {
      // ── 2. Tenant-Safe Sender Resolution ────────────────────────────────────
      const senderResolution = await this.resolveSender(event.senderPhone);

      // ── 3. Intent & Safety Classification ───────────────────────────────────
      const text = event.text || '';
      let classification: InboundMessageClassification = 'STANDARD_MESSAGE';
      let optOutEnforced = false;
      let paymentClaimDetected = false;

      if (event.type !== 'text') {
        classification = 'UNSUPPORTED_MEDIA';
      } else if (isOptOutMessage(text)) {
        classification = 'OPT_OUT';
      } else if (isPaymentClaimMessage(text)) {
        classification = 'PAYMENT_CLAIM';
      }

      let summary = '';

      // ── 4. Opt-Out Enforcement Guard ────────────────────────────────────────
      if (classification === 'OPT_OUT') {
        if (senderResolution.resolution === 'RESOLVED' && senderResolution.customer) {
          const cust = senderResolution.customer as any;
          let shouldAudit = false;

          // Transactionally check and update customer consent
          if (this.prisma.$transaction) {
            await this.prisma.$transaction(async (tx) => {
              const current = await tx.customer.findUnique({
                where: { id: cust.id },
                select: { id: true, whatsappConsent: true, notes: true, tenantId: true, name: true },
              });
              if (!current) return;

              const isAlreadyOptedOut =
                current.whatsappConsent === ConsentState.OPTED_OUT ||
                (current.notes || '').includes('WhatsApp Opt-Out') ||
                (current.notes || '').includes('DND:NO_CONTACT');

              if (!isAlreadyOptedOut) {
                const timestamp = new Date().toISOString();
                const dndTag = `[DND:NO_CONTACT - WhatsApp Opt-Out on ${timestamp}]`;
                const updatedNotes = current.notes ? `${dndTag}\n${current.notes}` : dndTag;

                await tx.customer.update({
                  where: { id: current.id },
                  data: {
                    whatsappConsent: ConsentState.OPTED_OUT,
                    whatsappConsentAt: new Date(),
                    whatsappConsentSource: 'INBOUND_WHATSAPP_STOP',
                    notes: updatedNotes,
                  },
                });
                shouldAudit = true;
              }
            });
          } else {
            // Mock prisma fallback if $transaction is not mocked
            const currentNotes = cust.notes || '';
            const isAlreadyOptedOut =
              cust.whatsappConsent === ConsentState.OPTED_OUT ||
              currentNotes.includes('WhatsApp Opt-Out') ||
              currentNotes.includes('DND:NO_CONTACT');

            if (!isAlreadyOptedOut) {
              const timestamp = new Date().toISOString();
              const dndTag = `[DND:NO_CONTACT - WhatsApp Opt-Out on ${timestamp}]`;
              const updatedNotes = currentNotes ? `${dndTag}\n${currentNotes}` : dndTag;

              await this.prisma.customer.update({
                where: { id: cust.id },
                data: {
                  whatsappConsent: ConsentState.OPTED_OUT,
                  whatsappConsentAt: new Date(),
                  whatsappConsentSource: 'INBOUND_WHATSAPP_STOP',
                  notes: updatedNotes,
                },
              });
              shouldAudit = true;
            }
          }

          if (shouldAudit) {
            await this.auditLogs.log({
              tenantId: cust.tenantId,
              userId: 'SYSTEM',
              action: 'customer.dnd_registered',
              entityType: 'Customer',
              entityId: cust.id,
              metadata: {
                channel: 'WHATSAPP',
                messageId,
                senderPhone: event.senderPhone,
                trigger: 'INBOUND_OPT_OUT',
                consentState: ConsentState.OPTED_OUT,
              },
            });
          }

          optOutEnforced = true;
          summary = `Opt-out registered and enforced for customer ${cust.name}. Automated reminders and calls suppressed.`;
        } else {
          // Unresolvable sender (unknown or ambiguous)
          // DO NOT modify potentially unrelated customer records!
          optOutEnforced = false;
          summary = `Opt-out keyword received from unresolvable sender (${senderResolution.resolution}). Customer records left untouched for operator review.`;
          this.logger.warn(`[INBOUND SAFETY] ${summary} (Sender: ${event.senderPhone})`);
        }
      }

      // ── 5. Financial Safety Guard ───────────────────────────────────────────
      else if (classification === 'PAYMENT_CLAIM') {
        paymentClaimDetected = true;
        // FINANCIAL SAFETY: Never mark invoice paid or modify customer balance from an inbound statement!
        if (senderResolution.resolution === 'RESOLVED' && senderResolution.customer) {
          await this.auditLogs.log({
            tenantId: senderResolution.customer.tenantId,
            userId: 'SYSTEM',
            action: 'inbound_message.payment_claim_flagged',
            entityType: 'Customer',
            entityId: senderResolution.customer.id,
            metadata: {
              channel: 'WHATSAPP',
              messageId,
              senderPhone: event.senderPhone,
              text,
              reviewStatus: 'PENDING_OPERATOR_VERIFICATION',
            },
          });
          summary = `Customer ${senderResolution.customer.name} claimed payment. Invoices and balances preserved; flagged for operator verification.`;
        } else {
          summary = `Payment claim received from unresolvable sender (${senderResolution.resolution}). No financial records altered.`;
        }
      }

      // ── 6. Standard / Unsupported Media Message ─────────────────────────────
      else {
        summary = `Inbound message evaluated safely (${classification}). Resolution: ${senderResolution.resolution}.`;
      }

      const result: InboundResolutionResult = {
        messageId,
        senderPhone: event.senderPhone,
        resolution: senderResolution.resolution,
        tenantId: senderResolution.tenantId,
        customerId: senderResolution.customer?.id,
        customerName: senderResolution.customer?.name,
        classification,
        optOutEnforced,
        paymentClaimDetected,
        isDuplicate: false,
        summary,
      };

      // Record in processed cache
      this.processedCache.set(messageId, {
        timestamp: Date.now(),
        result,
      });

      // Cleanup cache older than 24h if size > 1000
      if (this.processedCache.size > 1000) {
        const cutoff = Date.now() - 86400000;
        for (const [id, entry] of this.processedCache.entries()) {
          if (entry.timestamp < cutoff) this.processedCache.delete(id);
        }
      }

      return result;
    } catch (err: any) {
      if (this.prisma?.webhookReplay?.deleteMany) {
        try {
          await this.prisma.webhookReplay.deleteMany({ where: { replayKey } });
        } catch {
          // ignore rollback prune failure
        }
      }
      throw err;
    } finally {
      this.inFlightLocks.delete(messageId);
    }
  }

  /**
   * Reset in-memory cache (for isolated test runs).
   */
  clearCache(): void {
    this.inFlightLocks.clear();
    this.processedCache.clear();
  }
}
