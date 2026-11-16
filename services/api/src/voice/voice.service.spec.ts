import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceService } from './voice.service.js';
import { CallsService } from '../calls/calls.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ConsentState } from '../common/consent-policy.js';

describe('VoiceService & CallsService - Cease-Contact & Safety Protection Tests', () => {
  let voiceService: VoiceService;
  let callsService: CallsService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockRecorder: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  let customers: any[];
  let invoices: any[];
  let callSessions: any[];

  const mockUser: AuthUser = {
    userId: 'user_001',
    tenantId: 'tenant_001',
    role: 'AGENT',
  };

  beforeEach(() => {
    customers = [
      {
        id: 'cust_001',
        tenantId: 'tenant_001',
        name: 'Gupta Enterprises',
        company: 'Gupta Enterprises',
        phone: '+919876543210',
        outstandingBalance: 50000,
        notes: 'Initial account notes',
        voiceConsent: ConsentState.OPTED_IN,
      },
    ];

    invoices = [
      {
        id: 'inv_001',
        number: 'INV-2026-001',
        customerId: 'cust_001',
        tenantId: 'tenant_001',
        amount: 50000,
        outstanding: 50000,
        status: 'OVERDUE',
        dueDate: new Date(Date.now() - 7 * 86400000),
      },
    ];

    callSessions = [];

    mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'LIVEKIT_URL') return 'wss://livekit.test.com';
        if (key === 'LIVEKIT_API_KEY') return 'test_api_key';
        if (key === 'LIVEKIT_API_SECRET') return 'test_api_secret_long_enough_123456';
        return null;
      }),
    };

    mockRecorder = {
      startRoomRecording: vi.fn().mockResolvedValue('egress_001'),
      stopRecording: vi.fn().mockResolvedValue(undefined),
      getRecording: vi.fn().mockResolvedValue({ status: 'COMPLETE', url: 'https://cdn.test/rec.mp4' }),
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_001' }),
    };

    mockIntegrations = {
      getRawConfig: vi.fn().mockResolvedValue({}),
      telephony: null, // Outbound calls disabled by policy -> simulates SIP session
    };

    mockPrisma = {
      customer: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            customers.find(
              (c) => c.id === where.id && (where.tenantId === undefined || c.tenantId === where.tenantId),
            ) || null
          );
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const cust = customers.find((c) => c.id === where.id);
          if (cust) {
            Object.assign(cust, data);
            return { ...cust };
          }
          return null;
        }),
      },
      invoice: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            invoices.find(
              (inv) =>
                inv.customerId === where.customerId &&
                (where.tenantId === undefined || inv.tenantId === where.tenantId),
            ) || null
          );
        }),
      },
      callSession: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            callSessions.find(
              (cs) =>
                (!where.id || cs.id === where.id) &&
                (!where.tenantId || cs.tenantId === where.tenantId) &&
                (!where.customerId || cs.customerId === where.customerId),
            ) || null
          );
        }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const cs = {
            id: `call_${Date.now()}`,
            createdAt: new Date(),
            ...data,
          };
          callSessions.push(cs);
          return cs;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const cs = callSessions.find((c) => c.id === where.id);
          if (cs) {
            Object.assign(cs, data);
            return { ...cs };
          }
          return null;
        }),
      },
      paymentPromise: {
        create: vi.fn().mockResolvedValue({ id: 'ptp_001' }),
      },
    };

    voiceService = new VoiceService(mockConfig, mockPrisma, mockRecorder);
    callsService = new CallsService(mockPrisma, mockRecorder, mockAuditLogs, mockIntegrations);
  });

  // ── Cease-Contact in VoiceService ──────────────────────────────────────────
  describe('Cease-Contact Recognition & Persistence in VoiceService', () => {
    it('recognizes direct request "Stop calling me." and ends conversation with NO_CONTACT', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Stop calling me.',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('NO_CONTACT');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.nextStage).toBe('CALL_ENDED');
      expect(turn.actionExecuted).toBe('CEASE_CONTACT_RECORDED');
      expect(turn.reply).toContain('No further calls will be placed');

      // Verify preference was persisted on customer record
      const customer = customers.find((c) => c.id === 'cust_001');
      expect(customer.notes).toContain('[DND:NO_CONTACT');
    });

    it('recognizes equivalent natural-language cease-contact variations without continuing collection prompts', async () => {
      const variations = [
        'Please do not call me again',
        'Cease all contact immediately',
        'Never call this number again',
        'Remove my number from your records',
        'Put me on your do not call list',
        'I refuse to pay, stop contacting me',
      ];

      for (const phrase of variations) {
        // Reset customer notes
        customers[0].notes = 'Standard notes';

        const turn = await voiceService.processTurn(mockUser, {
          customerId: 'cust_001',
          userSpeech: phrase,
          currentStage: 'ASK_FULL_PAYMENT',
        });

        expect(turn.outcome).toBe('NO_CONTACT');
        expect(turn.shouldEnd).toBe(true);
        expect(turn.nextStage).toBe('CALL_ENDED');
        expect(turn.reply).not.toContain('remit');
        expect(turn.reply).not.toContain('payment');
        expect(customers[0].notes).toContain('[DND:NO_CONTACT');
      }
    });

    it('does not falsely claim persistence succeeded if customer is not found or DB fails', async () => {
      // Pass an unknown customerId
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_unknown',
        userSpeech: 'Stop calling me',
        currentStage: 'GREETING_AND_VERIFICATION',
      });

      expect(turn.outcome).toBe('NO_CONTACT');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.nextStage).toBe('CALL_ENDED');
      expect(turn.actionExecuted).toBeUndefined();
      // Should NOT claim records were updated, but advise compliance review
      expect(turn.reply).not.toContain('updated our records accordingly');
      expect(turn.reply).toContain('compliance team will review');
    });

    it('does not treat unclear or temporary unavailability statements as confirmed NO_CONTACT', async () => {
      const unclearStatements = [
        { text: "I can't talk right now, I'm driving", expectedStage: 'CALLBACK_SCHEDULED', expectedOutcome: 'CALLBACK_REQUESTED' },
        { text: 'Please call me back later this afternoon', expectedStage: 'CALLBACK_SCHEDULED', expectedOutcome: 'CALLBACK_REQUESTED' },
        { text: 'I am currently in a meeting', expectedStage: 'CALLBACK_SCHEDULED', expectedOutcome: 'CALLBACK_REQUESTED' },
      ];

      for (const item of unclearStatements) {
        customers[0].notes = 'Standard notes';

        const turn = await voiceService.processTurn(mockUser, {
          customerId: 'cust_001',
          userSpeech: item.text,
          currentStage: 'CONFIRM_BALANCE',
        });

        expect(turn.outcome).toBe(item.expectedOutcome);
        expect(turn.nextStage).toBe(item.expectedStage);
        // Customer notes must NOT have [DND:NO_CONTACT]
        expect(customers[0].notes).not.toContain('[DND:NO_CONTACT]');
      }
    });
  });

  // ── Outbound Call Prevention in CallsService ───────────────────────────────
  describe('Outbound Calling Safety & DND Enforcement in CallsService', () => {
    it('prevents simulated outbound calls when customer has active [DND:NO_CONTACT] preference', async () => {
      // Mark customer as DND
      customers[0].notes = '[DND:NO_CONTACT - Requested on 2026-10-19T18:00:00Z]\nPrevious notes';

      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_001',
          reason: 'Routine Collection Follow-up',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_001',
          reason: 'Routine Collection Follow-up',
        }),
      ).rejects.toThrow('Outbound call suppressed: Customer has an active Do-Not-Contact (cease-contact) preference');

      // No call session should have been created
      expect(callSessions.length).toBe(0);
    });

    it('enforces tenant isolation and throws NotFoundException when initiating call for cross-tenant customer', async () => {
      // Customer in tenant_002
      customers.push({
        id: 'cust_other_tenant',
        tenantId: 'tenant_002',
        name: 'Other Corp',
        phone: '+919999999999',
        notes: '',
        voiceConsent: ConsentState.OPTED_IN,
      });

      // User in tenant_001 attempts to call customer in tenant_002
      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_other_tenant',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_other_tenant',
        }),
      ).rejects.toThrow('Customer not found in tenant');
    });

    it('suppresses outbound call when customer voiceConsent is UNKNOWN', async () => {
      customers[0].notes = 'Regular account notes';
      customers[0].voiceConsent = ConsentState.UNKNOWN;

      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_001',
          reason: 'Follow-up',
        }),
      ).rejects.toThrow('Outbound call suppressed: Customer has not explicitly opted into VOICE communications (consent state: UNKNOWN)');
      expect(callSessions.length).toBe(0);
    });

    it('suppresses outbound call when customer voiceConsent is OPTED_OUT', async () => {
      customers[0].notes = 'Regular account notes';
      customers[0].voiceConsent = ConsentState.OPTED_OUT;

      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_001',
          reason: 'Follow-up',
        }),
      ).rejects.toThrow('Outbound call suppressed: Customer has explicitly opted out of VOICE');
      expect(callSessions.length).toBe(0);
    });

    it('suppresses outbound call when customer notes have ambiguous DND directive', async () => {
      customers[0].notes = 'Old note [DND:NO_CONTACT]';
      customers[0].voiceConsent = ConsentState.OPTED_IN;

      await expect(
        callsService.initiateOutboundCall(mockUser, {
          customerId: 'cust_001',
          reason: 'Follow-up',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(callSessions.length).toBe(0);
    });

    it('allows simulated outbound calls when customer has OPTED_IN consent and no DND restriction', async () => {
      customers[0].notes = 'Regular customer notes without restrictions';
      customers[0].voiceConsent = ConsentState.OPTED_IN;

      const call = await callsService.initiateOutboundCall(mockUser, {
        customerId: 'cust_001',
        reason: 'Payment follow-up',
      });

      expect(call.status).toBe('SIMULATED');
      expect(call.isSimulated).toBe(true);
      expect(call.sessionId).toBeDefined();
      expect(callSessions.length).toBe(1);
    });
  });

  // ── Existing Voice Conversation Regression Tests ─────────────────────────
  describe('Chotu AI Voice Conversation Regression Tests', () => {
    it('handles affirmative greeting and transitions to balance confirmation', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Yes, speaking, this is Rajesh Gupta',
        currentStage: 'GREETING_AND_VERIFICATION',
      });

      expect(turn.nextStage).toBe('CONFIRM_BALANCE');
      expect(turn.shouldEnd).toBe(false);
      expect(turn.reply).toContain('INV-2026-001');
      expect(turn.reply).toContain('₹50,000');
    });

    it('handles dispute objection and logs dispute with high priority', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'There is a serious dispute on invoice amount, goods were defective',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('DISPUTE');
      expect(turn.nextStage).toBe('DISPUTE_LOGGED');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.actionExecuted).toBe('DISPUTE_LOGGED');
    });

    it('handles human manager transfer request immediately', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Let me speak with a human manager please',
        currentStage: 'ASK_FULL_PAYMENT',
      });

      expect(turn.outcome).toBe('TRANSFERRED_TO_AGENT');
      expect(turn.nextStage).toBe('TRANSFERRED_TO_AGENT');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.actionExecuted).toBe('TRANSFERRED_TO_HUMAN_AGENT');
    });

    it('handles refusal to pay without DND registration', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'I refuse to pay this invoice',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('REFUSED_TO_PAY');
      expect(turn.actionExecuted).toBe('REFUSAL_LOGGED');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.reply).toContain('refusal');
      // Must NOT set DND tag in customer notes
      expect(customers[0].notes).not.toContain('[DND:NO_CONTACT]');
    });

    it('handles inability to pay / financial hardship with installment suggestion', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'We are facing a severe cash crunch and have no funds right now',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('UNABLE_TO_PAY');
      expect(turn.actionExecuted).toBe('UNABLE_TO_PAY');
      expect(turn.nextStage).toBe('NEGOTIATE_AMOUNT');
      expect(turn.shouldEnd).toBe(false);
      expect(turn.reply).toContain('installment plan');
    });

    it('handles payment claim with UTR reference for priority reconciliation', async () => {
      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'We already paid this yesterday via NEFT UTR: 9988776655',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('PAYMENT_CLAIMED');
      expect(turn.actionExecuted).toBe('PAYMENT_CLAIM_LOGGED');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.extractedData.claimedUtrOrRef).toBe('9988776655');
      expect(turn.reply).toContain('priority reconciliation');
    });

    it('answers invoice and payment questions dynamically without terminating call', async () => {
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'What is this for and when was this due?',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn1.outcome).toBe('IN_PROGRESS');
      expect(turn1.shouldEnd).toBe(false);
      expect(turn1.reply).toContain('INV-2026-001');

      const turn2 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'How can I pay, what are your payment options?',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn2.outcome).toBe('IN_PROGRESS');
      expect(turn2.shouldEnd).toBe(false);
      expect(turn2.reply).toContain('UPI');
    });

    it('records promise ONLY when explicitly confirmed in SUMMARIZE_COMMITMENT', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      // 1. Customer does NOT confirm -> No promise recorded, reverts to ASK_PAYMENT_DATE
      const rejectTurn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'No, wait, let me check with our finance director',
        currentStage: 'SUMMARIZE_COMMITMENT',
        extractedData: { agreedAmount: '₹50,000', promisedDate: 'Friday', paymentMethod: 'UPI' },
      });

      expect(rejectTurn.nextStage).toBe('ASK_PAYMENT_DATE');
      expect(rejectTurn.shouldEnd).toBe(false);
      expect(promiseCreateSpy).not.toHaveBeenCalled();

      // 2. Customer explicitly confirms -> Promise recorded in DB
      const confirmTurn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Yes, I confirm that commitment',
        currentStage: 'SUMMARIZE_COMMITMENT',
        extractedData: { agreedAmount: '₹50,000', promisedDate: 'Friday', paymentMethod: 'UPI' },
      });

      expect(confirmTurn.outcome).toBe('PROMISE_TO_PAY');
      expect(confirmTurn.shouldEnd).toBe(false);
      expect(confirmTurn.nextStage).toBe('CLOSING');
      expect(confirmTurn.actionExecuted).toBe('RECORD_PAYMENT_PROMISE');
      expect(promiseCreateSpy).toHaveBeenCalledTimes(1);
    });

    it('retains multi-turn conversation memory history', async () => {
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'What is the balance?',
        currentStage: 'GREETING_AND_VERIFICATION',
      });

      const turn2 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'We will pay next Friday',
        currentStage: 'ASK_PAYMENT_DATE',
        extractedData: turn1.extractedData,
      });

      expect(turn2.extractedData.history.length).toBe(4); // 2 customer + 2 agent turns
      expect(turn2.extractedData.history[0].role).toBe('customer');
      expect(turn2.extractedData.history[1].role).toBe('agent');
    });

    it('handles hardship flow properly: empathy first, separates tentative timeframe from agreed amount', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      // Turn 1: Customer says "I can't pay anything"
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: "I can't pay anything",
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn1.outcome).toBe('UNABLE_TO_PAY');
      expect(turn1.shouldEnd).toBe(false);
      expect(turn1.extractedData.canPay).toBe('NO');
      expect(turn1.reply).toContain('financial situation');
      expect(turn1.reply).not.toContain('₹20');

      // Turn 2: Customer says "20 days from now"
      const turn2 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: '20 days from now',
        currentStage: turn1.nextStage,
        extractedData: turn1.extractedData,
      });

      // Must be tentative timeframe, NOT agreedAmount or promisedDate
      expect(turn2.extractedData.tentativeTimeframe).toBe('20 days from now');
      expect(turn2.extractedData.agreedAmount).toBeFalsy();
      expect(turn2.outcome).toBe('IN_PROGRESS');
      expect(turn2.reply).toContain('20 days from now');

      // Turn 3: Customer explains delay: "financial issue"
      const turn3 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'financial issue',
        currentStage: turn2.nextStage,
        extractedData: turn2.extractedData,
      });

      expect(turn3.extractedData.hardshipReason).toBe('financial issue');
      expect(turn3.reply).toContain('financial hardship');
      expect(turn3.reply).toContain('payment method');

      // Turn 4: Customer mentions preferred channel: "UPI"
      const turn4 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'UPI',
        currentStage: turn3.nextStage,
        extractedData: turn3.extractedData,
      });

      expect(turn4.extractedData.paymentMethod).toBe('UPI');
      expect(turn4.outcome).not.toBe('PROMISE_TO_PAY');
      expect(promiseCreateSpy).not.toHaveBeenCalled();

      // Turn 5: Even if confirmation stage is reached, it should NOT record a promise
      const turn5 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Yes, okay',
        currentStage: 'SUMMARIZE_COMMITMENT',
        extractedData: turn4.extractedData,
      });

      expect(turn5.outcome).toBe('UNABLE_TO_PAY');
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('cancels commitment proposal if customer rejects during confirmation', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'No, I cannot commit to that date right now',
        currentStage: 'SUMMARIZE_COMMITMENT',
        extractedData: {
          agreedAmount: '₹50,000',
          promisedDate: 'Friday',
          paymentMethod: 'UPI',
          awaitingConfirmation: true,
        },
      });

      expect(turn.extractedData.commitmentStatus).toBe('REJECTED');
      expect(turn.extractedData.agreedAmount).toBeNull();
      expect(turn.extractedData.promisedDate).toBeNull();
      expect(turn.outcome).toBe('IN_PROGRESS');
      expect(turn.nextStage).toBe('ASK_PAYMENT_DATE');
      expect(turn.reply).toContain('cancelled that proposal');
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('cancels previously confirmed commitment if customer withdraws it', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'Cancel that payment, I cannot pay Friday anymore',
        currentStage: 'CONFIRM_BALANCE',
        extractedData: {
          commitmentStatus: 'CONFIRMED',
          agreedAmount: '₹50,000',
          promisedDate: 'Friday',
        },
      });

      expect(turn.extractedData.commitmentStatus).toBe('CANCELLED');
      expect(turn.extractedData.agreedAmount).toBeNull();
      expect(turn.extractedData.promisedDate).toBeNull();
      expect(turn.outcome).toBe('IN_PROGRESS');
      expect(turn.nextStage).toBe('ASK_PAYMENT_DATE');
      expect(turn.reply).toContain('withdrawal of that payment schedule');
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('handles callback requests and schedules reminder without creating promise', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: "Can you call me back later? I am in a meeting right now",
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('CALLBACK_REQUESTED');
      expect(turn.shouldEnd).toBe(false); // Unspecified callback time keeps listening so customer can specify time or change mind
      expect(turn.nextStage).toBe('CALLBACK_SCHEDULED');
      expect(turn.actionExecuted).toBe('CALLBACK_REQUESTED');
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('handles future payment intention ("I will pay later") as WILL_PAY_LATER without premature promise', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: "I will pay later next Friday",
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('WILL_PAY_LATER');
      expect(turn.shouldEnd).toBe(false);
      expect(turn.extractedData.willPayLater).toBe(true);
      expect(turn.extractedData.tentativeTimeframe).toBe('Friday');
      // Must not falsely create a payment promise!
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('handles inability to pay ("can\'t pay anything") as UNABLE_TO_PAY', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: "I can't pay anything right now due to business loss",
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('UNABLE_TO_PAY');
      expect(turn.extractedData.canPay).toBe('NO');
      expect(turn.shouldEnd).toBe(false);
      expect(promiseCreateSpy).not.toHaveBeenCalled();
    });

    it('handles explicit payment commitment with valid date and amount', async () => {
      const promiseCreateSpy = vi.fn().mockResolvedValue({ id: 'promise_001' });
      mockPrisma.paymentPromise = { create: promiseCreateSpy };

      const turn = await voiceService.processTurn(mockUser, {
        customerId: 'cust_001',
        userSpeech: 'I will pay ₹50,000 next Friday via UPI',
        currentStage: 'CONFIRM_BALANCE',
      });

      expect(turn.outcome).toBe('PROMISE_TO_PAY');
      expect(turn.shouldEnd).toBe(true);
      expect(turn.extractedData.agreedAmount).toBe('₹50,000');
      expect(turn.extractedData.promisedDate).toBe('Friday');
      expect(turn.extractedData.paymentMethod).toBe('UPI');
      expect(turn.extractedData.commitmentStatus).toBe('CONFIRMED');
      expect(promiseCreateSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Speech Synthesis & Loudness Balance Regression Tests ─────────────────
  describe('Chotu AI Voice Speech Synthesis Tests', () => {
    it('returns valid audio buffer for spoken text', async () => {
      const buffer = await voiceService.synthesizeSpeech('Namaste! This is Chotu calling from myCashflo.');
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    }, 15000);

    it('returns empty buffer for empty utterance', async () => {
      const buffer = await voiceService.synthesizeSpeech('');
      expect(buffer).toBeDefined();
      expect(buffer.length).toBe(0);
    });

    it('generates valid fallback audio with WAV header if upstream fails or offline', async () => {
      // Test fallback audio generator directly
      const fallback = (voiceService as any).generateFallbackAudio(100);
      expect(fallback).toBeInstanceOf(Buffer);
      expect(fallback.length).toBeGreaterThan(44);
      // Verify RIFF and WAVE header tags
      expect(fallback.toString('ascii', 0, 4)).toBe('RIFF');
      expect(fallback.toString('ascii', 8, 12)).toBe('WAVE');
      expect(fallback.toString('ascii', 12, 16)).toBe('fmt ');
      expect(fallback.toString('ascii', 36, 40)).toBe('data');
    });
  });
});


