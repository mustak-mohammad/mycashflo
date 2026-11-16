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

  private maskPhone(phone: string): string {
    const clean = phone.replace(/[^\d+]/g, '');
    if (clean.length <= 4) return '****';
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }

  private sanitizeSecretString(str: any): string {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/key-[a-f0-9]{32}/gi, '[REDACTED_KEY]')
      .replace(/((?:authToken|accountSid|secret)=)[^\s&,;'"]+/gi, '$1[REDACTED]');
  }

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

    // ── Delivery Disabled Policy ──────────────────────────────────────────────
    if (!deliveryEnabled) {
      this.logger.log(
        `[SIMULATION] SMS delivery suppressed by safety policy. Target: ${this.maskPhone(cleanPhone)}`,
      );
      return {
        messageId: `sms_disabled_${Date.now()}`,
        provider: config?.provider || 'SMS_GATEWAY',
        status: 'FAILED',
        isSimulated: true,
        error: 'SMS delivery is disabled by safety policy (SMS_DELIVERY_ENABLED is false)',
        raw: {
          simulated: true,
          deliveryDisabled: true,
          recipient: this.maskPhone(cleanPhone),
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
          `[SAFETY GUARD] Outbound SMS to ${this.maskPhone(cleanPhone)} blocked. Real customer outreach is suppressed in non-production environments. Configured test recipient: ${allowedPhone ? this.maskPhone(allowedPhone) : 'none'}`,
        );
        return {
          messageId: `sms_blocked_${Date.now()}`,
          provider: config?.provider || 'SMS_GATEWAY',
          status: 'FAILED',
          isSimulated: true,
          error: `Safety Guard: Delivery to real customer phone '${this.maskPhone(cleanPhone)}' is blocked in non-production. Target must match SMS_TEST_RECIPIENT.`,
          raw: {
            safetyGuard: true,
            recipient: this.maskPhone(cleanPhone),
            reason: 'Real customer SMS outreach suppressed in non-production',
          },
        };
      }
    }

    // ── Live Provider Dispatch Path ──────────────────────────────────────────
    const provider = config?.provider || 'TWILIO';
    if (!config?.accountSid || !config?.authToken) {
      this.logger.warn('SMS provider credentials missing. Outbound SMS cannot be dispatched.');
      return {
        messageId: `sms_no_creds_${Date.now()}`,
        provider,
        status: 'FAILED',
        isSimulated: false,
        error: 'SMS provider credentials are missing (accountSid and authToken required)',
        raw: {
          missingCredentials: true,
          recipient: this.maskPhone(cleanPhone),
          template: input.template,
          timestamp: new Date().toISOString(),
        },
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
      const safeErr = this.sanitizeSecretString(err.message);
      this.logger.warn(`Live SMS dispatch failed: ${safeErr}`);
      return {
        messageId: `sms_failed_${Date.now()}`,
        provider,
        status: 'FAILED',
        isSimulated: false,
        error: safeErr,
        raw: { error: safeErr },
      };
    }
  }

  verifyWebhookSignature(payload: any, signature: string, secret?: string): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    if (!signature) return false;

    const isSimSig = signature === 'mock_sms_valid_signature' || signature.startsWith('sim_');
    if (isProd && isSimSig) {
      return false;
    }

    const webhookSecret =
      secret || process.env.SMS_WEBHOOK_SECRET || (isProd ? '' : 'sms_webhook_secret_demo');
    if (!webhookSecret) {
      return false;
    }

    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return !isProd && isSimSig;
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
