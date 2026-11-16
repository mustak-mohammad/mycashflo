import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceService } from './voice.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

/**
 * State Machine simulating the client-side Voice Interaction Lifecycle
 * identical to apps/web/src/pages/VoicePage.tsx.
 */
class BrowserVoiceInteractionHarness {
  public status: 'idle' | 'connecting' | 'active' | 'completed' = 'idle';
  public isListening = false;
  public isProcessing = false;
  public isSpeaking = false;
  public currentStage = 'GREETING_AND_VERIFICATION';
  public turnCount = 0;
  public extractedData: Record<string, any> = {};
  public transcriptHistory: Array<{ speaker: string; text: string }> = [];
  public activeRecognitionInstance: any = null;
  public restartTimer: any = null;
  public lastProcessedTranscript = '';
  public callOutcome = 'OTHER';

  constructor(private voiceService: VoiceService, private user: AuthUser) {}

  public cleanupRecognition() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.activeRecognitionInstance) {
      try {
        const rec = this.activeRecognitionInstance;
        this.activeRecognitionInstance = null;
        rec.onstart = null;
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.abort?.();
      } catch (_) {}
    }
    this.isListening = false;
  }

  public startListeningSession() {
    if (this.status !== 'active' || this.isSpeaking || this.isProcessing) {
      this.isListening = false;
      return;
    }

    this.cleanupRecognition();

    const instance = {
      continuous: false,
      interimResults: false,
      lang: 'en-IN',
      onstart: null as any,
      onend: null as any,
      onerror: null as any,
      onresult: null as any,
      start: vi.fn(() => {
        if (this.status === 'active' && !this.isSpeaking && !this.isProcessing) {
          this.isListening = true;
          instance.onstart?.();
        }
      }),
      abort: vi.fn(() => {
        this.isListening = false;
      }),
      stop: vi.fn(() => {
        this.isListening = false;
      }),
    };

    instance.onend = () => {
      this.isListening = false;
      this.activeRecognitionInstance = null;
      if (this.status === 'active' && !this.isSpeaking && !this.isProcessing) {
        if (!this.restartTimer) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.startListeningSession();
          }, 10);
        }
      }
    };

    instance.onerror = (err: any) => {
      if (err.error === 'not-allowed') {
        this.isListening = false;
        return;
      }
      // 'no-speech' and 'aborted' trigger restart via onend
    };

    instance.onresult = (userSpeech: string) => {
      if (this.status !== 'active' || this.isProcessing || this.isSpeaking) {
        return;
      }
      if (userSpeech && userSpeech !== this.lastProcessedTranscript) {
        this.lastProcessedTranscript = userSpeech;
        instance.abort();
        this.cleanupRecognition();
        this.transcriptHistory.push({ speaker: 'customer', text: userSpeech });
        this.handleTurn(userSpeech);
      }
    };

    this.activeRecognitionInstance = instance;
    instance.start();
  }

  public async speakAgentResponse(replyText: string, onEnded?: () => void) {
    this.isSpeaking = true;
    this.isListening = false;
    this.cleanupRecognition();

    // Simulate audio playback duration
    await new Promise((resolve) => setTimeout(resolve, 15));

    this.isSpeaking = false;
    onEnded?.();
  }

  public async handleTurn(userUtterance: string): Promise<any> {
    this.isProcessing = true;
    this.isListening = false;
    this.cleanupRecognition();

    try {
      const res = await this.voiceService.processTurn(this.user, {
        userSpeech: userUtterance,
        currentStage: this.currentStage as any,
        extractedData: this.extractedData,
        turnCount: this.turnCount,
      });

      this.currentStage = res.nextStage;
      this.extractedData = res.extractedData || {};
      this.turnCount = (this.turnCount || 0) + 1;
      if (res.outcome) this.callOutcome = res.outcome;

      this.transcriptHistory.push({ speaker: 'agent', text: res.reply });
      this.isProcessing = false;

      await this.speakAgentResponse(res.reply, () => {
        this.lastProcessedTranscript = '';
        if (this.status === 'active') {
          if (res.shouldEnd && (res.nextStage === 'CALL_ENDED' || res.outcome === 'NO_CONTACT')) {
            this.endSession();
          } else {
            this.startListeningSession();
          }
        }
      });

      return res;
    } catch (err) {
      this.isProcessing = false;
      const fallbackReply = 'Regarding your balance, could you specify what date we can expect payment?';
      this.transcriptHistory.push({ speaker: 'agent', text: fallbackReply });
      await this.speakAgentResponse(fallbackReply, () => {
        this.lastProcessedTranscript = '';
        if (this.status === 'active') {
          this.startListeningSession();
        }
      });
      return { reply: fallbackReply, fallback: true };
    }
  }

  public async startSession(greeting: string) {
    this.status = 'active';
    this.transcriptHistory.push({ speaker: 'agent', text: greeting });
    await this.speakAgentResponse(greeting, () => {
      if (this.status === 'active') {
        this.startListeningSession();
      }
    });
  }

  public endSession() {
    this.status = 'completed';
    this.cleanupRecognition();
    this.isSpeaking = false;
    this.isProcessing = false;
    this.lastProcessedTranscript = '';
  }
}

describe('Chotu Voice Lifecycle & Resilience - 12+ Turns Verification', () => {
  let voiceService: VoiceService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockRecorder: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  const mockUser: AuthUser = {
    userId: 'usr_test_101',
    tenantId: 'tenant_test_101',
    role: 'AGENT',
  };

  beforeEach(() => {
    mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'LIVEKIT_URL') return 'wss://livekit.test.com';
        if (key === 'LIVEKIT_API_KEY') return 'test_api_key';
        if (key === 'LIVEKIT_API_SECRET') return 'test_api_secret_123456789';
        return null;
      }),
    };

    mockRecorder = {
      startRoomRecording: vi.fn().mockResolvedValue('egress_001'),
      stopRecording: vi.fn().mockResolvedValue(undefined),
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_001' }),
    };

    mockIntegrations = {
      getRawConfig: vi.fn().mockResolvedValue({}),
      telephony: null,
    };

    mockPrisma = {
      customer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cust_101',
          name: 'Acme Test Corp',
          company: 'Acme Test Corp',
          outstandingBalance: 50000,
        }),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv_101',
          number: 'INV-TEST-001',
          outstanding: 50000,
          dueDate: new Date(),
        }),
      },
      callSession: {
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({}),
      },
    };

    voiceService = new VoiceService(
      mockPrisma,
      mockConfig,
      mockRecorder,
      mockAuditLogs,
      mockIntegrations,
    );
  });

  it('1. Successfully executes 14 consecutive voice turns without losing recognition or locking state', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Am I speaking with the accounts department at Acme Test Corp?');

    expect(harness.status).toBe('active');
    expect(harness.isListening).toBe(true);

    const turns = [
      'Yes, this is accounts department.',
      'Can you specify which invoice this is for?',
      'Yes, I have the invoice INV-TEST-001 handy.',
      'No, I cannot pay the complete fifty thousand today.',
      'How much discount or waiver can you offer?',
      'We have a temporary cash flow constraint.',
      'I can pay twenty thousand rupees partial amount.',
      'Can we schedule it for next Friday?',
      'What payment methods do you accept?',
      'We prefer paying via NEFT or RTGS.',
      'Can you send the bank virtual account details?',
      'Yes, send it to our registered email.',
      'Can we pay the remaining thirty thousand next month?',
      'Please note that in our account record.',
    ];

    expect(turns.length).toBe(14); // Exceeds the 12-turn requirement

    for (let i = 0; i < turns.length; i++) {
      const userUtterance = turns[i];

      // Ensure listening was active before utterance
      expect(harness.isListening).toBe(true);
      expect(harness.isSpeaking).toBe(false);
      expect(harness.isProcessing).toBe(false);

      // Simulate recognition firing
      harness.activeRecognitionInstance.onresult(userUtterance);

      // Wait for turn processing and speech synthesis playback
      await new Promise((resolve) => setTimeout(resolve, 50));

      // After turn completes, recognition must be back listening for next turn
      if (harness.status === 'active') {
        expect(harness.isListening).toBe(true);
        expect(harness.isSpeaking).toBe(false);
        expect(harness.isProcessing).toBe(false);
      }
    }

    // Check history length includes greeting + 14 customer turns + agent responses
    expect(harness.transcriptHistory.length).toBeGreaterThanOrEqual(20);
    expect(harness.turnCount).toBeGreaterThanOrEqual(12);
  });

  it('2. Recognition ends naturally after each turn and cleanly restarts a fresh instance', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    const firstInstance = harness.activeRecognitionInstance;
    expect(firstInstance).toBeDefined();

    // Utterance stops current instance and starts fresh one after agent reply
    harness.activeRecognitionInstance.onresult('Yes speaking.');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const secondInstance = harness.activeRecognitionInstance;
    expect(secondInstance).toBeDefined();
    expect(secondInstance).not.toBe(firstInstance); // Proves instance is cleanly recreated per cycle
    expect(harness.isListening).toBe(true);
  });

  it('3. Recovers gracefully from recoverable recognition errors (no-speech silence, network hiccup)', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    expect(harness.isListening).toBe(true);
    const instance = harness.activeRecognitionInstance;

    // Simulate browser silence timeout (no-speech)
    instance.onerror({ error: 'no-speech' });
    instance.onend();

    expect(harness.isListening).toBe(false);

    // Wait for the debounced recovery timer (10ms in harness, 250ms in browser)
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.status).toBe('active');
    expect(harness.isListening).toBe(true); // Recovered and listening again
  });

  it('4. Rejects duplicate transcript and rapid-fire API submissions', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    const initialHistoryLength = harness.transcriptHistory.length;

    // Simulate same transcript firing twice in rapid succession
    harness.activeRecognitionInstance.onresult('Yes this is accounts.');
    // Second duplicate event before reset
    harness.activeRecognitionInstance?.onresult?.('Yes this is accounts.');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const customerEntries = harness.transcriptHistory.filter((t) => t.speaker === 'customer');
    expect(customerEntries.length).toBe(1); // Deduped: submitted exactly once!
  });

  it('5. Agent speech pauses microphone recognition and resumes only after playback ends', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    expect(harness.isListening).toBe(true);

    // Begin speaking a long agent message
    let agentFinished = false;
    const speakPromise = harness.speakAgentResponse('This is a simulated long agent reply...', () => {
      agentFinished = true;
      harness.startListeningSession();
    });

    // While agent is speaking, microphone listening MUST be suppressed
    expect(harness.isSpeaking).toBe(true);
    expect(harness.isListening).toBe(false);

    await speakPromise;

    // Once agent finishes speaking, recognition resumes
    expect(agentFinished).toBe(true);
    expect(harness.isSpeaking).toBe(false);
    expect(harness.isListening).toBe(true);
  });

  it('6. When user ends session, recognition stays permanently stopped', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    expect(harness.isListening).toBe(true);

    harness.endSession();

    expect(harness.status).toBe('completed');
    expect(harness.isListening).toBe(false);
    expect(harness.activeRecognitionInstance).toBeNull();

    // Trigger timer ticks to confirm no restart occurs
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.isListening).toBe(false);
  });

  it('7. Recovers gracefully from backend API failure allowing the user to continue', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    // Force processTurn to throw an error
    vi.spyOn(voiceService, 'processTurn').mockRejectedValueOnce(new Error('Network gateway timeout'));

    harness.activeRecognitionInstance.onresult('We can pay Friday.');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Agent outputs fallback prompt
    const lastAgentMessage = harness.transcriptHistory[harness.transcriptHistory.length - 1];
    expect(lastAgentMessage.text).toContain('Regarding your balance');

    // And recognition is cleanly resumed for the user's next attempt
    expect(harness.isListening).toBe(true);
    expect(harness.isProcessing).toBe(false);
  });

  it('8. NO_CONTACT preference and existing safety behavior remain intact', async () => {
    const harness = new BrowserVoiceInteractionHarness(voiceService, mockUser);
    await harness.startSession('Namaste! Verification greeting.');

    harness.activeRecognitionInstance.onresult('Do not call me again. Put me on do not contact list.');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(harness.callOutcome).toBe('NO_CONTACT');
    expect(harness.status).toBe('completed');
    expect(harness.isListening).toBe(false); // Cease-contact halts recognition immediately
  });
});
