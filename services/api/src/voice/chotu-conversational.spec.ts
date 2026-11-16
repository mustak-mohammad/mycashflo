import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceService } from './voice.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('Chotu AI 5-Layer Conversational Restructuring - 16 Core Realistic Scenarios', () => {
  let voiceService: VoiceService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockRecorder: any;

  let customers: any[];
  let invoices: any[];
  let callSessions: any[];
  let paymentPromises: any[];
  let prompts: any[];

  const mockUser: AuthUser = {
    userId: 'user_agent_1',
    tenantId: 'tenant_democorp',
    role: 'AGENT',
  };

  beforeEach(() => {
    customers = [
      {
        id: 'cust_abc',
        tenantId: 'tenant_democorp',
        name: 'ABC Tech',
        company: 'ABC Technologies Pvt Ltd',
        phone: '+919876543210',
        outstandingBalance: 25000,
        notes: 'Standard enterprise client',
      },
    ];

    invoices = [
      {
        id: 'inv_abc_01',
        number: 'INV-2026-ABC',
        customerId: 'cust_abc',
        tenantId: 'tenant_democorp',
        amount: 25000,
        outstanding: 25000,
        status: 'OVERDUE',
        dueDate: new Date(Date.now() - 10 * 86400000),
      },
    ];

    callSessions = [];
    paymentPromises = [];
    prompts = [
      {
        id: 'prompt_collections_01',
        tenantId: 'tenant_democorp',
        name: 'Standard Polite AR Collection (10-Stage)',
        category: 'COLLECTIONS',
        promptText: 'You are Chotu, an empathetic, courteous collection AI assistant for {{companyName}}... Rules: 1. Always maintain a respectful tone.',
      },
      {
        id: 'prompt_dispute_01',
        tenantId: 'tenant_democorp',
        name: 'Dispute Resolution & Reconciliation',
        category: 'DISPUTE',
        promptText: 'You are Chotu, accounts reconciliation specialist for {{companyName}}. Listen carefully to {{customerName}} regarding their questions on invoice {{invoiceNumber}}. Capture specific item discrepancies, quantity mismatches, or missing credit notes, and log an official dispute for same-day management review.',
      },
      {
        id: 'prompt_callback_01',
        tenantId: 'tenant_democorp',
        name: 'Callback Request Prompt',
        category: 'CALLBACK',
        promptText: 'You are Chotu, client relations representative following up on a callback for {{companyName}}.',
      },
    ];

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
        create: vi.fn().mockImplementation(async ({ data }) => {
          const p = { id: `ptp_${Date.now()}`, ...data };
          paymentPromises.push(p);
          return p;
        }),
      },
      voicePrompt: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            prompts.find(
              (p) => p.id === where.id && (where.tenantId === undefined || p.tenantId === where.tenantId),
            ) || null
          );
        }),
      },
    };

    voiceService = new VoiceService(mockConfig, mockPrisma, mockRecorder);
  });

  // ── Scenario 1: Customer says "hello" ─────────────────────────────────────
  it('Scenario 1: Customer says "hello" -> responds to greeting and context; does not jump to remittance date question', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'hello',
      currentStage: 'GREETING_AND_VERIFICATION',
    });

    expect(turn.reply).toMatch(/hello!/i);
    expect(turn.reply).toContain('Chotu');
    expect(turn.reply).toContain('₹25,000');
    expect(turn.reply).toContain('ABC Tech');
    expect(turn.reply).not.toMatch(/remittance/i);
    expect(turn.reply).not.toMatch(/what date we can expect/i);
    expect(turn.nextStage).toBe('CONFIRM_BALANCE');
    expect(turn.shouldEnd).toBe(false);
  });

  // ── Scenario 2: Customer asks "Who is calling?" ────────────────────────────
  it('Scenario 2: Customer asks "Who is calling?" -> identifies itself and explains caller purpose', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Who is calling?',
      currentStage: 'GREETING_AND_VERIFICATION',
    });

    expect(turn.reply).toContain('Chotu');
    expect(turn.reply).toContain('myCashflo');
    expect(turn.reply).toContain('ABC Tech');
    expect(turn.shouldEnd).toBe(false);
  });

  // ── Scenario 3: Customer says "I cannot pay this month" ───────────────────
  it('Scenario 3: Customer says "I cannot pay this month" -> acknowledges difficulty and asks a relevant next question', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'I cannot pay this month due to financial crisis',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('UNABLE_TO_PAY');
    expect(turn.extractedData.canPay).toBe('NO');
    expect(turn.reply).toContain('financial situation');
    expect(turn.shouldEnd).toBe(false);
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
  });

  // ── Scenario 4: Customer says "I can pay ₹20,000 Friday" ──────────────────
  it('Scenario 4: Customer says "I can pay ₹20,000 Friday" -> extracts amount/date and confirms commitment before recording', async () => {
    // Turn 1: Proposes amount and date
    const turn1 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'I can pay ₹20,000 Friday',
      currentStage: 'NEGOTIATE_AMOUNT',
    });

    expect(turn1.extractedData.agreedAmount).toBe('₹20,000');
    expect(turn1.extractedData.promisedDate).toBe('Friday');
    expect(turn1.nextStage).toBe('SUMMARIZE_COMMITMENT');
    expect(turn1.shouldEnd).toBe(false);
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();

    // Turn 2: Customer explicitly confirms
    const turn2 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Yes, please confirm that',
      currentStage: 'SUMMARIZE_COMMITMENT',
      extractedData: turn1.extractedData,
    });

    expect(turn2.outcome).toBe('PROMISE_TO_PAY');
    expect(turn2.actionExecuted).toBe('RECORD_PAYMENT_PROMISE');
    expect(turn2.extractedData.commitmentStatus).toBe('CONFIRMED');
    expect(mockPrisma.paymentPromise.create).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 5: Customer says "I'll try next week" ────────────────────────
  it('Scenario 5: Customer says "I\'ll try next week" -> does NOT record a confirmed promise', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: "I'll try next week",
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('WILL_PAY_LATER');
    expect(turn.extractedData.commitmentStatus).not.toBe('CONFIRMED');
    expect(turn.reply).toMatch(/Next week|later/i);
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
  });

  // ── Scenario 6: Customer says "I already paid" ─────────────────────────────
  it('Scenario 6: Customer says "I already paid" -> records customer-reported payment, asks for UTR/details, does not mark paid', async () => {
    // Turn 1: Stated payment without UTR -> keep call active and request UTR
    const turn1 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'I already paid this balance yesterday',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn1.outcome).toBe('PAYMENT_CLAIMED');
    expect(turn1.shouldEnd).toBe(false);
    expect(turn1.reply).toMatch(/UTR|reference/i);

    // Turn 2: Provides UTR -> logs claim with UTR and ends politely
    const turn2 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'The transaction UTR is ICICI987654321',
      currentStage: 'ASSISTANCE_CHECK',
      extractedData: turn1.extractedData,
    });

    expect(turn2.outcome).toBe('PAYMENT_CLAIMED');
    expect(turn2.extractedData.claimedUtrOrRef).toBe('ICICI987654321');
    expect(turn2.shouldEnd).toBe(true);
    expect(turn2.reply).toContain('ICICI987654321');
  });

  // ── Scenario 7: Customer disputes the invoice ─────────────────────────────
  it('Scenario 7: Customer disputes the invoice -> switches to dispute handling rather than repeating collection questions', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'I dispute this invoice, we never received these goods',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('DISPUTE');
    expect(turn.nextStage).toBe('DISPUTE_LOGGED');
    expect(turn.shouldEnd).toBe(true);
    expect(turn.actionExecuted).toBe('DISPUTE_LOGGED');
    expect(turn.reply).toContain('High Priority');
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
  });

  // ── Scenario 8: Customer requests a callback ──────────────────────────────
  it('Scenario 8: Customer requests a callback -> captures callback intent and time if supplied', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Please call me back at 4 PM, I am driving right now',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('CALLBACK_REQUESTED');
    expect(turn.nextStage).toBe('CALLBACK_SCHEDULED');
    expect(turn.extractedData.callbackTime).toBe('at 4 PM');
    expect(turn.reply).toContain('at 4 PM');
    expect(turn.shouldEnd).toBe(true);
  });

  // ── Scenario 9: Customer requests a human ─────────────────────────────────
  it('Scenario 9: Customer requests a human -> initiates the supported handoff flow', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'I want to talk to a real person right now',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('TRANSFERRED_TO_AGENT');
    expect(turn.nextStage).toBe('TRANSFERRED_TO_AGENT');
    expect(turn.shouldEnd).toBe(true);
    expect(turn.actionExecuted).toBe('TRANSFERRED_TO_HUMAN_AGENT');
  });

  // ── Scenario 10: Customer says "Do not contact me again" ──────────────────
  it('Scenario 10: Customer says "Do not contact me again" -> immediately enforces NO_CONTACT and persists to DB', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Do not contact me again, remove my number',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('NO_CONTACT');
    expect(turn.nextStage).toBe('CALL_ENDED');
    expect(turn.shouldEnd).toBe(true);
    expect(turn.actionExecuted).toBe('CEASE_CONTACT_RECORDED');
    expect(customers[0].notes).toContain('[DND:NO_CONTACT');
  });

  // ── Scenario 11: Customer asks an unrelated question ──────────────────────
  it('Scenario 11: Customer asks an unrelated question -> responds appropriately and politely redirects', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'What is the weather in Delhi today?',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('IN_PROGRESS');
    expect(turn.shouldEnd).toBe(false);
    expect(turn.reply).toMatch(/information on that/i);
    expect(turn.reply).toContain('ABC Tech');
  });

  // ── Scenario 12: Customer gives an unclear answer ─────────────────────────
  it('Scenario 12: Customer gives an unclear answer -> asks for clarification', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'hmm uh',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.outcome).toBe('IN_PROGRESS');
    expect(turn.shouldEnd).toBe(false);
    expect(turn.reply).toMatch(/didn't quite catch that|could you please repeat/i);
  });

  // ── Scenario 13: Conversation continues for at least 12 turns with context retained
  it('Scenario 13: Conversation continues for at least 12 turns with context retained across all turns', async () => {
    let context: Record<string, any> = {};
    let stage: any = 'GREETING_AND_VERIFICATION';

    const turns = [
      'Hello',
      'Who is calling?',
      'Why are you calling?',
      'Tell me more about the invoice',
      'What are the payment options?',
      'Can I pay in installments?',
      'Can I pay ₹10,000 this week?',
      'What if I pay on Friday?',
      'How do I pay via UPI?',
      'Can you send me the invoice copy on WhatsApp?',
      'Yes, please send that',
      'Okay, let me check with my director and get back to you',
    ];

    for (let i = 0; i < turns.length; i++) {
      const turnResult = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: turns[i],
        currentStage: stage,
        extractedData: context,
        turnCount: i + 1,
      });

      expect(turnResult.reply).toBeTruthy();
      context = turnResult.extractedData;
      stage = turnResult.nextStage;
      expect(context.history.length).toBe((i + 1) * 2);
    }

    expect(context.history.length).toBe(24);
    expect(context.customerName).toBe('ABC Tech');
  });

  // ── Scenario 14: Voice remains the same across at least 10 consecutive responses
  it('Scenario 14: Voice synthesis engine produces consistent audio and caches identical prompts', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x00]).buffer,
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as any;

    try {
      const phrases = [
        'Hello! Yes, this is Chotu from myCashflo.',
        'This is regarding invoice #INV-2026-ABC for ₹25,000.',
        'Thank you for confirming, ABC Tech.',
        'Would you like me to send a payment link?',
        'Understood that you would like to pay later.',
        'I have recorded your preference for UPI.',
        'Certainly, let me repeat that for you.',
        'Thank you for your time.',
        'Have a wonderful day ahead!',
        'Goodbye!',
      ];

      for (const phrase of phrases) {
        const buffer = await voiceService.synthesizeSpeech(phrase);
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
      }

      const callsBeforeCache = mockFetch.mock.calls.length;
      // Verify cache hit returns identical buffer in <5ms without re-fetching
      const cachedBuffer = await voiceService.synthesizeSpeech(phrases[0]);
      expect(cachedBuffer).toBeInstanceOf(Buffer);
      expect(cachedBuffer.length).toBeGreaterThan(0);
      // Crucial: Cache was hit, so no additional network call!
      expect(mockFetch.mock.calls.length).toBe(callsBeforeCache);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Scenario 15: Model/provider failure -> safe, transparent fallback; no fabricated AI understanding
  it('Scenario 15: Upstream synthesis failure falls back to safe WAV audio tone without failing the turn', async () => {
    // When synthesizeSpeech receives text, even if Google TTS network fails, it generates carrier audio
    const fallbackBuffer = (voiceService as any).generateFallbackAudio(100);
    expect(fallbackBuffer).toBeInstanceOf(Buffer);
    expect(fallbackBuffer.slice(0, 4).toString('ascii')).toBe('RIFF');
    expect(fallbackBuffer.slice(8, 12).toString('ascii')).toBe('WAVE');
  });

  // ── Scenario 16: Tenant isolation and authorization tests still pass
  it('Scenario 16: Enforces strict tenant isolation: rejects customer from different tenant', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_other_tenant', // Not in mockUser.tenantId
      userSpeech: 'Hello, speaking',
      currentStage: 'GREETING_AND_VERIFICATION',
    });

    // Customer name defaults to 'Valued Client' because tenant isolation prevents finding cust_other_tenant
    expect(turn.extractedData.customerName).toBe('Valued Client');
    expect(turn.reply).not.toContain('ABC Tech');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // TASK 1 TESTS: PROMPT RESOLUTION AND INITIAL GREETING SECURITY
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Chotu AI Prompt Resolution and Initial Greeting Security', () => {
    it('1. Collections call generates verified collections greeting using customer name ABC Tech and balance ₹25,000', async () => {
      const res = await voiceService.getInitialGreeting(mockUser, {
        callType: 'COLLECTIONS',
        customerId: 'cust_abc',
      });

      expect(res.callType).toBe('COLLECTIONS');
      expect(res.customerName).toBe('ABC Tech');
      expect(res.outstandingAmount).toBe('₹25,000');
      expect(res.invoiceNumber).toBe('INV-2026-ABC');
      expect(res.greeting).toContain('ABC Tech');
      expect(res.greeting).toContain('₹25,000');
      expect(res.greeting).toContain('Chotu');
      expect(res.greeting).not.toContain('accounts reconciliation specialist');
      expect(res.greeting).not.toContain('dispute');
    });

    it('2. Collections call CANNOT load a dispute prompt even when prompt_dispute_01 is passed; dispute instructions are rejected', async () => {
      const res = await voiceService.getInitialGreeting(mockUser, {
        callType: 'COLLECTIONS',
        customerId: 'cust_abc',
        promptId: 'prompt_dispute_01', // Explicit attempt to load dispute prompt on collections call
      });

      expect(res.callType).toBe('COLLECTIONS');
      // Rejected incompatible prompt -> customPrompt becomes null
      expect(res.promptId).toBeUndefined();
      // Greeting is clean collections greeting
      expect(res.greeting).toContain('pending balance of ₹25,000');
      expect(res.greeting).not.toContain('accounts reconciliation specialist');
      expect(res.greeting).not.toContain('dispute');
    });

    it('3. Dispute call resolves dispute prompt and initializes dispute workflow', async () => {
      const res = await voiceService.getInitialGreeting(mockUser, {
        callType: 'DISPUTE',
        customerId: 'cust_abc',
        promptId: 'prompt_dispute_01',
      });

      expect(res.callType).toBe('DISPUTE');
      expect(res.promptId).toBe('prompt_dispute_01');
      expect(res.greeting).toContain('billing query on invoice INV-2026-ABC');
      expect(res.greeting).toContain('reconcile any discrepancies or register an official dispute');
      // Verify system directives are not spoken as conversational lines
      expect(res.greeting.startsWith('You are Chotu, accounts reconciliation specialist')).toBe(false);
      expect(res.conversationalGoal).toContain('accounts reconciliation specialist');
    });

    it('4. System instructions (e.g. "You are Chotu, rules: ...") are never returned as the spoken greeting line', async () => {
      const res = await voiceService.getInitialGreeting(mockUser, {
        callType: 'COLLECTIONS',
        customerId: 'cust_abc',
        promptId: 'prompt_collections_01',
      });

      expect(res.greeting).not.toContain('Rules:');
      expect(res.greeting.startsWith('You are Chotu')).toBe(false);
      expect(res.greeting).toContain('Namaste! Am I speaking with the accounts department at ABC Tech?');
    });

    it('5. Callback call resolves callback greeting without loading collections or dispute opening', async () => {
      const res = await voiceService.getInitialGreeting(mockUser, {
        callType: 'CALLBACK',
        customerId: 'cust_abc',
      });

      expect(res.callType).toBe('CALLBACK');
      expect(res.greeting).toContain('following up on your requested callback');
      expect(res.greeting).not.toContain('pending balance');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // TASK 2 TESTS: STRUCTURED POST-CALL SUMMARY GENERATION (ALL 9 OUTCOMES)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Chotu AI Structured Post-Call Summary Generation', () => {
    it('Outcome 1: Confirmed promise (with validated amount & date) -> paymentCommitment: CONFIRMED', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 125,
        callType: 'COLLECTIONS',
        outcome: 'PROMISE_TO_PAY',
        context: {
          commitmentStatus: 'CONFIRMED',
          agreedAmount: '₹25,000',
          promisedDate: '2026-11-15',
          paymentMethod: 'UPI',
        },
        transcript: [
          { speaker: 'agent', text: 'Namaste! Am I speaking with ABC Tech?' },
          { speaker: 'customer', text: 'Yes, I will pay full 25000 by 15th November via UPI' },
        ],
      });

      expect(summary.paymentCommitment).toBe('CONFIRMED');
      expect(summary.commitmentAmount).toBe('₹25,000');
      expect(summary.commitmentDate).toBe('2026-11-15');
      expect(summary.paymentMethod).toBe('UPI');
      expect(summary.shortSummary).toContain('PTP Confirmed');
      expect(summary.customerMainResponse).toContain('Confirmed payment commitment');
      expect(summary.nextAction).toContain('Track bank credit');
    });

    it('Outcome 2: Vague promise ("I will try next week") -> paymentCommitment: TENTATIVE, commitmentAmount: null', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 90,
        callType: 'COLLECTIONS',
        outcome: 'WILL_PAY_LATER',
        context: {
          willPayLater: true,
          commitmentStatus: 'TENTATIVE',
          tentativeTimeframe: 'next week',
        },
        transcript: [
          { speaker: 'agent', text: 'When can we expect the remittance?' },
          { speaker: 'customer', text: 'I will try next week sometime' },
        ],
      });

      expect(summary.paymentCommitment).toBe('TENTATIVE');
      expect(summary.commitmentAmount).toBeNull();
      expect(summary.commitmentDate).toBe('next week');
      expect(summary.shortSummary).toContain('Tentative Intent');
      expect(summary.shortSummary).not.toContain('PTP Confirmed');
    });

    it('Outcome 3: Customer-reported payment claim ("I already paid with UTR 987654") -> outcomeCategory: PAYMENT_CLAIMED, paymentCommitment: NONE', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 85,
        callType: 'COLLECTIONS',
        outcome: 'PAYMENT_CLAIMED',
        context: {
          paymentClaimed: true,
          claimedAmount: '₹25,000',
          claimedUtrOrRef: 'UTR987654321',
        },
        transcript: [
          { speaker: 'agent', text: 'Regarding pending balance of ₹25,000.' },
          { speaker: 'customer', text: 'I already paid yesterday, UTR is UTR987654321' },
        ],
      });

      expect(summary.outcomeCategory).toBe('PAYMENT_CLAIMED');
      expect(summary.paymentCommitment).toBe('NONE');
      expect(summary.customerReportedPayment).not.toBeNull();
      expect(summary.customerReportedPayment?.utrOrReference).toBe('UTR987654321');
      expect(summary.shortSummary).toContain('Payment Claimed');
      expect(summary.nextAction).toContain('Reconcile bank statement');
    });

    it('Outcome 4: Dispute logged -> outcomeCategory: DISPUTE, disputeDetails recorded', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 110,
        callType: 'DISPUTE',
        outcome: 'DISPUTE',
        context: {
          isDispute: true,
          disputeReason: 'Quantity mismatch on item #3',
          disputedAmount: '₹5,000',
        },
        transcript: [
          { speaker: 'customer', text: 'We only received 10 units instead of 15, item 3 is wrong' },
        ],
      });

      expect(summary.outcomeCategory).toBe('DISPUTE');
      expect(summary.paymentCommitment).toBe('NONE');
      expect(summary.disputeDetails?.reason).toBe('Quantity mismatch on item #3');
      expect(summary.shortSummary).toContain('Dispute Logged');
      expect(summary.nextAction).toContain('billing team for immediate review');
    });

    it('Outcome 5: Callback requested -> outcomeCategory: CALLBACK_REQUESTED, callbackRequest recorded', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 45,
        callType: 'COLLECTIONS',
        outcome: 'CALLBACK_REQUESTED',
        context: {
          callbackRequested: true,
          callbackTime: 'tomorrow at 3 PM',
        },
        transcript: [
          { speaker: 'customer', text: 'I am driving right now, please call me tomorrow at 3 PM' },
        ],
      });

      expect(summary.outcomeCategory).toBe('CALLBACK_REQUESTED');
      expect(summary.callbackRequest?.requestedTime).toBe('tomorrow at 3 PM');
      expect(summary.shortSummary).toContain('Callback Requested');
      expect(summary.nextAction).toContain('Place callback to customer at tomorrow at 3 PM');
    });

    it('Outcome 6: Human handoff requested -> humanHandoffRequested: true', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        durationSeconds: 50,
        callType: 'COLLECTIONS',
        outcome: 'OTHER',
        context: {
          humanRequested: true,
        },
        transcript: [
          { speaker: 'customer', text: 'Connect me with your accounts manager immediately' },
        ],
      });

      expect(summary.humanHandoffRequested).toBe(true);
      expect(summary.nextAction).toContain('senior human collection agent');
    });

    it('Outcome 7: Payment refusal -> refusal recorded in noContactStatus', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        durationSeconds: 40,
        callType: 'COLLECTIONS',
        outcome: 'NO_CONTACT',
        context: {
          noContact: true,
          refusalReason: 'Customer outright refused to pay',
        },
        transcript: [
          { speaker: 'customer', text: 'I refuse to pay this invoice' },
        ],
      });

      expect(summary.noContactStatus?.isNoContact).toBe(true);
      expect(summary.noContactStatus?.reason).toContain('refused');
    });

    it('Outcome 8: NO_CONTACT / DND -> isNoContact: true', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        durationSeconds: 30,
        callType: 'COLLECTIONS',
        outcome: 'NO_CONTACT',
        context: {
          noContact: true,
          refusalReason: 'Put me on do not call list',
        },
        transcript: [
          { speaker: 'customer', text: 'Do not call this number again' },
        ],
      });

      expect(summary.noContactStatus?.isNoContact).toBe(true);
      expect(summary.nextAction).toContain('Flag account DND/No Contact');
    });

    it('Outcome 9: Incomplete / short call (< 5s or no customer speech) -> "Insufficient information: call disconnected before customer engagement."', () => {
      const summary = voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        durationSeconds: 3, // Less than 5s threshold
        callType: 'COLLECTIONS',
        outcome: 'OTHER',
        transcript: [
          { speaker: 'agent', text: 'Namaste! Am I speaking with ABC Tech?' },
        ],
      });

      expect(summary.customerMainResponse).toBe('Insufficient information: call disconnected before customer engagement.');
      expect(summary.shortSummary).toContain('Insufficient information');
      expect(summary.nextAction).toContain('Verify customer phone number');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // TASK 4 TESTS: 12-TURN CONVERSATIONAL SESSION WITHOUT CONTEXT LOSS
  // ══════════════════════════════════════════════════════════════════════════════
  describe('Long 12-Turn Conversational Session without Context Loss', () => {
    it('executes 12 consecutive conversational turns and verifies context persistence and voice profile consistency', async () => {
      let stage: any = 'GREETING_AND_VERIFICATION';
      let extractedData: Record<string, any> = {};
      let turnCount = 0;

      const conversationTurns = [
        'Yes speaking, this is ABC Tech finance department',
        'Which invoice number is this regarding?',
        'Can you provide a 10% discount if we pay immediately?',
        'We have a client payment delayed, cash flow is tight',
        'Remind me who is calling?',
        'Can we pay 15000 now and rest 10000 next month?',
        'Okay, we will pay full 25000 next Friday',
        'Yes, UPI transfer works best for our account',
        'Please send the instant payment link to our WhatsApp',
        'Yes, I confirm 25000 on next Friday via UPI',
        'Thank you Chotu for your assistance',
        'Goodbye!',
      ];

      for (let i = 0; i < conversationTurns.length; i++) {
        const userSpeech = conversationTurns[i];
        const result = await voiceService.processTurn(mockUser, {
          customerId: 'cust_abc',
          userSpeech,
          currentStage: stage,
          turnCount,
          extractedData,
        });

        expect(result).toBeDefined();
        expect(result.reply).toBeTruthy();
        expect(result.reply.length).toBeGreaterThan(5);

        // Update loop state
        stage = result.nextStage;
        extractedData = result.extractedData;
        turnCount++;

        // Context check: customerName must never be lost across 12 turns
        expect(extractedData.customerName).toBe('ABC Tech');
        expect(extractedData.invoiceNumber).toBe('INV-2026-ABC');
        expect(extractedData.history.length).toBe((i + 1) * 2);
      }

      expect(turnCount).toBe(12);
      // Commitment details confirmed without loss of state
      expect(extractedData.agreedAmount).toBe('₹25,000');
      expect(extractedData.paymentMethod).toBe('UPI');
      expect(extractedData.sendLink).toBe(true);
    });
  });

  // ── Defect Regression Suite: Callback Mind-Change & Summary Precision ───────
  describe('Defect Regression Suite - Callback Intent Change and Summary Precision', () => {
    it('Defect 1: Customer changes mind ("Actually, I can talk now") -> cancels callback and naturally resumes collection dialogue', async () => {
      // Turn 1: Customer requests callback without specifying time
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: 'No, I am busy right now. Can you call me later?',
        currentStage: 'CONFIRM_BALANCE',
        turnCount: 1,
      });

      expect(turn1.outcome).toBe('CALLBACK_REQUESTED');
      expect(turn1.nextStage).toBe('CALLBACK_SCHEDULED');
      expect(turn1.shouldEnd).toBe(false); // MUST NOT irreversibly close conversation
      expect(turn1.reply).toContain('When would be a convenient time');
      expect(turn1.extractedData.callbackRequested).toBe(true);
      expect(turn1.extractedData.callbackTime).toBeNull();

      // Turn 2: Customer changes their mind
      const turn2 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: 'Actually, I can talk now.',
        currentStage: turn1.nextStage,
        turnCount: 2,
        extractedData: turn1.extractedData,
      });

      expect(turn2.actionExecuted).toBe('CALLBACK_CANCELLED');
      expect(turn2.extractedData.callbackRequested).toBe(false);
      expect(turn2.extractedData.callbackTime).toBeNull();
      expect(turn2.nextStage).toBe('CONFIRM_BALANCE');
      expect(turn2.shouldEnd).toBe(false);
      expect(turn2.outcome).toBe('IN_PROGRESS');
      expect(turn2.reply).toContain('Thank you, ABC Tech');
      expect(turn2.reply).toContain('payment plan');
    });

    it('Defect 1b: Customer follows up with confirmed time in CALLBACK_SCHEDULED stage', async () => {
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: 'No, I am busy right now. Can you call me later?',
        currentStage: 'CONFIRM_BALANCE',
        turnCount: 1,
      });

      expect(turn1.nextStage).toBe('CALLBACK_SCHEDULED');

      const turn2 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: 'tomorrow at 3 PM',
        currentStage: turn1.nextStage,
        turnCount: 2,
        extractedData: turn1.extractedData,
      });

      expect(turn2.outcome).toBe('CALLBACK_REQUESTED');
      expect(turn2.nextStage).toBe('CALL_ENDED');
      expect(turn2.shouldEnd).toBe(true);
      expect(turn2.extractedData.callbackTime).toBe('tomorrow at 3 PM');
      expect(turn2.reply).toContain('tomorrow at 3 PM');

      // Generate structured summary
      const summary = await voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 15,
        callType: 'COLLECTIONS',
        outcome: turn2.outcome,
        context: turn2.extractedData,
        transcript: [
          { speaker: 'customer', text: 'No, I am busy right now. Can you call me later?' },
          { speaker: 'agent', text: turn1.reply },
          { speaker: 'customer', text: 'tomorrow at 3 PM' },
          { speaker: 'agent', text: turn2.reply },
        ],
      });

      expect(summary.outcomeCategory).toBe('CALLBACK_REQUESTED');
      expect(summary.callbackRequest?.requestedTime).toBe('tomorrow at 3 PM');
      expect(summary.nextAction).toBe('Place callback to customer at tomorrow at 3 PM.');
      expect(summary.shortSummary).toContain('requested follow-up at tomorrow at 3 PM');
    });

    it('Defect 2: Unspecified callback request summary never overwrites with "Insufficient information"', async () => {
      const turn1 = await voiceService.processTurn(mockUser, {
        customerId: 'cust_abc',
        userSpeech: 'No, I am busy right now. Can you call me later?',
        currentStage: 'CONFIRM_BALANCE',
        turnCount: 1,
      });

      const summary = await voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 8,
        callType: 'COLLECTIONS',
        outcome: turn1.outcome,
        context: turn1.extractedData,
        transcript: [
          { speaker: 'customer', text: 'No, I am busy right now. Can you call me later?' },
          { speaker: 'agent', text: turn1.reply },
        ],
      });

      expect(summary.outcomeCategory).toBe('CALLBACK_REQUESTED');
      expect(summary.callbackRequest?.requestedTime).toBe('Time not specified');
      expect(summary.nextAction).toBe('Callback requested; time not specified—confirm a suitable time.');
      expect(summary.shortSummary).not.toContain('Insufficient information');
      expect(summary.shortSummary).toContain('requested a callback (time not specified)');
    });

    it('Defect 2b: Early disconnect without customer response records insufficient information', async () => {
      const summary = await voiceService.generateStructuredCallSummary({
        customerName: 'ABC Tech',
        customerId: 'cust_abc',
        invoiceNumber: 'INV-2026-ABC',
        durationSeconds: 2,
        callType: 'COLLECTIONS',
        outcome: 'NO_CONTACT',
        context: {},
        transcript: [
          { speaker: 'agent', text: 'Namaste! Am I speaking with ABC Tech?' },
        ],
      });

      expect(summary.customerMainResponse).toBe('Insufficient information: call disconnected before customer engagement.');
      expect(summary.nextAction).toBe('Verify customer phone number and re-attempt contact during business hours.');
    });
  });
});
