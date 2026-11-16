import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AccessToken, TokenVerifier, AgentDispatchClient } from 'livekit-server-sdk';
import { CallsService } from './calls.service.js';
import { SipTelephonyAdapter } from '../integrations/adapters/sip-telephony.adapter.js';
import { MockSipClient } from '../integrations/adapters/mock-sip.client.js';
import { VoiceService } from '../voice/voice.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

function signTwilioRequest(url: string, params: Record<string, any>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? '');
  }
  return crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

describe('Phase 1.1: Telephony Webhook & LiveKit Token Security Hardening', () => {
  const originalEnv = { ...process.env };

  let mockPrisma: any;
  let mockRecorder: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;
  let mockConfig: any;
  let envMap: Record<string, string | undefined>;
  let callSessions: any[];
  let replayRows: any[];
  let sipAdapter: SipTelephonyAdapter;
  let callsService: CallsService;
  let voiceService: VoiceService;

  const twilioSecret = 'twilio_secret_auth_token_987654321';
  const exotelSecret = 'exotel_shared_webhook_secret_12345';
  const sipTrunkSecret = 'sip_trunk_shared_secret_abcdef';
  const lkApiKey = 'APILiveKitTestKey12345';
  const lkApiSecret = 'LiveKitApiSecretKey12345678901234567890';
  const lkUrl = 'wss://mycashflo-sec-test.livekit.cloud';

  const testUser: AuthUser = {
    userId: 'user_agent_sec_01',
    tenantId: 'tenant_sec_01',
    role: 'AGENT',
    name: 'Ravi Verma',
  };

  beforeEach(() => {
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.EXOTEL_WEBHOOK_TOKEN;
    delete process.env.TELEPHONY_WEBHOOK_SECRET;
    delete process.env.SIP_WEBHOOK_SECRET;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_WEBHOOK_SECRET;
    delete process.env.LIVEKIT_URL;
    delete process.env.ALLOW_DEV_LIVEKIT_SIMULATION;

    replayRows = [];
    callSessions = [
      {
        id: 'call_sess_sec_01',
        tenantId: 'tenant_sec_01',
        userId: 'user_agent_sec_01',
        customerId: 'cust_sec_01',
        livekitRoom: 'sip-CA_sec_test_001',
        duration: 0,
        startedAt: new Date(),
        endedAt: null,
        metadata: {
          callSid: 'CA_sec_test_001',
        },
      },
    ];

    mockPrisma = {
      callSession: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where?.OR) {
            return callSessions.filter((s) =>
              where.OR.some(
                (cond: any) =>
                  (cond.livekitRoom && s.livekitRoom === cond.livekitRoom) ||
                  (cond.id && s.id === cond.id),
              ),
            );
          }
          return [];
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const idx = callSessions.findIndex((s) => s.id === where.id);
          if (idx >= 0) {
            callSessions[idx] = { ...callSessions[idx], ...data };
            return callSessions[idx];
          }
          return null;
        }),
      },
      webhookReplay: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          // Simulate PostgreSQL UNIQUE constraint atomically across concurrent callers
          const exists = replayRows.find((r) => r.replayKey === data.replayKey);
          if (exists) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          const rec = { id: `wr_${replayRows.length + 1}`, createdAt: new Date(), ...data };
          replayRows.push(rec);
          return rec;
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          for (const r of replayRows) {
            if (r.replayKey === where.replayKey && r.expiresAt <= where.expiresAt.lte) {
              Object.assign(r, data);
              count++;
            }
          }
          return { count };
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mockRecorder = {
      startRoomRecording: vi.fn(),
      stopRecording: vi.fn(),
      getRecording: vi.fn().mockResolvedValue({ status: 'NONE' }),
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_sec_01' }),
    };

    sipAdapter = new SipTelephonyAdapter(new MockSipClient());
    mockIntegrations = {
      telephony: sipAdapter,
      getRawConfig: vi.fn().mockResolvedValue({}),
    };

    envMap = {
      NODE_ENV: 'test',
      TWILIO_AUTH_TOKEN: twilioSecret,
      EXOTEL_WEBHOOK_TOKEN: exotelSecret,
      TELEPHONY_WEBHOOK_SECRET: sipTrunkSecret,
      LIVEKIT_URL: lkUrl,
      LIVEKIT_API_KEY: lkApiKey,
      LIVEKIT_API_SECRET: lkApiSecret,
      LIVEKIT_WEBHOOK_SECRET: lkApiSecret,
      ALLOW_DEV_LIVEKIT_SIMULATION: undefined,
    };

    mockConfig = {
      get: vi.fn((key: string) => envMap[key]),
    };

    callsService = new CallsService(
      mockPrisma,
      mockRecorder,
      mockAuditLogs,
      mockIntegrations,
      mockConfig,
    );

    voiceService = new VoiceService(mockConfig, mockPrisma, mockRecorder);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Task A — Telephony Webhook Verification & Replay Protection', () => {
    it('1. accepts valid Twilio X-Twilio-Signature (HMAC-SHA1) and updates call status', async () => {
      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const payload = {
        CallSid: 'CA_sec_test_001',
        CallStatus: 'completed',
        CallDuration: '42',
      };
      const signature = signTwilioRequest(url, payload, twilioSecret);

      const res = await callsService.handleTelephonyWebhook('twilio', payload, {
        headers: { 'x-twilio-signature': signature },
        requestUrl: url,
      });

      expect(res.received).toBe(true);
      expect(res.provider).toBe('TWILIO');
      expect(res.status).toBe('completed');
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
      expect(callSessions[0].duration).toBe(42);
      expect(callSessions[0].metadata.carrierStatus).toBe('completed');
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);
    });

    it('2. accepts valid Twilio JSON webhook with bodySHA256 query parameter', async () => {
      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'ringing' };
      const rawBody = JSON.stringify(payload);
      const bodySha = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
      const url = `https://api.mycashflo.in/api/calls/webhook/twilio?bodySHA256=${bodySha}`;
      const signature = crypto.createHmac('sha1', twilioSecret).update(url, 'utf8').digest('base64');

      const res = await callsService.handleTelephonyWebhook('twilio', payload, {
        headers: { 'x-twilio-signature': signature },
        rawBody,
        requestUrl: url,
      });

      expect(res.received).toBe(true);
      expect(res.status).toBe('ringing');
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
    });

    it('3. accepts valid LiveKit SIP webhook signed via LiveKit AccessToken + body sha256', async () => {
      const payload = {
        id: 'evt_lk_sip_01',
        event: 'room_finished',
        room: { name: 'sip-CA_sec_test_001' },
      };
      const rawBody = JSON.stringify(payload);
      const sha256 = crypto.createHash('sha256').update(rawBody, 'utf8').digest('base64');

      const at = new AccessToken(lkApiKey, lkApiSecret, {
        identity: 'livekit-webhook',
        ttl: '5m',
      });
      (at as any).grants = { sha256 };
      const jwt = await at.toJwt();

      const res = await callsService.handleTelephonyWebhook('livekit_sip', payload, {
        headers: { authorization: jwt },
        rawBody,
      });

      expect(res.received).toBe(true);
      expect(res.provider).toBe('LIVEKIT_SIP');
      expect(res.status).toBe('completed');
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
    });

    it('4. accepts valid Exotel and SIP_TRUNK shared-token authentication', async () => {
      const resExotel = await callsService.handleTelephonyWebhook(
        'exotel',
        { CallSid: 'CA_sec_test_001', CallStatus: 'in-progress' },
        { headers: { 'x-exotel-token': exotelSecret } },
      );
      expect(resExotel.provider).toBe('EXOTEL');
      expect(resExotel.status).toBe('in-progress');

      const resSip = await callsService.handleTelephonyWebhook(
        'sip_gateway',
        { CallSid: 'CA_sec_test_001', CallStatus: 'completed', CallDuration: '18' },
        { headers: { authorization: `Bearer ${sipTrunkSecret}` } },
      );
      expect(resSip.provider).toBe('SIP_TRUNK');
      expect(resSip.status).toBe('completed');
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(2);
    });

    it('5. rejects missing signatures/tokens with UnauthorizedException and performs ZERO DB mutations', async () => {
      await expect(
        callsService.handleTelephonyWebhook(
          'twilio',
          { CallSid: 'CA_sec_test_001', CallStatus: 'completed' },
          { headers: {}, requestUrl: 'https://api.mycashflo.in/api/calls/webhook/twilio' },
        ),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        callsService.handleTelephonyWebhook(
          'exotel',
          { CallSid: 'CA_sec_test_001', CallStatus: 'completed' },
          { headers: {} },
        ),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        callsService.handleTelephonyWebhook(
          'livekit',
          { event: 'room_finished', room: { name: 'sip-CA_sec_test_001' } },
          { headers: {} },
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).not.toHaveBeenCalled();
    });

    it('6. rejects forged/invalid signatures and body mismatches with ZERO DB mutations', async () => {
      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'completed' };

      await expect(
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: { 'x-twilio-signature': 'ZmFrZV9zaWduYXR1cmU=' },
          requestUrl: url,
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        callsService.handleTelephonyWebhook('exotel', payload, {
          headers: { 'x-exotel-token': 'wrong_token_value' },
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        callsService.handleTelephonyWebhook('livekit', payload, {
          headers: { authorization: 'Bearer forged.jwt.token' },
          rawBody: JSON.stringify(payload),
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.log).not.toHaveBeenCalled();
    });

    it('7. rejects expired or malformed webhook timestamps before mutating call records', async () => {
      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'completed' };
      const sig = signTwilioRequest(url, payload, twilioSecret);

      // Expired timestamp (10 minutes ago)
      const expiredTs = String(Math.floor((Date.now() - 10 * 60 * 1000) / 1000));
      await expect(
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: { 'x-twilio-signature': sig, 'x-twilio-timestamp': expiredTs },
          requestUrl: url,
        }),
      ).rejects.toThrow(new UnauthorizedException('Expired or invalid webhook timestamp'));

      // Malformed timestamp
      await expect(
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: { 'x-twilio-signature': sig, 'x-twilio-timestamp': 'not-a-timestamp' },
          requestUrl: url,
        }),
      ).rejects.toThrow(new UnauthorizedException('Malformed webhook timestamp'));

      expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
    });

    it('8. fails closed in production when verification secret is missing or placeholder', async () => {
      process.env.NODE_ENV = 'production';
      mockConfig.get.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      );

      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'completed' };
      const sig = signTwilioRequest(url, payload, 'placeholder_twilio_auth_token');

      await expect(
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: { 'x-twilio-signature': sig },
          requestUrl: url,
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        callsService.handleTelephonyWebhook('sip_trunk', payload, {
          headers: { authorization: 'Bearer placeholder_telephony_webhook_secret' },
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
    });

    it('9. blocks replay attacks while allowing distinct sequential status transitions', async () => {
      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const busyPayload = { CallSid: 'CA_sec_test_001', CallStatus: 'busy' };
      const busySig = signTwilioRequest(url, busyPayload, twilioSecret);

      // First delivery succeeds
      await callsService.handleTelephonyWebhook('twilio', busyPayload, {
        headers: {
          'x-twilio-signature': busySig,
          'i-twilio-idempotency-token': 'idem-token-001',
        },
        requestUrl: url,
      });

      // Exact replay (same idempotency token / payload) rejected
      await expect(
        callsService.handleTelephonyWebhook('twilio', busyPayload, {
          headers: {
            'x-twilio-signature': busySig,
            'i-twilio-idempotency-token': 'idem-token-001',
          },
          requestUrl: url,
        }),
      ).rejects.toThrow(UnauthorizedException);

      // Subsequent distinct status transition ('completed') with new idempotency token succeeds
      const completedPayload = { CallSid: 'CA_sec_test_001', CallStatus: 'completed' };
      const completedSig = signTwilioRequest(url, completedPayload, twilioSecret);
      const res = await callsService.handleTelephonyWebhook('twilio', completedPayload, {
        headers: {
          'x-twilio-signature': completedSig,
          'i-twilio-idempotency-token': 'idem-token-002',
        },
        requestUrl: url,
      });

      expect(res.status).toBe('completed');
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(2);
    });

    it('10. rejects unsupported telephony providers with BadRequestException before any DB call', async () => {
      await expect(
        callsService.handleTelephonyWebhook('unknown_carrier', {
          CallSid: 'CA_sec_test_001',
          CallStatus: 'completed',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        callsService.handleTelephonyWebhook('carrier', {
          CallSid: 'CA_sec_test_001',
          CallStatus: 'completed',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.callSession.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
    });
  });

  describe('Task B — Secure LiveKit Token Generation', () => {
    it('11. generates a real signed LiveKit JWT with scoped grants and isMock=false', async () => {
      const res = await voiceService.generateToken(testUser, {
        customerId: 'cust_sec_01',
        role: 'AGENT',
        ttlSeconds: 600,
      });

      expect(res.isMock).toBe(false);
      expect(res.url).toBe(lkUrl);
      expect(res.token.split('.')).toHaveLength(3);

      const verifier = new TokenVerifier(lkApiKey, lkApiSecret);
      const claims = await verifier.verify(res.token);
      expect(claims.sub).toBe('agent-user_agent_sec_01');
      expect(claims.video?.roomJoin).toBe(true);
      expect(claims.video?.room).toBe(res.roomName);
    });

    it('12. fails closed with ServiceUnavailableException when LiveKit credentials are missing or placeholders', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'LIVEKIT_URL') return lkUrl;
        if (key === 'LIVEKIT_API_KEY') return 'your_livekit_api_key';
        return undefined;
      });

      await expect(
        voiceService.generateToken(testUser, { customerId: 'cust_sec_01' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('13. fails closed in production and never returns an unsigned mock token', async () => {
      process.env.NODE_ENV = 'production';
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });

      let caughtErr: any;
      try {
        await voiceService.generateToken(testUser, { customerId: 'cust_sec_01' });
      } catch (e) {
        caughtErr = e;
      }

      expect(caughtErr).toBeInstanceOf(ServiceUnavailableException);
      expect(caughtErr.message).not.toContain(lkApiSecret);
      expect(caughtErr.message).not.toContain(lkApiKey);
    });

    it('14. produces safe InternalServerErrorException on token signing failure without exposing secrets', async () => {
      const spy = vi
        .spyOn(AccessToken.prototype, 'toJwt')
        .mockRejectedValueOnce(new Error(`Signing crashed with key=${lkApiKey} secret=${lkApiSecret}`));

      let caughtErr: any;
      try {
        await voiceService.generateToken(testUser, { customerId: 'cust_sec_01' });
      } catch (e) {
        caughtErr = e;
      }

      expect(spy).toHaveBeenCalledTimes(1);
      expect(caughtErr).toBeInstanceOf(InternalServerErrorException);
      expect(caughtErr.message).toBe('Failed to generate LiveKit access token');
      expect(JSON.stringify(caughtErr)).not.toContain(lkApiSecret);
      expect(JSON.stringify(caughtErr)).not.toContain(lkApiKey);
    });
  });

  describe('Phase 1.2 — Shared Replay Protection & LiveKit Dispatch Security', () => {
    it('15. prevents concurrent duplicate webhook requests from processing the same event twice', async () => {
      const url = 'https://api.mycashflo.in/api/calls/webhook/twilio';
      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'completed', CallDuration: '30' };
      const sig = signTwilioRequest(url, payload, twilioSecret);

      const results = await Promise.allSettled([
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: {
            'x-twilio-signature': sig,
            'i-twilio-idempotency-token': 'concurrent-idem-001',
          },
          requestUrl: url,
        }),
        callsService.handleTelephonyWebhook('twilio', payload, {
          headers: {
            'x-twilio-signature': sig,
            'i-twilio-idempotency-token': 'concurrent-idem-001',
          },
          requestUrl: url,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
      expect(mockAuditLogs.log).toHaveBeenCalledTimes(1);
    });

    it('16. blocks webhook replays across separate API instances sharing PostgreSQL WebhookReplay', async () => {
      const secondCallsServiceInstance = new CallsService(
        mockPrisma,
        mockRecorder,
        mockAuditLogs,
        mockIntegrations,
        mockConfig,
      );

      const payload = { CallSid: 'CA_sec_test_001', CallStatus: 'busy' };
      const firstRes = await callsService.handleTelephonyWebhook('sip_trunk', payload, {
        headers: { authorization: `Bearer ${sipTrunkSecret}` },
      });
      expect(firstRes.received).toBe(true);

      await expect(
        secondCallsServiceInstance.handleTelephonyWebhook('sip_trunk', payload, {
          headers: { authorization: `Bearer ${sipTrunkSecret}` },
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
    });

    it('17. dispatchAgent fails closed in production when credentials are missing, even if ALLOW_DEV_LIVEKIT_SIMULATION=true', async () => {
      process.env.NODE_ENV = 'production';
      envMap.NODE_ENV = 'production';
      envMap.ALLOW_DEV_LIVEKIT_SIMULATION = 'true';
      envMap.LIVEKIT_API_KEY = 'your_livekit_api_key';
      envMap.LIVEKIT_API_SECRET = 'placeholder';

      await expect(
        voiceService.dispatchAgent(testUser, {
          roomName: 'mcf-prod-room-01',
          agentName: 'chotu-voice-agent',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('18. dispatchAgent disables simulation by default and permits it only with explicit dev-only flag in non-production', async () => {
      process.env.NODE_ENV = 'development';
      envMap.NODE_ENV = 'development';
      envMap.LIVEKIT_API_KEY = 'your_livekit_api_key';
      envMap.LIVEKIT_API_SECRET = 'placeholder';
      envMap.ALLOW_DEV_LIVEKIT_SIMULATION = undefined;

      // Default disabled
      await expect(
        voiceService.dispatchAgent(testUser, { roomName: 'mcf-dev-room-01' }),
      ).rejects.toThrow(ServiceUnavailableException);

      // Explicitly enabled in development
      envMap.ALLOW_DEV_LIVEKIT_SIMULATION = 'true';
      const simRes = await voiceService.dispatchAgent(testUser, {
        roomName: 'mcf-dev-room-01',
        agentName: 'chotu-voice-agent',
      });
      expect(simRes.isSimulated).toBe(true);
      expect(simRes.status).toBe('DISPATCHED_SIMULATED');
      expect(simRes.dispatchId).toMatch(/^disp_sim_/);
    });

    it('19. dispatchAgent never reports success or falls back when real LiveKit dispatch fails', async () => {
      envMap.ALLOW_DEV_LIVEKIT_SIMULATION = 'true';
      const dispatchSpy = vi
        .spyOn(AgentDispatchClient.prototype, 'createDispatch')
        .mockRejectedValueOnce(new Error(`Upstream error apiKey=${lkApiKey} secret=${lkApiSecret}`));

      let caughtErr: any;
      try {
        await voiceService.dispatchAgent(testUser, {
          roomName: 'mcf-real-room-fail',
          agentName: 'chotu-voice-agent',
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(caughtErr).toBeInstanceOf(BadRequestException);
      expect(caughtErr.message).toBe('Failed to dispatch LiveKit agent');
      expect(JSON.stringify(caughtErr)).not.toContain(lkApiSecret);
      expect(JSON.stringify(caughtErr)).not.toContain(lkApiKey);
    });

    it('20. dispatchAgent preserves legitimate real LiveKit AgentDispatchClient dispatch', async () => {
      const dispatchSpy = vi
        .spyOn(AgentDispatchClient.prototype, 'createDispatch')
        .mockResolvedValueOnce({ id: 'AD_real_dispatch_991' } as any);

      const res = await voiceService.dispatchAgent(testUser, {
        roomName: 'mcf-real-room-ok',
        agentName: 'chotu-voice-agent',
        metadata: { customerId: 'cust_sec_01' },
      });

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(res.dispatchId).toBe('AD_real_dispatch_991');
      expect(res.status).toBe('DISPATCHED');
      expect(res.isSimulated).toBe(false);
    });
  });
});

