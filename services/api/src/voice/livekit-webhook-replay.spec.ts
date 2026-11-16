import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { VoiceService } from './voice.service.js';
import { pruneExpiredWebhookReplays } from '../common/webhook-replay.util.js';

async function signLiveKitWebhook(
  payload: Record<string, any>,
  apiKey: string,
  secret: string,
): Promise<{ rawBody: string; authHeader: string }> {
  const rawBody = JSON.stringify(payload);
  const sha256 = crypto.createHash('sha256').update(rawBody, 'utf8').digest('base64');
  const at = new AccessToken(apiKey, secret, {
    identity: 'livekit-webhook-sender',
    ttl: '5m',
  });
  (at as any).grants = { sha256 };
  const authHeader = await at.toJwt();
  return { rawBody, authHeader };
}

describe('Phase 1.3 — LiveKit Webhook Persistent Shared Replay Protection', () => {
  const originalEnv = { ...process.env };
  const lkApiKey = 'APILiveKitWebhookKey123';
  const lkSecret = 'LiveKitWebhookSecretKey1234567890123456';

  let replayRows: any[];
  let callSessions: any[];
  let mockConfig: any;
  let mockPrisma: any;
  let mockRecorder: any;

  const createVoiceService = () => new VoiceService(mockConfig, mockPrisma, mockRecorder);

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    replayRows = [];
    callSessions = [
      {
        id: 'sess_lk_replay_01',
        tenantId: 'tenant_lk_01',
        livekitRoom: 'mcf-tenant_lk_01-cust_01-room1',
        startedAt: null,
        endedAt: null,
        duration: null,
        recordingStatus: null,
        recordingUrl: null,
        recordingEgressId: null,
      },
    ];

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'LIVEKIT_API_KEY') return lkApiKey;
        if (key === 'LIVEKIT_WEBHOOK_SECRET') return lkSecret;
        if (key === 'LIVEKIT_API_SECRET') return lkSecret;
        if (key === 'LIVEKIT_URL') return 'wss://mycashflo-lk.livekit.cloud';
        return process.env[key];
      }),
    };

    mockPrisma = {
      callSession: {
        findFirst: vi.fn(async ({ where }) => {
          if (where?.OR) {
            return (
              callSessions.find((s) =>
                where.OR.some((c: any) => c.livekitRoom && s.livekitRoom === c.livekitRoom),
              ) || null
            );
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const idx = callSessions.findIndex((s) => s.id === where.id);
          if (idx >= 0) {
            callSessions[idx] = { ...callSessions[idx], ...data };
            return callSessions[idx];
          }
          return null;
        }),
      },
      webhookReplay: {
        create: vi.fn(async ({ data }) => {
          const duplicate = replayRows.find((r) => r.replayKey === data.replayKey);
          if (duplicate) {
            const err: any = new Error('Unique constraint failed on replayKey');
            err.code = 'P2002';
            throw err;
          }
          const rec = { id: `wr_${replayRows.length + 1}`, createdAt: new Date(), ...data };
          replayRows.push(rec);
          return rec;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of replayRows) {
            if (row.replayKey === where.replayKey && row.expiresAt <= where.expiresAt.lte) {
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
        deleteMany: vi.fn(async ({ where }) => {
          const before = replayRows.length;
          replayRows = replayRows.filter(
            (row) =>
              !(
                (where.replayKey === undefined || row.replayKey === where.replayKey) &&
                row.expiresAt <= where.expiresAt.lte
              ),
          );
          return { count: before - replayRows.length };
        }),
      },
      $transaction: vi.fn(async (cb) => {
        // Real snapshot-and-restore transactional semantics for testing rollback
        const snapshotSessions = callSessions.map((s) => ({ ...s }));
        const snapshotReplays = replayRows.map((r) => ({ ...r }));
        try {
          return await cb(mockPrisma);
        } catch (err) {
          callSessions = snapshotSessions;
          replayRows = snapshotReplays;
          throw err;
        }
      }),
    };

    mockRecorder = {
      startRoomRecording: vi.fn(),
      stopRecording: vi.fn(),
      getRecording: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('1. accepts a valid signed LiveKit webhook and updates CallSession', async () => {
    const service = createVoiceService();
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_valid_001',
        event: 'room_started',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );

    const res = await service.handleLiveKitWebhook(rawBody, authHeader);
    expect(res.received).toBe(true);
    expect(res.processed).toBe(true);
    expect(res.eventId).toBe('EV_valid_001');
    expect(replayRows).toHaveLength(1);
    expect(replayRows[0].provider).toBe('LIVEKIT_WEBHOOK');
    expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
  });

  it('2. rejects invalid signature and does NOT claim replay key (genuine delivery afterward succeeds)', async () => {
    const service = createVoiceService();
    const payload = {
      id: 'EV_unclaimed_001',
      event: 'room_started',
      room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
    };

    // Forged signature must fail without inserting into WebhookReplay
    await expect(
      service.handleLiveKitWebhook(JSON.stringify(payload), 'forged.jwt.signature'),
    ).rejects.toThrow(UnauthorizedException);
    expect(replayRows).toHaveLength(0);
    expect(mockPrisma.callSession.update).not.toHaveBeenCalled();

    // Legitimate signed delivery with the same event ID still succeeds
    const { rawBody, authHeader } = await signLiveKitWebhook(payload, lkApiKey, lkSecret);
    const res = await service.handleLiveKitWebhook(rawBody, authHeader);
    expect(res.processed).toBe(true);
    expect(replayRows).toHaveLength(1);
  });

  it('3. rejects missing Authorization header without claiming replay key or updating DB', async () => {
    const service = createVoiceService();
    await expect(
      service.handleLiveKitWebhook(
        JSON.stringify({ id: 'EV_no_auth', event: 'room_started' }),
        undefined,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(replayRows).toHaveLength(0);
    expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
  });

  it('4. rejects duplicate signed LiveKit event without duplicate DB writes', async () => {
    const service = createVoiceService();
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_dup_001',
        event: 'room_started',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );

    await service.handleLiveKitWebhook(rawBody, authHeader);
    await expect(service.handleLiveKitWebhook(rawBody, authHeader)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
  });

  it('5. ensures concurrent duplicate requests are processed only once', async () => {
    const service = createVoiceService();
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_concurrent_001',
        event: 'egress_started',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
        egressInfo: { egressId: 'EG_race_01' },
      },
      lkApiKey,
      lkSecret,
    );

    const outcomes = await Promise.allSettled([
      service.handleLiveKitWebhook(rawBody, authHeader),
      service.handleLiveKitWebhook(rawBody, authHeader),
      service.handleLiveKitWebhook(rawBody, authHeader),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);
    }
    expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
  });

  it('6. rejects cross-instance duplicate requests via shared PostgreSQL WebhookReplay storage', async () => {
    const instanceA = createVoiceService();
    const instanceB = createVoiceService();

    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_cross_instance_001',
        event: 'room_finished',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );

    const first = await instanceA.handleLiveKitWebhook(rawBody, authHeader);
    expect(first.processed).toBe(true);

    // Instance B shares mockPrisma (shared DB) and must reject the duplicate event
    await expect(instanceB.handleLiveKitWebhook(rawBody, authHeader)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(1);
  });

  it('7. allows expired replay keys to be safely reused and prunes expired records without touching active ones', async () => {
    const service = createVoiceService();

    // Seed an active unexpired record and an expired record
    replayRows.push(
      {
        id: 'wr_active',
        provider: 'LIVEKIT_WEBHOOK',
        replayKey: 'LIVEKIT_WEBHOOK:id:EV_active_keep',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      {
        id: 'wr_expired',
        provider: 'LIVEKIT_WEBHOOK',
        replayKey: 'LIVEKIT_WEBHOOK:id:EV_expired_reuse',
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    );

    // Reuse of expired key succeeds atomically
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_expired_reuse',
        event: 'room_started',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );

    const res = await service.handleLiveKitWebhook(rawBody, authHeader);
    expect(res.processed).toBe(true);

    // Active record EV_active_keep must remain protected against replay
    const activeReplay = await signLiveKitWebhook(
      {
        id: 'EV_active_keep',
        event: 'room_started',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );
    await expect(
      service.handleLiveKitWebhook(activeReplay.rawBody, activeReplay.authHeader),
    ).rejects.toThrow(UnauthorizedException);

    // Explicit cleanup removes only expired records and keeps active rows
    replayRows.push({
      id: 'wr_expired_2',
      provider: 'LIVEKIT_WEBHOOK',
      replayKey: 'LIVEKIT_WEBHOOK:id:EV_old_prune',
      expiresAt: new Date(Date.now() - 5000),
    });
    const pruned = await pruneExpiredWebhookReplays(mockPrisma);
    expect(pruned).toBe(1);
    expect(replayRows.some((r) => r.replayKey === 'LIVEKIT_WEBHOOK:id:EV_active_keep')).toBe(true);
    expect(replayRows.some((r) => r.replayKey === 'LIVEKIT_WEBHOOK:id:EV_expired_reuse')).toBe(true);
    expect(replayRows.some((r) => r.replayKey === 'LIVEKIT_WEBHOOK:id:EV_old_prune')).toBe(false);
  });

  it('8. continues processing legitimate distinct room, participant, and egress events', async () => {
    const service = createVoiceService();
    const roomName = 'mcf-tenant_lk_01-cust_01-room1';

    const events = [
      { id: 'EV_seq_1', event: 'room_started', room: { name: roomName } },
      {
        id: 'EV_seq_2',
        event: 'participant_joined',
        room: { name: roomName },
        participant: { sid: 'PA_001', identity: 'agent-1' },
      },
      {
        id: 'EV_seq_3',
        event: 'egress_started',
        room: { name: roomName },
        egressInfo: { egressId: 'EG_seq_01' },
      },
      {
        id: 'EV_seq_4',
        event: 'egress_ended',
        room: { name: roomName },
        egressInfo: {
          egressId: 'EG_seq_01',
          status: 2,
          fileResults: [{ location: 'https://storage.example/rec.ogg' }],
        },
      },
      {
        id: 'EV_seq_5',
        event: 'participant_left',
        room: { name: roomName },
        participant: { sid: 'PA_001', identity: 'agent-1' },
      },
      { id: 'EV_seq_6', event: 'room_finished', room: { name: roomName } },
    ];

    for (const evt of events) {
      const { rawBody, authHeader } = await signLiveKitWebhook(evt, lkApiKey, lkSecret);
      const out = await service.handleLiveKitWebhook(rawBody, authHeader);
      expect(out.received).toBe(true);
      expect(out.processed).toBe(true);
      expect(out.eventType).toBe(evt.event);
    }

    expect(callSessions[0].startedAt).toBeInstanceOf(Date);
    expect(callSessions[0].endedAt).toBeInstanceOf(Date);
    expect(callSessions[0].recordingStatus).toBe('AVAILABLE');
    expect(callSessions[0].recordingUrl).toBe('https://storage.example/rec.ogg');
    expect(replayRows).toHaveLength(6);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(6);
  });

  it('9. rolls back WebhookReplay claim when event processing fails inside $transaction', async () => {
    const service = createVoiceService();
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_tx_rollback_001',
        event: 'room_finished',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
      },
      lkApiKey,
      lkSecret,
    );

    mockPrisma.callSession.update.mockRejectedValueOnce(
      new Error('Simulated PostgreSQL transient deadlock during callSession update'),
    );

    await expect(service.handleLiveKitWebhook(rawBody, authHeader)).rejects.toThrow(
      'Simulated PostgreSQL transient deadlock',
    );

    // Transactional rollback must ensure WebhookReplay was NOT persisted and session was NOT ended
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(replayRows).toHaveLength(0);
    expect(callSessions[0].endedAt).toBeNull();
  });

  it('10. accepts legitimate retry after a failed transaction and rejects subsequent duplicate', async () => {
    const service = createVoiceService();
    const { rawBody, authHeader } = await signLiveKitWebhook(
      {
        id: 'EV_tx_retry_001',
        event: 'egress_ended',
        room: { name: 'mcf-tenant_lk_01-cust_01-room1' },
        egressInfo: {
          egressId: 'EG_retry_01',
          status: 2,
          fileResults: [{ location: 'https://storage.example/retried.ogg' }],
        },
      },
      lkApiKey,
      lkSecret,
    );

    // First attempt fails mid-transaction on callSession.update -> rolls back replay claim
    mockPrisma.callSession.update.mockRejectedValueOnce(new Error('Connection reset'));
    await expect(service.handleLiveKitWebhook(rawBody, authHeader)).rejects.toThrow('Connection reset');
    expect(replayRows).toHaveLength(0);
    expect(callSessions[0].recordingStatus).toBeNull();

    // Legitimate retry succeeds and commits both WebhookReplay and CallSession together
    const retryRes = await service.handleLiveKitWebhook(rawBody, authHeader);
    expect(retryRes.received).toBe(true);
    expect(retryRes.processed).toBe(true);
    expect(replayRows).toHaveLength(1);
    expect(callSessions[0].recordingStatus).toBe('AVAILABLE');
    expect(callSessions[0].recordingUrl).toBe('https://storage.example/retried.ogg');

    // Now that the retry committed, any subsequent duplicate replay MUST be rejected
    await expect(service.handleLiveKitWebhook(rawBody, authHeader)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.callSession.update).toHaveBeenCalledTimes(2); // 1 failed + 1 succeeded; 3rd never reached update
  });
});

