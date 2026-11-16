import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as dns from 'dns';

try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {}
import type {
  MessagingAdapter,
  SendMessageInput,
  SendMessageOutput,
  WebhookStatusEvent,
  InboundMessageEvent,
} from '../interfaces/messaging-provider.interface.js';

export type { InboundMessageEvent };

export interface WhatsAppAdapterConfig {
  phoneNumberId?: string;
  accessToken?: string;
  businessAccountId?: string;
  isLive?: boolean;
  testRecipient?: string;
}

export interface TemplateMapping {
  templateName: string;
  defaultLanguage: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  variableOrder: string[];
  supportsPaymentLinkButton?: boolean;
}

export interface ContactNumberValidationResult {
  valid: boolean;
  reason?: string;
  formatted?: string;
}

/**
 * Validates a company contact phone number for tenant WhatsApp templates.
 * Enforces strict safety:
 *  - Must be a non-empty string
 *  - Must contain between 8 and 15 digits (E.164 standard)
 *  - Must only contain valid phone characters (+, digits, spaces, hyphens, parentheses)
 *  - Must NOT match or substitute the customer's phone number
 */
export function validateCompanyContactNumber(
  contactNumber: unknown,
  customerPhone?: string,
): ContactNumberValidationResult {
  if (contactNumber === undefined || contactNumber === null || contactNumber === '') {
    return { valid: false, reason: 'Tenant company contact number is missing' };
  }

  if (typeof contactNumber !== 'string') {
    return { valid: false, reason: 'Tenant company contact number must be a string' };
  }

  const trimmed = contactNumber.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Tenant company contact number cannot be empty' };
  }

  // Permitted phone characters only: digits, +, spaces, hyphens, parentheses, dots
  if (!/^[\d+\s\-().]+$/.test(trimmed)) {
    return { valid: false, reason: 'Tenant company contact number contains invalid characters' };
  }

  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      reason: `Tenant company contact number must have between 8 and 15 digits (found ${digits.length})`,
    };
  }

  // Prevent substituting customer phone number
  if (customerPhone) {
    const customerDigits = String(customerPhone).replace(/[^\d]/g, '');
    if (
      customerDigits.length >= 8 &&
      (digits === customerDigits || digits.endsWith(customerDigits) || customerDigits.endsWith(digits))
    ) {
      return {
        valid: false,
        reason: 'Company contact number cannot match customer phone number',
      };
    }
  }

  return { valid: true, formatted: trimmed };
}

export const APPROVED_WHATSAPP_TEMPLATES: Record<string, TemplateMapping> = {
  PAYMENT_REMINDER_OVERDUE: {
    templateName: 'payment_reminder_overdue',
    defaultLanguage: 'en',
    category: 'UTILITY',
    variableOrder: [
      'customerName',
      'companyName',
      'invoiceNumber',
      'amount',
      'dueDate',
      'companyContactNumber',
    ],
    supportsPaymentLinkButton: false,
  },
  PAYMENT_REMINDER_UPCOMING: {
    templateName: 'payment_reminder_upcoming',
    defaultLanguage: 'en_US',
    category: 'UTILITY',
    variableOrder: ['customerName', 'companyName', 'invoiceNumber', 'amount', 'dueDate'],
    supportsPaymentLinkButton: false,
  },
  PTP_CONFIRMATION: {
    templateName: 'ptp_confirmation',
    defaultLanguage: 'en_US',
    category: 'UTILITY',
    variableOrder: ['customerName', 'promisedAmount', 'promisedDate', 'companyName'],
    supportsPaymentLinkButton: false,
  },
  DISPUTE_ACKNOWLEDGMENT: {
    templateName: 'dispute_acknowledgment',
    defaultLanguage: 'en_US',
    category: 'UTILITY',
    variableOrder: ['customerName', 'invoiceNumber', 'reason', 'companyName'],
    supportsPaymentLinkButton: false,
  },
};

@Injectable()
export class WhatsAppCloudAdapter implements MessagingAdapter {
  private readonly logger = new Logger(WhatsAppCloudAdapter.name);

  private maskPhone(phone: string): string {
    const clean = phone.replace(/[^\d+]/g, '');
    if (clean.length <= 4) return '****';
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }

  private sanitizeSecretString(str: any): string {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/EAA[A-Za-z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/key-[a-f0-9]{32}/gi, '[REDACTED_KEY]')
      .replace(/((?:access_token|secret)=)[^\s&,;'"]+/gi, '$1[REDACTED]');
  }

  /**
   * Safely formats individual variable values for WhatsApp template parameters.
   */
  formatVariableValue(key: string, val: any, input: SendMessageInput): string {
    if (val === undefined || val === null || val === '') {
      switch (key) {
        case 'customerName':
          return input.recipientName || 'Valued Customer';
        case 'invoiceNumber':
          return 'Invoice';
        case 'amount':
          return '₹0';
        case 'dueDate':
          return 'immediate';
        case 'daysOverdue':
          return '0';
        case 'companyName':
          return 'myCashflo';
        case 'companyContactNumber':
          return '-';
        default:
          return '-';
      }
    }

    if (key === 'companyContactNumber') {
      return String(val).replace(/[\r\n\t]+/g, ' ').trim();
    }

    if (key === 'amount') {
      if (typeof val === 'number') {
        return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
      }
      const strVal = String(val).trim();
      return strVal.startsWith('₹') || strVal.startsWith('Rs') ? strVal : `₹${strVal}`;
    }

    if (key === 'dueDate' || key === 'promisedDate') {
      if (val instanceof Date) {
        return val.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      const strVal = String(val).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(strVal)) {
        const d = new Date(strVal);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }
      }
      return strVal;
    }

    if (key === 'daysOverdue') {
      const num = Number(val);
      return isNaN(num) ? '0' : String(Math.max(0, Math.floor(num)));
    }

    if (key === 'customerName' && (!val || String(val).trim() === '')) {
      return input.recipientName || 'Valued Customer';
    }

    return String(val).replace(/[\r\n\t]+/g, ' ').trim();
  }

  /**
   * Constructs an official Meta WhatsApp Cloud API template message payload.
   * Ensures exact template name, language code, variable count and order,
   * header components, and payment link URL button parameter.
   */
  buildTemplatePayload(input: SendMessageInput, toDigits: string): Record<string, any> {
    const rawTemplateName = (input.template || '').trim();
    const normalizedKey = rawTemplateName.toUpperCase();
    const templateDef = APPROVED_WHATSAPP_TEMPLATES[normalizedKey];

    const templateName = templateDef ? templateDef.templateName : rawTemplateName.toLowerCase();
    const languageCode =
      (input.payload?.languageCode as string) ||
      (templateDef ? templateDef.defaultLanguage : 'en_US');

    // 1. Resolve body parameters in exact defined order
    let bodyParameters: { type: 'text'; text: string }[] = [];

    if (Array.isArray(input.payload?.bodyParameters) || Array.isArray(input.payload?.parameters)) {
      const rawParams = input.payload.bodyParameters || input.payload.parameters;
      bodyParameters = rawParams.map((p: any) => ({
        type: 'text',
        text: String(typeof p === 'object' && p?.text ? p.text : p),
      }));
    } else if (templateDef) {
      bodyParameters = templateDef.variableOrder.map((varKey) => {
        const rawVal =
          input.payload?.[varKey] ??
          (varKey === 'customerName' ? input.recipientName : undefined);
        return {
          type: 'text',
          text: this.formatVariableValue(varKey, rawVal, input),
        };
      });
    } else if (input.payload) {
      const recognizedOrder = ['customerName', 'companyName', 'invoiceNumber', 'amount', 'dueDate', 'companyContactNumber', 'daysOverdue'];
      for (const k of recognizedOrder) {
        if (input.payload[k] !== undefined || (k === 'customerName' && input.recipientName)) {
          bodyParameters.push({
            type: 'text',
            text: this.formatVariableValue(k, input.payload[k], input),
          });
        }
      }
    }

    const components: any[] = [];

    // 2. Optional Header component
    if (input.payload?.headerText) {
      components.push({
        type: 'header',
        parameters: [{ type: 'text', text: String(input.payload.headerText) }],
      });
    } else if (input.payload?.headerDocumentUrl) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              link: String(input.payload.headerDocumentUrl),
              filename: String(input.payload.headerDocumentName || 'Invoice.pdf'),
            },
          },
        ],
      });
    }

    // 3. Body component
    if (bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters,
      });
    }

    // 4. Optional URL Button component
    const shouldAddButton =
      (templateDef?.supportsPaymentLinkButton !== false) && Boolean(input.payload?.paymentLink);
    if (shouldAddButton) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: String(input.payload?.paymentLink) }],
      });
    }

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toDigits,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    };
  }

  /**
   * Dispatch WhatsApp Business message via Meta Cloud API or safe simulation mode.
   * Supports:
   *  - Free-form text for 24h customer service windows
   *  - Official approved Meta template messages with components (header, body variables, URL buttons)
   *  - Safety Guard: Never dispatches to real customer numbers in non-production.
   */
  async send(
    input: SendMessageInput,
    config?: WhatsAppAdapterConfig,
  ): Promise<SendMessageOutput> {
    const phoneNumberId = config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
    const testRecipient = config?.testRecipient || process.env.WHATSAPP_TEST_RECIPIENT;
    const isLive = Boolean(phoneNumberId && accessToken && !accessToken.includes('mock'));

    const cleanPhone = input.to.replace(/[^\d+]/g, '').replace(/^0+/, '');
    const toDigits = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;
    const messageId = `wamid.HBgL${Date.now()}${Math.random().toString(36).substring(2, 9)}==`;

    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd || testRecipient) {
      const allowedRecipient = testRecipient ? testRecipient.replace(/[^\d]/g, '') : null;
      const isAllowed = allowedRecipient ? toDigits === allowedRecipient : toDigits.endsWith('0000') || toDigits === '919876543210';

      if (!isAllowed && isLive) {
        this.logger.warn(
          `[SAFETY GUARD] WhatsApp dispatch to ${this.maskPhone(cleanPhone)} suppressed. Real customer outreach is disabled in non-production. Configured test recipient: ${allowedRecipient ? this.maskPhone(allowedRecipient) : 'none'}`,
        );
        return {
          messageId: `wamid.blocked.${Date.now()}`,
          provider: 'WHATSAPP_CLOUD',
          status: 'DELIVERED',
          isSimulated: true,
          raw: {
            simulated: true,
            safetyGuard: true,
            recipient: this.maskPhone(cleanPhone),
            reason: 'Real customer phone suppressed in non-production',
          },
        };
      }
    }

    // ── Safe Simulation & Safety Guard ───────────────────────────────────────
    // Strict safety validation for PAYMENT_REMINDER_OVERDUE
    if (input.template === 'PAYMENT_REMINDER_OVERDUE') {
      const contactVal = validateCompanyContactNumber(input.payload?.companyContactNumber, toDigits);
      if (!contactVal.valid && (isLive || input.payload?.companyContactNumber !== undefined)) {
        this.logger.warn(
          `[SAFETY GUARD] WhatsApp dispatch for PAYMENT_REMINDER_OVERDUE to ${this.maskPhone(cleanPhone)} rejected: ${contactVal.reason}`,
        );
        return {
          messageId: `wamid.failed.${Date.now()}`,
          provider: 'WHATSAPP_CLOUD',
          status: 'FAILED',
          isSimulated: true,
          error: contactVal.reason,
          raw: {
            safetyGuard: true,
            failed: true,
            error: contactVal.reason,
            template: input.template,
          },
        };
      }
    }

    if (isLive) {
      try {
        let messagePayload: Record<string, any>;

        // If template name is provided, construct official WhatsApp Business Template payload
        if (input.template && input.template !== 'CUSTOM' && input.template !== 'TEST_CONNECTION') {
          messagePayload = this.buildTemplatePayload(input, toDigits);
        } else {
          // Free-form text message (Strictly permitted within 24h customer service window)
          if (!input.payload?.isCustomerInitiatedWindow) {
            this.logger.warn(
              `[WHATSAPP_WINDOW_NOTICE] Free-form WhatsApp messages outside the 24h customer care window are subject to Meta delivery rejection. Outbound reminders should use approved templates (PAYMENT_REMINDER_OVERDUE or PAYMENT_REMINDER_UPCOMING).`,
            );
          }
          messagePayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toDigits,
            type: 'text',
            text: {
              preview_url: false,
              body: input.message,
            },
          };
        }

        const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(messagePayload),
          signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          const liveMsgId = data?.messages?.[0]?.id || messageId;
          return {
            messageId: liveMsgId,
            provider: 'WHATSAPP_CLOUD',
            status: 'SENT',
            isSimulated: false,
            raw: data,
          };
        }

        // Meta returned an error status (e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Rate Limit, 500 Server Error)
        let errorData: any = null;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: { message: `HTTP ${response.status} from WhatsApp Cloud API` } };
        }

        const rawErrMsg =
          errorData?.error?.message || `WhatsApp Cloud API returned HTTP ${response.status}`;
        const safeErrMsg = this.sanitizeSecretString(rawErrMsg);
        const errorCode = errorData?.error?.code;
        const errorSubcode = errorData?.error?.error_subcode;
        const fbtraceId = errorData?.error?.fbtrace_id;

        this.logger.error(
          `WhatsApp Cloud API error (HTTP ${response.status}${errorCode ? `, code: ${errorCode}` : ''}): ${safeErrMsg}`,
        );

        return {
          messageId: `wamid.failed.${Date.now()}`,
          provider: 'WHATSAPP_CLOUD',
          status: 'FAILED',
          isSimulated: false,
          error: safeErrMsg,
          raw: {
            httpStatus: response.status,
            errorCode,
            errorSubcode,
            fbtraceId,
            error: safeErrMsg,
            template: input.template,
            timestamp: new Date().toISOString(),
            errorData: typeof errorData === 'object' && errorData !== null ? errorData : undefined,
          },
        };
      } catch (err: any) {
        const isTimeout =
          err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'ETIMEDOUT';
        const rawMsg = isTimeout
          ? 'WhatsApp Cloud API request timed out'
          : err?.message || 'Network error communicating with WhatsApp Cloud API';
        const safeMsg = this.sanitizeSecretString(rawMsg);
        this.logger.error(`WhatsApp Cloud API dispatch network failure: ${safeMsg}`);

        return {
          messageId: `wamid.err.${Date.now()}`,
          provider: 'WHATSAPP_CLOUD',
          status: 'FAILED',
          isSimulated: false,
          error: safeMsg,
          raw: {
            networkError: true,
            isTimeout: Boolean(isTimeout),
            error: safeMsg,
            template: input.template,
            timestamp: new Date().toISOString(),
          },
        };
      }
    }

    // Safe simulation mode fallback (only when live credentials are not configured)
    return {
      messageId,
      provider: 'WHATSAPP_CLOUD',
      status: 'DELIVERED',
      isSimulated: true,
      raw: {
        simulated: true,
        recipient: this.maskPhone(cleanPhone),
        template: input.template,
        timestamp: new Date().toISOString(),
      },
    };
  }

  verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    configuredToken?: string,
  ): string | null {
    const isProd = process.env.NODE_ENV === 'production';
    const verifyToken =
      configuredToken ||
      process.env.WHATSAPP_VERIFY_TOKEN ||
      (isProd ? '' : 'mycashflo_whatsapp_verify_token');
    if (!verifyToken) return null;
    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }
    return null;
  }

  verifyWebhookSignature(payload: any, signature: string, secret?: string): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    if (!signature) return false;

    const isSimSig = signature === 'mock_valid_signature' || signature.startsWith('sim_');
    if (isProd && isSimSig) {
      return false;
    }

    const appSecret =
      secret || process.env.WHATSAPP_APP_SECRET || (isProd ? '' : 'whatsapp_app_secret_demo');
    if (!appSecret) {
      return false;
    }

    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const signatureHash = signature.startsWith('sha256=') ? signature.split('=')[1] : signature;

    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expected));
    } catch {
      return !isProd && isSimSig;
    }
  }

  parseWebhook(payload: any): WebhookStatusEvent[] {
    const events: WebhookStatusEvent[] = [];
    const entries = payload?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const statuses = change?.value?.statuses || [];
        for (const st of statuses) {
          let mappedStatus: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' = 'DELIVERED';
          if (st.status === 'sent') mappedStatus = 'SENT';
          else if (st.status === 'delivered') mappedStatus = 'DELIVERED';
          else if (st.status === 'read') mappedStatus = 'READ';
          else if (st.status === 'failed') mappedStatus = 'FAILED';

          const errObj = st.errors?.[0];
          const errorMsg = errObj?.message || errObj?.title || errObj?.error_data?.details;

          events.push({
            messageId: st.id,
            status: mappedStatus,
            timestamp: new Date(Number(st.timestamp) * 1000 || Date.now()),
            recipientPhone: st.recipient_id,
            error: errorMsg,
            errorCode: errObj?.code,
          });
        }
      }
    }

    // Direct single status fallback (for test scripts and simple webhooks)
    if (events.length === 0 && payload?.messageId) {
      let mappedStatus: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' = 'DELIVERED';
      if (payload.status === 'SENT' || payload.status === 'sent') mappedStatus = 'SENT';
      else if (payload.status === 'FAILED' || payload.status === 'failed') mappedStatus = 'FAILED';
      else if (payload.status === 'READ' || payload.status === 'read') mappedStatus = 'READ';

      events.push({
        messageId: payload.messageId,
        status: mappedStatus,
        timestamp: new Date(),
        recipientPhone: payload.recipientPhone,
        error: payload.error,
        errorCode: payload.errorCode,
      });
    }

    return events;
  }

  /**
   * Parses incoming customer WhatsApp messages from Meta's Cloud API webhook payload.
   * Extracts only validated, safe fields needed by the application:
   * sender number, provider message ID, message type, timestamp, and text body.
   * Malformed or non-message entries are ignored safely without throwing.
   */
  parseInboundMessages(payload: any): InboundMessageEvent[] {
    const events: InboundMessageEvent[] = [];
    if (!payload || typeof payload !== 'object') {
      return events;
    }

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        if (!change || typeof change !== 'object') continue;
        const messages = Array.isArray(change.value?.messages) ? change.value.messages : [];
        for (const msg of messages) {
          if (!msg || typeof msg !== 'object') continue;
          if (!msg.id || !msg.from) continue;

          const msgType = typeof msg.type === 'string' && msg.type.trim() ? msg.type.trim() : 'unknown';
          let bodyText: string | undefined = undefined;

          if (msgType === 'text' && typeof msg.text?.body === 'string') {
            bodyText = msg.text.body.trim();
          }

          const rawTimestamp = Number(msg.timestamp);
          const timestamp = !isNaN(rawTimestamp) && rawTimestamp > 0
            ? new Date(rawTimestamp * 1000)
            : new Date();

          const cleanPhone = String(msg.from).replace(/\D/g, '');

          events.push({
            messageId: String(msg.id),
            senderPhone: cleanPhone,
            senderNumber: cleanPhone,
            type: msgType,
            timestamp,
            ...(bodyText !== undefined ? { text: bodyText } : {}),
          });
        }
      }
    }

    // Direct fallback for simple mock payloads in test harnesses: { messages: [...] }
    if (events.length === 0 && Array.isArray(payload.messages)) {
      for (const msg of payload.messages) {
        if (!msg || typeof msg !== 'object') continue;
        if (!msg.id || !msg.from) continue;

        const msgType = typeof msg.type === 'string' && msg.type.trim() ? msg.type.trim() : 'unknown';
        let bodyText: string | undefined = undefined;

        if (msgType === 'text' && typeof msg.text?.body === 'string') {
          bodyText = msg.text.body.trim();
        }

        const rawTimestamp = Number(msg.timestamp);
        const timestamp = !isNaN(rawTimestamp) && rawTimestamp > 0
          ? new Date(rawTimestamp * 1000)
          : new Date();

        const cleanPhone = String(msg.from).replace(/\D/g, '');

        events.push({
          messageId: String(msg.id),
          senderPhone: cleanPhone,
          senderNumber: cleanPhone,
          type: msgType,
          timestamp,
          ...(bodyText !== undefined ? { text: bodyText } : {}),
        });
      }
    }

    return events;
  }
}

