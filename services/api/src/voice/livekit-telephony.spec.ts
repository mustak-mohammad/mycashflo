import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoiceService, VoiceTokenDto, AgentDispatchDto } from './voice.service.js';
import { SipTelephonyAdapter } from '../integrations/adapters/sip-telephony.adapter.js';
import { MockSipClient } from '../integrations/adapters/mock-sip.client.js';
import { CallsService } from '../calls/calls.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('LiveKit Telephony & Cloud Architecture Specifications', () => {
  const originalEnv = { ...process.env };

  let mockConfig: any;
  let mockPrisma: any;
  let mockRecorder: any;
  let mockAuditLogs: any;
  let voiceService: VoiceService;
  let sipAdapter: SipTelephonyAdapter;
  let callsService: CallsService;

  const testUser: AuthUser = {
    userId: 'usr_agent_01',
    tenantId: 'tenant_livekit_01',
    role: 'AGENT',
    name: 'Suresh Kumar',
  };

  let testCallSessions: any[] = [];

  beforeEach(() => {
    process.env.ENABLE_OUTBOUND_CALLS = 'false';
    delete process.env.OUTBOUND_CALLS_ENABLED;

    testCallSessions = [
      {
        id: 'session_lk_01',
        livekitRoom: 'mcf-tenant_livekit_01-cust_101-alpha',
        customerId: 'cust_101',
        userId: 'usr_agent_01',
        tenantId: 'tenant_livekit_01',
        startedAt: null,
        endedAt: null,
        duration: null,
        recordingStatus: null,
        recordingUrl: null,
        recordingEgressId: null,
        metadata: {},
      },
    ];

    mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'LIVEKIT_URL') return 'wss://mycashflo-test.livekit.cloud';
        if (key === 'LIVEKIT_API_KEY') return 'APITestKey123456';
        if (key === 'LIVEKIT_API_SECRET') return 'Secret12345678901234567890123456789012';
        if (key === 'LIVEKIT_AGENT_NAME') return 'chotu-voice-agent';
        if (key === 'LIVEKIT_WEBHOOK_SECRET') return 'WebhookSecret12345678901234567890';
        return process.env[key];
      }),
    };

    mockPrisma = {
      callSession: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.OR) {
            for (const cond of where.OR) {
              const match = testCallSessions.find((s) => s.livekitRoom === cond.livekitRoom);
              if (match) return match;
            }
          }
          if (where.id) return testCallSessions.find((s) => s.id === where.id) || null;
          return null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where.OR) {
            const matches: any[] = [];
            for (const cond of where.OR) {
              const found = testCallSessions.filter(
                (s) =>
                  (cond.livekitRoom && s.livekitRoom === cond.livekitRoom) ||
                  (cond.id && s.id === cond.id),
              );
              matches.push(...found);
            }
            return matches;
          }
          if (where.livekitRoom) {
            return testCallSessions.filter((s) => s.livekitRoom === where.livekitRoom);
          }
          if (where.id) {
            return testCallSessions.filter((s) => s.id === where.id);
          }
          return testCallSessions;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const s = testCallSessions.find((item) => item.id === where.id);
          if (s) {
            Object.assign(s, data);
            return { ...s };
          }
          return null;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newSession = {
            id: `call_${Date.now()}`,
            startedAt: new Date(),
            ...data,
          };
          testCallSessions.push(newSession);
          return newSession;
        }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cust_101',
          name: 'Mehta Textiles',
          phone: '+919876543210',
          tenantId: 'tenant_livekit_01',
        }),
      },
    };

    mockRecorder = {
      startRoomRecording: vi.fn().mockResolvedValue('egress_job_001'),
      stopRecording: vi.fn().mockResolvedValue(undefined),
      getRecording: vi.fn().mockResolvedValue({ status: 'COMPLETE', url: 'https://s3.amazonaws.com/rec.ogg' }),
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_01' }),
    };

    voiceService = new VoiceService(mockConfig as any, mockPrisma as any, mockRecorder as any);
    sipAdapter = new SipTelephonyAdapter(new MockSipClient());
    callsService = new CallsService(mockPrisma as any, mockRecorder as any, mockAuditLogs as any, {
      telephony: sipAdapter,
      getRawConfig: vi.fn().mockResolvedValue({}),
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. LiveKit Token Generation with Short-Lived TTL & Minimum Permissions', () => {
    it('should generate short-lived token with default 900s (15 min) TTL and AGENT permissions', async () => {
      const tokenResult = await voiceService.generateToken(testUser, {
        customerId: 'cust_101',
        role: 'AGENT',
      });

      expect(tokenResult.token).toBeDefined();
      expect(typeof tokenResult.token).toBe('string');
      expect(tokenResult.expiresIn).toBe(900); // 15 mins default
      expect(tokenResult.identity).toBe('agent-usr_agent_01');
      expect(tokenResult.role).toBe('AGENT');
      expect(tokenResult.roomName).toContain('mcf-tenant_livekit_01-cust_101-');
    });

    it('should generate CUSTOMER scoped token with minimum publish/subscribe permissions and non-admin grants', async () => {
      const tokenResult = await voiceService.generateToken(testUser, {
        customerId: 'cust_101',
        role: 'CUSTOMER',
        ttlSeconds: 600, // 10 minutes
      });

      expect(tokenResult.expiresIn).toBe(600);
      expect(tokenResult.identity).toBe('customer-cust_101');
      expect(tokenResult.name).toBe('Customer Participant');
      expect(tokenResult.role).toBe('CUSTOMER');
    });

    it('should clamp token TTL between 60s minimum and 3600s maximum', async () => {
      const lowTtl = await voiceService.generateToken(testUser, { ttlSeconds: 10 });
      expect(lowTtl.expiresIn).toBe(60);

      const highTtl = await voiceService.generateToken(testUser, { ttlSeconds: 7200 });
      expect(highTtl.expiresIn).toBe(3600);
    });

    it('should generate mock token safely when LiveKit credentials are absent', async () => {
      mockConfig.get.mockImplementation((k: string) => (k === 'LIVEKIT_URL' ? null : 'placeholder'));
      const mockResult = await voiceService.generateToken(testUser, { customerId: 'cust_101' });

      expect(mockResult.isMock).toBe(true);
      expect(mockResult.token).toBeDefined();
      // Decode base64url payload
      const decoded = JSON.parse(Buffer.from(mockResult.token, 'base64url').toString('utf8'));
      expect(decoded.mode).toBe('mock');
      expect(decoded.tenantId).toBe(testUser.tenantId);
    });
  });

  describe('2. Agent Dispatch and Health Diagnostics', () => {
    it('should report LiveKit Cloud health status without leaking secret tokens', () => {
      const health = voiceService.checkLiveKitHealth();

      expect(health.configured).toBe(true);
      expect(health.status).toBe('HEALTHY');
      expect(health.agentName).toBe('chotu-voice-agent');
      expect(health.webhookConfigured).toBe(true);
      expect(health.url).not.toContain('Secret');
      expect(health.url).toContain('...'); // Masked URL
    });

    it('should report UNCONFIGURED when credentials are missing or placeholder', () => {
      mockConfig.get.mockImplementation((k: string) => (k === 'LIVEKIT_URL' ? 'your_livekit_url' : ''));
      const health = voiceService.checkLiveKitHealth();

      expect(health.configured).toBe(false);
      expect(health.status).toBe('UNCONFIGURED');
    });

    it('should safely dispatch agent in simulated mode when in non-production or mock', async () => {
      mockConfig.get.mockImplementation((k: string) => (k === 'LIVEKIT_API_KEY' ? 'your_key' : 'placeholder'));
      const dispatch = await voiceService.dispatchAgent(testUser, {
        roomName: 'mcf-test-room-99',
        agentName: 'chotu-voice-agent',
      });

      expect(dispatch.isSimulated).toBe(true);
      expect(dispatch.status).toBe('DISPATCHED_SIMULATED');
      expect(dispatch.dispatchId).toMatch(/^disp_sim_/);
    });
  });

  describe('3. LiveKit Webhook Signature Verification and Idempotency', () => {
    it('should reject webhook in production when webhook secret is missing', async () => {
      process.env.NODE_ENV = 'production';
      mockConfig.get.mockImplementation((k: string) => (k === 'LIVEKIT_WEBHOOK_SECRET' ? '' : undefined));

      await expect(
        voiceService.handleLiveKitWebhook('{"event":"room_started"}', 'any_token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should strictly reject simulation signatures in production', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        voiceService.handleLiveKitWebhook('{"event":"room_started"}', 'mock_valid_signature'),
      ).rejects.toThrow('Simulation signatures forbidden in production');
    });

    it('should accept simulation signatures in non-production test mode', async () => {
      process.env.NODE_ENV = 'test';
      const result = await voiceService.handleLiveKitWebhook(
        JSON.stringify({
          event: 'room_started',
          id: 'evt_sim_001',
          room: { name: 'mcf-tenant_livekit_01-cust_101-alpha' },
        }),
        'mock_valid_signature',
      );

      expect(result.received).toBe(true);
      expect(result.processed).toBe(true);
      expect(result.eventType).toBe('room_started');
    });

    it('should idempotently handle duplicate webhook delivery without redundant processing', async () => {
      process.env.NODE_ENV = 'test';
      const eventPayload = {
        event: 'room_started',
        id: 'evt_duplicate_test_100',
        room: { name: 'mcf-tenant_livekit_01-cust_101-alpha' },
      };

      const firstDelivery = await voiceService.handleLiveKitWebhook(
        JSON.stringify(eventPayload),
        'mock_valid_signature',
      );
      expect(firstDelivery.processed).toBe(true);
      expect(firstDelivery.idempotent).toBeUndefined();

      const secondDelivery = await voiceService.handleLiveKitWebhook(
        JSON.stringify(eventPayload),
        'mock_valid_signature',
      );
      expect(secondDelivery.received).toBe(true);
      expect(secondDelivery.idempotent).toBe(true);
      expect(secondDelivery.eventId).toBe('evt_duplicate_test_100');
    });

    it('should update CallSession startedAt and endedAt upon room_started and room_finished events', async () => {
      process.env.NODE_ENV = 'test';
      const targetRoom = 'mcf-tenant_livekit_01-cust_101-alpha';

      // 1. room_started event
      await voiceService.handleLiveKitWebhook(
        JSON.stringify({
          event: 'room_started',
          id: 'evt_room_start_01',
          room: { name: targetRoom },
        }),
        'mock_valid_signature',
      );
      expect(testCallSessions[0].startedAt).toBeDefined();

      // 2. room_finished event
      await voiceService.handleLiveKitWebhook(
        JSON.stringify({
          event: 'room_finished',
          id: 'evt_room_finish_01',
          room: { name: targetRoom },
          createdAt: Math.floor(Date.now() / 1000),
        }),
        'mock_valid_signature',
      );
      expect(testCallSessions[0].endedAt).toBeDefined();
    });

    it('should update CallSession recording status upon egress_started and egress_ended events', async () => {
      process.env.NODE_ENV = 'test';
      const targetRoom = 'mcf-tenant_livekit_01-cust_101-alpha';

      // 1. egress_started
      await voiceService.handleLiveKitWebhook(
        JSON.stringify({
          event: 'egress_started',
          id: 'evt_egress_start_01',
          room: { name: targetRoom },
          egressInfo: { egressId: 'eg_99999' },
        }),
        'mock_valid_signature',
      );
      expect(testCallSessions[0].recordingStatus).toBe('RECORDING');
      expect(testCallSessions[0].recordingEgressId).toBe('eg_99999');

      // 2. egress_ended
      await voiceService.handleLiveKitWebhook(
        JSON.stringify({
          event: 'egress_ended',
          id: 'evt_egress_end_01',
          room: { name: targetRoom },
          egressInfo: {
            egressId: 'eg_99999',
            status: 2, // EGRESS_COMPLETE
            fileResults: [{ location: 'https://s3.amazonaws.com/mycashflo/rec-call-01.ogg' }],
          },
        }),
        'mock_valid_signature',
      );
      expect(testCallSessions[0].recordingStatus).toBe('AVAILABLE');
      expect(testCallSessions[0].recordingUrl).toBe('https://s3.amazonaws.com/mycashflo/rec-call-01.ogg');
    });
  });

  describe('4. SIP Telephony Diagnostics & Carrier Error Status Synchronization', () => {
    it('should return safe SIP diagnostics without exposing credentials', () => {
      const diag = sipAdapter.getDiagnostics();

      expect(diag.outboundCallsEnabled).toBe(false);
      expect(diag.safetyStatus).toBe('OUTBOUND_DISPATCH_DISABLED_BY_POLICY');
      expect(diag.transport).toBe('TLS/SRTP (Encrypted SIP)');
      expect(diag.callerId).toBe('Not set');
    });

    it('should mask caller ID when configured', () => {
      process.env.SIP_OUTBOUND_CALLER_ID = '+919876543210';
      const diag = sipAdapter.getDiagnostics();

      expect(diag.callerIdConfigured).toBe(true);
      expect(diag.callerId).toBe('+91****3210');
      delete process.env.SIP_OUTBOUND_CALLER_ID;
    });

    it('should synchronize carrier busy status and update CallSession metadata without ending session prematurely', async () => {
      const callbackResult = await callsService.handleTelephonyWebhook('carrier', {
        CallSid: 'session_lk_01',
        CallStatus: 'busy',
      });

      expect(callbackResult.status).toBe('busy');
      expect(testCallSessions[0].metadata.carrierStatus).toBe('busy');
      expect(testCallSessions[0].metadata.busyAt).toBeDefined();
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'telephony.status_callback' }),
      );
    });

    it('should synchronize carrier failed and no-answer statuses', async () => {
      const callbackResult = await callsService.handleTelephonyWebhook('carrier', {
        CallSid: 'session_lk_01',
        CallStatus: 'no-answer',
      });

      expect(callbackResult.status).toBe('no-answer');
      expect(testCallSessions[0].metadata.carrierStatus).toBe('no-answer');
      expect(testCallSessions[0].endedAt).toBeDefined();
    });

    it('should enforce default-deny: ENABLE_OUTBOUND_CALLS=false suppresses all PSTN dispatches', async () => {
      process.env.ENABLE_OUTBOUND_CALLS = 'false';

      const res = await sipAdapter.initiateCall({
        to: '+919876543210',
        customerId: 'cust_101',
        customerName: 'Mehta Textiles',
      });

      expect(res.status).toBe('SIMULATED');
      expect(res.isSimulated).toBe(true);
      expect(res.notes).toContain('Outbound PSTN telephony is disabled by policy');
    });
  });
});
