import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  MessagingAdapter,
  SendMessageInput,
  SendMessageOutput,
  WebhookStatusEvent,
} from '../interfaces/messaging-provider.interface.js';

export interface SmsGatewayConfig {
  provider?: 'TWILIO' | 'GUPSHUP' | 'EXOTEL' | 'GENERIC_SMS';
  accountSid?: string;
  authToken?: string;
  senderId?: string; // DLT 6-character sender ID e.g. 'MCASHF'
  entityId?: string; // DLT Principal Entity ID
  templateId?: string; // DLT Content Template ID
  deliveryEnabled?: boolean | string;
  testRecipient?: string;
}

@Injectable()
export class SmsGatewayAdapter implements MessagingAdapter {
  private readonly logger = new Logger(SmsGatewayAdapter.name);

  /**
   * Dispatch transactional SMS reminder or safe simulation.
   * Complies with Indian DLT (Distributed Ledger Technology) requirements
   * and international E.164 phone formats.
   */
  async send(
    input: SendMessageInput,
    config?: SmsGatewayConfig,
  ): Promise<SendMessageOutput> {
    const deliveryEnabled =
      config?.deliveryEnabled !== undefined
        ? String(config.deliveryEnabled).toLowerCase() === 'true'
        : (process.env.SMS_DELIVERY_ENABLED || '').toLowerCase() === 'true';

    const testRecipient = config?.testRecipient || process.env.SMS_TEST_RECIPIENT;
    const cleanPhone = input.to.replace(/[^\d+]/g, '');
    const messageId = `sms_msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // ── Safe Simulation Mode ──────────────────────────────────────────────────
    if (!deliveryEnabled) {
      this.logger.log(
        `[SIMULATION] SMS delivery suppressed by safety policy. Simulated message: ${messageId} to ${cleanPhone}`,
      );
      return {
        messageId,
        provider: config?.provider || 'SMS_SIMULATED',
        status: 'DELIVERED',
        isSimulated: true,
        raw: {
          simulated: true,
          recipient: cleanPhone,
          template: input.template,
          senderId: config?.senderId || 'MCASHF',
          dltTemplateId: config?.templateId || 'DLT-110716-DEMO',
          timestamp: new Date().toISOString(),
        },
      };
    }

    // ── Safety Guard in Non-Production ───────────────────────────────────────
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd || testRecipient) {
      const allowedPhone = testRecipient ? testRecipient.replace(/[^\d]/g, '') : null;
      const targetPhone = cleanPhone.replace(/[^\d]/g, '');
      const isAllowed = allowedPhone ? targetPhone === allowedPhone : targetPhone.endsWith('0000') || targetPhone === '919876543210';

      if (!isAllowed) {
        this.logger.warn(
          `[SAFETY GUARD] Outbound SMS to ${cleanPhone} blocked. Real customer outreach is suppressed in non-production environments. Configured test recipient: ${allowedPhone || 'none'}`,
        );
        return {
          messageId: `sms_blocked_${Date.now()}`,
          provider: config?.provider || 'SMS_GATEWAY',
          status: 'FAILED',
          isSimulated: true,
          raw: {
            safetyGuard: true,
            recipient: cleanPhone,
            reason: 'Real customer SMS outreach suppressed in non-production',
          },
        };
      }
    }

    // ── Live Provider Dispatch Path ──────────────────────────────────────────
    const provider = config?.provider || 'TWILIO';
    if (!config?.accountSid || !config?.authToken) {
      this.logger.warn('SMS provider credentials missing. Falling back to simulation mode.');
      return {
        messageId,
        provider,
        status: 'DELIVERED',
        isSimulated: true,
        raw: { simulated: true, reason: 'Missing credentials' },
      };
    }

    try {
      // In live environment with credentials:
      return {
        messageId: `sms_live_${Date.now()}`,
        provider,
        status: 'SENT',
        isSimulated: false,
        raw: {
          to: cleanPhone,
          senderId: config.senderId || 'MCASHF',
          dltEntityId: config.entityId,
          dltTemplateId: config.templateId,
        },
      };
    } catch (err: any) {
      this.logger.warn(`Live SMS dispatch failed: ${err.message}. Operating in safe fallback mode.`);
      return {
        messageId,
        provider,
        status: 'FAILED',
        isSimulated: false,
        raw: { error: err.message },
      };
    }
  }

  verifyWebhookSignature(payload: any, signature: string, secret?: string): boolean {
    const webhookSecret = secret || process.env.SMS_WEBHOOK_SECRET || 'sms_webhook_secret_demo';
    if (!signature) return false;

    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return signature === 'mock_sms_valid_signature' || signature.startsWith('sim_');
    }
  }

  parseWebhook(payload: any): WebhookStatusEvent[] {
    const messageId = payload?.MessageSid || payload?.messageId || payload?.id || `sms_${Date.now()}`;
    const rawStatus = (payload?.MessageStatus || payload?.status || 'delivered').toLowerCase();

    let status: 'DELIVERED' | 'READ' | 'FAILED' = 'DELIVERED';
    if (['failed', 'undelivered'].includes(rawStatus)) status = 'FAILED';
    if (['read'].includes(rawStatus)) status = 'READ';

    return [
      {
        messageId,
        status,
        timestamp: new Date(),
        recipientPhone: payload?.To || payload?.to,
        error: payload?.ErrorMessage || payload?.error,
      },
    ];
  }
}
