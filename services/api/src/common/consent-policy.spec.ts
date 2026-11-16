import { describe, it, expect } from 'vitest';
import { ConsentState, NotificationChannel } from '@prisma/client';
import {
  classifyLegacyNotes,
  evaluateCustomerConsent,
} from './consent-policy.js';

describe('Consent Policy & Legacy DND Classification (Phase 1C)', () => {
  describe('classifyLegacyNotes', () => {
    it('returns NONE for empty or unrelated notes', () => {
      expect(classifyLegacyNotes(null)).toBe('NONE');
      expect(classifyLegacyNotes(undefined)).toBe('NONE');
      expect(classifyLegacyNotes('')).toBe('NONE');
      expect(classifyLegacyNotes('VIP client; prefers afternoon follow-ups [Ref: CUST-01]')).toBe('NONE');
    });

    it('classifies WhatsApp-specific opt-out', () => {
      expect(classifyLegacyNotes('[DND:NO_CONTACT - WhatsApp Opt-Out on 2026-10-19T18:00:00Z]')).toBe(
        'WHATSAPP_ONLY',
      );
      expect(classifyLegacyNotes('Customer requested WA opt-out via text')).toBe('WHATSAPP_ONLY');
      expect(classifyLegacyNotes('[OPT_OUT:WHATSAPP - INBOUND_WHATSAPP_STOP]')).toBe('WHATSAPP_ONLY');
    });

    it('classifies SMS-specific opt-out', () => {
      expect(classifyLegacyNotes('Customer sent STOP via SMS')).toBe('SMS_ONLY');
      expect(classifyLegacyNotes('[OPT_OUT:SMS - Unsubscribed from SMS]')).toBe('SMS_ONLY');
    });

    it('classifies Email-specific opt-out', () => {
      expect(classifyLegacyNotes('Customer clicked unsubscribe link in email')).toBe('EMAIL_ONLY');
      expect(classifyLegacyNotes('[OPT_OUT:EMAIL - Do not email invoices]')).toBe('EMAIL_ONLY');
    });

    it('classifies Voice-specific opt-out', () => {
      expect(classifyLegacyNotes('Customer said: stop calling me on my phone')).toBe('VOICE_ONLY');
      expect(classifyLegacyNotes('[OPT_OUT:VOICE - No phone calls]')).toBe('VOICE_ONLY');
      expect(classifyLegacyNotes('[DND:CALL - Cease telephone outreach]')).toBe('VOICE_ONLY');
    });

    it('classifies explicit global cease-contact directives', () => {
      expect(classifyLegacyNotes('Customer formally requested cease contact via phone and email on 2026-08-15')).toBe(
        'GLOBAL_CEASE_CONTACT',
      );
      expect(classifyLegacyNotes('Cease contact immediately across all channels')).toBe(
        'GLOBAL_CEASE_CONTACT',
      );
      expect(classifyLegacyNotes('[DND:ALL - Cease-contact requested]')).toBe('GLOBAL_CEASE_CONTACT');
      expect(classifyLegacyNotes('Do-Not-Contact ALL communication pathways')).toBe('GLOBAL_CEASE_CONTACT');
    });

    it('classifies ambiguous DND notes as AMBIGUOUS for review', () => {
      expect(classifyLegacyNotes('[DND:NO_CONTACT - Requested on 2026-11-02T10:29:00.907Z]')).toBe(
        'AMBIGUOUS',
      );
      expect(classifyLegacyNotes('DND requested')).toBe('AMBIGUOUS');
      expect(classifyLegacyNotes('Customer requested no_contact')).toBe('AMBIGUOUS');
    });
  });

  describe('evaluateCustomerConsent', () => {
    it('blocks INACTIVE customer regardless of consent', () => {
      const res = evaluateCustomerConsent(
        { status: 'INACTIVE', emailConsent: ConsentState.OPTED_IN },
        NotificationChannel.EMAIL,
      );
      expect(res.allowed).toBe(false);
      expect(res.status).toBe('SUPPRESSED');
      expect(res.reason).toContain('INACTIVE');
    });

    it('suppresses communication when legacy note has global cease-contact', () => {
      const res = evaluateCustomerConsent(
        {
          notes: 'Customer formally requested cease contact via phone and email on 2026-08-15',
          emailConsent: ConsentState.OPTED_IN,
        },
        NotificationChannel.EMAIL,
      );
      expect(res.allowed).toBe(false);
      expect(res.status).toBe('SUPPRESSED');
      expect(res.reason).toContain('global cease-contact directive');
    });

    it('suppresses communication when legacy note is AMBIGUOUS', () => {
      const res = evaluateCustomerConsent(
        {
          notes: '[DND:NO_CONTACT - Requested on 2026-11-02T10:29:00.907Z]',
          whatsappConsent: ConsentState.OPTED_IN,
        },
        NotificationChannel.WHATSAPP,
      );
      expect(res.allowed).toBe(false);
      expect(res.status).toBe('SUPPRESSED');
      expect(res.reason).toContain('ambiguous historical DND/cease-contact record pending review');
    });

    it('isolates WhatsApp-specific legacy opt-out so Email is NOT suppressed if opted in', () => {
      const waRes = evaluateCustomerConsent(
        {
          notes: '[DND:NO_CONTACT - WhatsApp Opt-Out on 2026-10-19T18:00:00Z]',
          whatsappConsent: ConsentState.OPTED_IN,
          emailConsent: ConsentState.OPTED_IN,
        },
        NotificationChannel.WHATSAPP,
      );
      expect(waRes.allowed).toBe(false);
      expect(waRes.status).toBe('SUPPRESSED');
      expect(waRes.reason).toContain('WhatsApp-specific opt-out');

      const emailRes = evaluateCustomerConsent(
        {
          notes: '[DND:NO_CONTACT - WhatsApp Opt-Out on 2026-10-19T18:00:00Z]',
          whatsappConsent: ConsentState.OPTED_OUT,
          emailConsent: ConsentState.OPTED_IN,
        },
        NotificationChannel.EMAIL,
      );
      expect(emailRes.allowed).toBe(true);
      expect(emailRes.status).toBe('ALLOWED');
    });

    it('never treats UNKNOWN consent as permission', () => {
      const emailRes = evaluateCustomerConsent(
        {
          emailConsent: ConsentState.UNKNOWN,
        },
        NotificationChannel.EMAIL,
      );
      expect(emailRes.allowed).toBe(false);
      expect(emailRes.status).toBe('SUPPRESSED');
      expect(emailRes.reason).toContain('consent state: UNKNOWN');

      const waRes = evaluateCustomerConsent(
        {
          whatsappConsent: undefined, // defaults to UNKNOWN
        },
        NotificationChannel.WHATSAPP,
      );
      expect(waRes.allowed).toBe(false);
      expect(waRes.status).toBe('SUPPRESSED');
      expect(waRes.reason).toContain('consent state: UNKNOWN');
    });

    it('blocks OPTED_OUT channel consent', () => {
      const res = evaluateCustomerConsent(
        {
          emailConsent: ConsentState.OPTED_OUT,
        },
        NotificationChannel.EMAIL,
      );
      expect(res.allowed).toBe(false);
      expect(res.status).toBe('SUPPRESSED');
      expect(res.reason).toContain('explicitly opted out');
    });

    it('allows communication only when channel is explicitly OPTED_IN and no DND blocks it', () => {
      const res = evaluateCustomerConsent(
        {
          emailConsent: ConsentState.OPTED_IN,
          notes: 'Standard customer notes [Ref: REF-001]',
        },
        NotificationChannel.EMAIL,
      );
      expect(res.allowed).toBe(true);
      expect(res.status).toBe('ALLOWED');
    });

    it('preserves channel independence when one channel is OPTED_OUT and another is OPTED_IN', () => {
      const customer = {
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_OUT,
        smsConsent: ConsentState.UNKNOWN,
      };

      const emailEval = evaluateCustomerConsent(customer, NotificationChannel.EMAIL);
      expect(emailEval.allowed).toBe(true);
      expect(emailEval.status).toBe('ALLOWED');

      const waEval = evaluateCustomerConsent(customer, NotificationChannel.WHATSAPP);
      expect(waEval.allowed).toBe(false);
      expect(waEval.status).toBe('SUPPRESSED');

      const smsEval = evaluateCustomerConsent(customer, NotificationChannel.SMS);
      expect(smsEval.allowed).toBe(false);
      expect(smsEval.status).toBe('SUPPRESSED');
    });

    describe('Voice-Call Structured Consent (Phase 1C.1)', () => {
      it('blocks voice outreach when voiceConsent is UNKNOWN', () => {
        const res = evaluateCustomerConsent(
          { voiceConsent: ConsentState.UNKNOWN },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
        expect(res.reason).toContain('consent state: UNKNOWN');
      });

      it('blocks voice outreach when voiceConsent is OPTED_OUT', () => {
        const res = evaluateCustomerConsent(
          { voiceConsent: ConsentState.OPTED_OUT },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
        expect(res.reason).toContain('explicitly opted out of VOICE communications');
      });

      it('permits voice outreach only when voiceConsent is OPTED_IN and no DND blocks it', () => {
        const res = evaluateCustomerConsent(
          { voiceConsent: ConsentState.OPTED_IN },
          'VOICE',
        );
        expect(res.allowed).toBe(true);
        expect(res.status).toBe('ALLOWED');
      });

      it('never infers voice OPTED_IN from another channel (e.g. Email/WhatsApp OPTED_IN)', () => {
        const res = evaluateCustomerConsent(
          {
            emailConsent: ConsentState.OPTED_IN,
            whatsappConsent: ConsentState.OPTED_IN,
            voiceConsent: ConsentState.UNKNOWN,
          },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
      });

      it('blocks voice outreach when customer has legacy VOICE_ONLY DND', () => {
        const res = evaluateCustomerConsent(
          {
            voiceConsent: ConsentState.OPTED_IN,
            notes: '[OPT_OUT:VOICE - Do not call]',
          },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
        expect(res.reason).toContain('Voice/Phone-specific opt-out directive');
      });

      it('blocks voice outreach when customer has ambiguous legacy DND', () => {
        const res = evaluateCustomerConsent(
          {
            voiceConsent: ConsentState.OPTED_IN,
            notes: '[DND:NO_CONTACT - Requested on 2026-11-02T10:29:00.907Z]',
          },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
        expect(res.reason).toContain('ambiguous historical DND/cease-contact record pending review');
      });

      it('blocks voice outreach when customer has global cease-contact directive', () => {
        const res = evaluateCustomerConsent(
          {
            voiceConsent: ConsentState.OPTED_IN,
            notes: 'Cease contact immediately across all channels',
          },
          'VOICE',
        );
        expect(res.allowed).toBe(false);
        expect(res.status).toBe('SUPPRESSED');
        expect(res.reason).toContain('explicit global cease-contact directive');
      });
    });
  });
});
