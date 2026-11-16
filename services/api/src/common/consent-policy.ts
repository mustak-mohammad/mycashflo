import { ConsentState, NotificationChannel } from '@prisma/client';
export { ConsentState, NotificationChannel };

export type LegacyDndClassification =
  | 'WHATSAPP_ONLY'
  | 'SMS_ONLY'
  | 'EMAIL_ONLY'
  | 'VOICE_ONLY'
  | 'GLOBAL_CEASE_CONTACT'
  | 'AMBIGUOUS'
  | 'NONE';

export interface ConsentEvaluationResult {
  allowed: boolean;
  status: 'ALLOWED' | 'SUPPRESSED';
  reason?: string;
  classification: LegacyDndClassification;
  consentState: ConsentState;
  source?: string | null;
}

/**
 * Classifies legacy unstructured customer notes for DND/cease-contact directives.
 *
 * Requirements (Phase 1C):
 * 1. Clearly WhatsApp-specific opt-outs must block WhatsApp only.
 * 2. Clearly global cease-contact directives must block all applicable channels.
 * 3. Ambiguous records must remain suppressed until reviewed.
 * 4. Preserve every historical customer note exactly as stored.
 * 5. Do not bulk opt customers into any channel.
 */
export function classifyLegacyNotes(notes?: string | null): LegacyDndClassification {
  if (!notes || typeof notes !== 'string') return 'NONE';

  const trimmed = notes.trim();
  if (!trimmed) return 'NONE';

  const lower = trimmed.toLowerCase();

  // Check if there is any DND or opt-out indicator
  const hasDndIndicator =
    /\b(dnd|opt[-_ ]?out|no[-_ ]?contact|do[-_ ]?not[-_ ]?contact|cease[-_ ]?contact|unsubscribe|stop)\b/i.test(trimmed) ||
    lower.includes('dnd:') ||
    lower.includes('opt_out:') ||
    lower.includes('no-contact') ||
    lower.includes('do-not-contact');

  if (!hasDndIndicator) {
    return 'NONE';
  }

  // Tag-based exact channel matches: e.g. [OPT_OUT:WHATSAPP], [OPT_OUT:SMS], [OPT_OUT:EMAIL]
  if (/\[(opt[-_ ]?out|dnd):whatsapp/i.test(trimmed)) {
    return 'WHATSAPP_ONLY';
  }
  if (/\[(opt[-_ ]?out|dnd):sms/i.test(trimmed)) {
    return 'SMS_ONLY';
  }
  if (/\[(opt[-_ ]?out|dnd):email/i.test(trimmed)) {
    return 'EMAIL_ONLY';
  }
  if (/\[(opt[-_ ]?out|dnd):(voice|call|calls|phone)/i.test(trimmed)) {
    return 'VOICE_ONLY';
  }
  if (/\[(opt[-_ ]?out|dnd):all/i.test(trimmed)) {
    return 'GLOBAL_CEASE_CONTACT';
  }

  // Check explicit global cease-contact phrases
  const hasGlobalPhrase =
    /\b(all channels|all outreach|all communication|every channel)\b/i.test(trimmed) ||
    /\bcease[-_ ]?contact\b/i.test(trimmed) ||
    /do[-_ ]?not[-_ ]?contact\s+all/i.test(trimmed) ||
    /dnd:all/i.test(trimmed);

  const mentionsWhatsApp = /\b(whatsapp|wa)\b/i.test(trimmed);
  const mentionsSms = /\bsms\b/i.test(trimmed);
  const mentionsEmail = /\b(email|emails|unsubscribe)\b/i.test(trimmed);
  const mentionsVoice = /\b(phone|call|calls|voice)\b/i.test(trimmed);

  // If explicitly mentions multiple channels like "phone and email" or "all channels"
  const channelCount = [mentionsWhatsApp, mentionsSms, mentionsEmail, mentionsVoice].filter(Boolean).length;
  if (hasGlobalPhrase || channelCount >= 2) {
    return 'GLOBAL_CEASE_CONTACT';
  }

  // Isolated single-channel mentions
  if (mentionsWhatsApp && !mentionsSms && !mentionsEmail && !mentionsVoice) {
    return 'WHATSAPP_ONLY';
  }
  if (mentionsSms && !mentionsWhatsApp && !mentionsEmail && !mentionsVoice) {
    return 'SMS_ONLY';
  }
  if (mentionsEmail && !mentionsWhatsApp && !mentionsSms && !mentionsVoice) {
    return 'EMAIL_ONLY';
  }
  if (mentionsVoice && !mentionsWhatsApp && !mentionsSms && !mentionsEmail) {
    return 'VOICE_ONLY';
  }

  // Ambiguous: mentions DND / opt-out / no-contact without specific channel
  // e.g. "[DND:NO_CONTACT - Requested on 2026-11-02T10:29:00.907Z]"
  return 'AMBIGUOUS';
}

/**
 * Centrally evaluates customer consent for a specific communication channel.
 */
export function evaluateCustomerConsent(
  customer: {
    emailConsent?: ConsentState | null;
    whatsappConsent?: ConsentState | null;
    smsConsent?: ConsentState | null;
    voiceConsent?: ConsentState | null;
    notes?: string | null;
    status?: string | null;
  },
  channel: NotificationChannel | 'EMAIL' | 'WHATSAPP' | 'SMS' | 'VOICE',
): ConsentEvaluationResult {
  const normChannel = typeof channel === 'string' ? channel.toUpperCase() : channel;

  // 1. Customer status guard
  if (customer.status === 'INACTIVE') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer is marked INACTIVE in tenant records',
      classification: 'NONE',
      consentState: ConsentState.OPTED_OUT,
    };
  }

  // 2. Classify legacy notes
  const classification = classifyLegacyNotes(customer.notes);

  if (classification === 'GLOBAL_CEASE_CONTACT') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has an explicit global cease-contact directive on file [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  if (classification === 'AMBIGUOUS') {
    // Requirement A.3: Ambiguous records must remain suppressed until reviewed
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has an ambiguous historical DND/cease-contact record pending review [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.UNKNOWN,
    };
  }

  if (classification === 'WHATSAPP_ONLY' && normChannel === 'WHATSAPP') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has a historical WhatsApp-specific opt-out directive on file [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  if (classification === 'SMS_ONLY' && normChannel === 'SMS') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has a historical SMS-specific opt-out directive on file [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  if (classification === 'EMAIL_ONLY' && normChannel === 'EMAIL') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has a historical Email-specific unsubscribe/opt-out directive on file [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  if (classification === 'VOICE_ONLY' && normChannel === 'VOICE') {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: 'Customer has a historical Voice/Phone-specific opt-out directive on file [DND:NO_CONTACT]',
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  // 3. Structured consent check per channel
  let channelConsent: ConsentState = ConsentState.UNKNOWN;
  if (normChannel === 'EMAIL') {
    channelConsent = customer.emailConsent || ConsentState.UNKNOWN;
  } else if (normChannel === 'WHATSAPP') {
    channelConsent = customer.whatsappConsent || ConsentState.UNKNOWN;
  } else if (normChannel === 'SMS') {
    channelConsent = customer.smsConsent || ConsentState.UNKNOWN;
  } else if (normChannel === 'VOICE') {
    channelConsent = customer.voiceConsent || ConsentState.UNKNOWN;
  }

  if (channelConsent === ConsentState.OPTED_OUT) {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: `Customer has explicitly opted out of ${normChannel} communications`,
      classification,
      consentState: ConsentState.OPTED_OUT,
    };
  }

  if (channelConsent === ConsentState.UNKNOWN) {
    return {
      allowed: false,
      status: 'SUPPRESSED',
      reason: `Customer has not explicitly opted into ${normChannel} communications (consent state: UNKNOWN)`,
      classification,
      consentState: ConsentState.UNKNOWN,
    };
  }

  // Consent is explicitly OPTED_IN
  return {
    allowed: true,
    status: 'ALLOWED',
    classification,
    consentState: ConsentState.OPTED_IN,
  };
}
