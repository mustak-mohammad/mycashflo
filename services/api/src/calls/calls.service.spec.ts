import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CallsService } from './calls.service.js';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('CallsService - Recording Management and Playback Tests', () => {
  let callsService: CallsService;
  let mockPrisma: any;
  let mockRecorder: any;
  let mockAuditLogs: any;
  let mockIntegrations: any;

  const mockUser: AuthUser = {
    userId: 'user_001',
    tenantId: 'tenant_rec_test',
    role: 'AGENT',
  };

  let callSessions: any[] = [];
  const testTenantDir = path.join(process.cwd(), 'uploads', 'recordings', 'tenant_rec_test');

  beforeEach(() => {
    callSessions = [
      {
        id: 'call_rec_001',
        tenantId: 'tenant_rec_test',
        customerId: 'cust_001',
        customer: { name: 'Acme Logistics' },
        recordingStatus: null,
        recordingUrl: null,
        recordingEgressId: null,
      },
      {
        id: 'call_other_tenant',
        tenantId: 'tenant_other_tenant',
        customerId: 'cust_002',
        customer: { name: 'Other Corp' },
        recordingStatus: null,
        recordingUrl: null,
      },
    ];

    mockPrisma = {
      callSession: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return callSessions.find(
            (c) => c.id === where.id && (where.tenantId === undefined || c.tenantId === where.tenantId),
          ) || null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where, skip, take }) => {
          let list = callSessions.filter(
            (c) => where.tenantId === undefined || c.tenantId === where.tenantId,
          );
          if (where.outcome) {
            list = list.filter((c) => c.outcome === where.outcome);
          }
          if (where.customerId) {
            list = list.filter((c) => c.customerId === where.customerId);
          }
          if (skip !== undefined && take !== undefined) {
            return list.slice(skip, skip + take);
          }
          return list;
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          let list = callSessions.filter(
            (c) => where.tenantId === undefined || c.tenantId === where.tenantId,
          );
          if (where.outcome) {
            list = list.filter((c) => c.outcome === where.outcome);
          }
          return list.length;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startedAt: new Date(),
            endedAt: new Date(),
            customer: { id: data.customerId, name: 'Test Customer' },
            agent: { id: data.userId, name: 'Agent Smith' },
            ...data,
          };
          callSessions.push(newCall);
          return newCall;
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
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cust_001', name: 'Acme Logistics' }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tenant_rec_test', name: 'Test Tenant Ltd' }),
      },
    };

    mockRecorder = {
      getRecording: vi.fn().mockResolvedValue({ status: 'NONE' }),
    };

    mockAuditLogs = { log: vi.fn() };
    mockIntegrations = null;

    callsService = new CallsService(mockPrisma, mockRecorder, mockAuditLogs, mockIntegrations);
  });

  afterEach(async () => {
    // Clean up test upload files
    try {
      if (fs.existsSync(testTenantDir)) {
        const files = await fs.promises.readdir(testTenantDir);
        for (const file of files) {
          await fs.promises.unlink(path.join(testTenantDir, file));
        }
        await fs.promises.rmdir(testTenantDir);
      }
    } catch (_) {}
  });

  it('saves an uploaded audio buffer to disk and marks the call session AVAILABLE', async () => {
    const audioData = Buffer.from('FAKE_WEBM_AUDIO_DATA_FOR_TESTING');
    const result = await callsService.saveRecording('call_rec_001', mockUser, audioData, 'audio/webm');

    expect(result.status).toBe('AVAILABLE');
    expect(result.streamUrl).toBe('/api/calls/call_rec_001/recording/stream');
    expect(result.downloadUrl).toBe('/api/calls/call_rec_001/recording/download');

    // Verify session updated in Prisma
    const session = callSessions.find((c) => c.id === 'call_rec_001');
    expect(session.recordingStatus).toBe('AVAILABLE');
    expect(session.recordingUrl).toBe('/api/calls/call_rec_001/recording/stream');

    // Verify file written to disk
    const targetFile = path.join(testTenantDir, 'call_rec_001.webm');
    expect(fs.existsSync(targetFile)).toBe(true);
    const content = await fs.promises.readFile(targetFile);
    expect(content.toString()).toBe('FAKE_WEBM_AUDIO_DATA_FOR_TESTING');
  });

  it('enforces tenant isolation and throws NotFoundException when accessing other tenant recording', async () => {
    const audioData = Buffer.from('TEST');
    await expect(
      callsService.saveRecording('call_other_tenant', mockUser, audioData, 'audio/webm'),
    ).rejects.toThrow(NotFoundException);

    await expect(
      callsService.getRecordingFilePath('call_other_tenant', mockUser),
    ).rejects.toThrow(NotFoundException);

    await expect(
      callsService.resolveRecording('call_other_tenant', mockUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('handles missing recordings without fabricating audio URLs or status', async () => {
    // Session exists but no audio on disk or egress
    const filePathInfo = await callsService.getRecordingFilePath('call_rec_001', mockUser);
    expect(filePathInfo).toBeNull();

    const resolveRes = await callsService.resolveRecording('call_rec_001', mockUser);
    expect(resolveRes.status).toBe('NONE');
    expect(resolveRes.url).toBeUndefined();

    // Session does not exist at all -> NotFoundException
    await expect(
      callsService.getRecordingFilePath('non_existent_call_id', mockUser),
    ).rejects.toThrow(NotFoundException);

    await expect(
      callsService.resolveRecording('non_existent_call_id', mockUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('handles storage failures gracefully and prevents falsely marking recording as AVAILABLE', async () => {
    const audioData = Buffer.from('TEST_DATA');
    // Spy on fs.promises.writeFile to simulate a disk I/O failure
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('EACCES: permission denied, write'));

    await expect(
      callsService.saveRecording('call_rec_001', mockUser, audioData, 'audio/webm'),
    ).rejects.toThrow('EACCES');

    // Call session must NOT be updated to AVAILABLE
    const session = callSessions.find((c) => c.id === 'call_rec_001');
    expect(session.recordingStatus).toBeNull();
    expect(session.recordingUrl).toBeNull();

    writeSpy.mockRestore();
  });

  it('provides complete metadata for successful download and streaming', async () => {
    const audioData = Buffer.from('WEBM_AUDIO_STREAM_FOR_DOWNLOAD');
    await callsService.saveRecording('call_rec_001', mockUser, audioData, 'audio/webm');

    const fileInfo = await callsService.getRecordingFilePath('call_rec_001', mockUser);
    expect(fileInfo).not.toBeNull();
    expect(fileInfo?.mimeType).toBe('audio/webm');
    expect(fileInfo?.filePath).toContain('call_rec_001.webm');
    expect(fileInfo?.call.customer?.name).toBe('Acme Logistics');
  });

  it('resolves local recording on disk when present', async () => {
    // 1. Initial state: No recording on disk or egress
    const initialResolve = await callsService.resolveRecording('call_rec_001', mockUser);
    expect(initialResolve.status).toBe('NONE');

    // 2. Save a recording
    const audioData = Buffer.from('RECORDED_VOICE_STREAM');
    await callsService.saveRecording('call_rec_001', mockUser, audioData, 'audio/webm');

    // 3. Resolve again: Should be AVAILABLE with streamUrl and downloadUrl
    const resolved = await callsService.resolveRecording('call_rec_001', mockUser);
    expect(resolved.status).toBe('AVAILABLE');
    expect(resolved.streamUrl).toBe('/api/calls/call_rec_001/recording/stream');
    expect(resolved.downloadUrl).toBe('/api/calls/call_rec_001/recording/download');
  });

  it('correctly handles egress recording states: PROCESSING, FAILED, and COMPLETE', async () => {
    // Setup call with egress ID
    callSessions.push({
      id: 'call_egress_test',
      tenantId: 'tenant_rec_test',
      recordingEgressId: 'egress_job_123',
      recordingStatus: 'PROCESSING',
      recordingUrl: null,
    });

    // 1. Egress is in progress (ACTIVE)
    mockRecorder.getRecording.mockResolvedValueOnce({ status: 'ACTIVE' });
    const resProcessing = await callsService.resolveRecording('call_egress_test', mockUser);
    expect(resProcessing.status).toBe('PROCESSING');

    // 2. Egress failed
    mockRecorder.getRecording.mockResolvedValueOnce({ status: 'FAILED' });
    const resFailed = await callsService.resolveRecording('call_egress_test', mockUser);
    expect(resFailed.status).toBe('FAILED');
    const sessionFailed = callSessions.find((c) => c.id === 'call_egress_test');
    expect(sessionFailed.recordingStatus).toBe('FAILED');

    // 3. Egress completed with URL
    mockRecorder.getRecording.mockResolvedValueOnce({
      status: 'COMPLETE',
      url: 'https://storage.mycashflo.in/recordings/call_egress_test.mp4',
    });
    const resComplete = await callsService.resolveRecording('call_egress_test', mockUser);
    expect(resComplete.status).toBe('AVAILABLE');
    expect(resComplete.url).toBe('https://storage.mycashflo.in/recordings/call_egress_test.mp4');
    expect(sessionFailed.recordingStatus).toBe('AVAILABLE');
  });

  describe('Call Outcome Classification and Querying Tests', () => {
    const outcomes = [
      'PROMISE_TO_PAY',
      'WILL_PAY_LATER',
      'UNABLE_TO_PAY',
      'CALLBACK_REQUESTED',
      'DISPUTE',
      'PAYMENT_CLAIMED',
      'NO_CONTACT',
    ] as const;

    it('persists calls under each verified outcome category without data loss', async () => {
      for (const outcome of outcomes) {
        const created = await callsService.create(mockUser, {
          customerId: 'cust_001',
          duration: 120,
          outcome: outcome as any,
          summary: `Call finished with outcome: ${outcome}`,
          transcript: `[AGENT]: Follow-up call.\n[CUSTOMER]: Agreed on ${outcome}.`,
        });

        expect(created.outcome).toBe(outcome);
        expect(created.tenantId).toBe(mockUser.tenantId);
      }
    });

    it('filters calls by outcome and enforces tenant isolation in findAll', async () => {
      // Seed calls with different outcomes
      await callsService.create(mockUser, {
        customerId: 'cust_001',
        outcome: 'PROMISE_TO_PAY' as any,
      });
      await callsService.create(mockUser, {
        customerId: 'cust_001',
        outcome: 'UNABLE_TO_PAY' as any,
      });

      const ptpCalls = await callsService.findAll(mockUser, { outcome: 'PROMISE_TO_PAY' as any });
      expect(ptpCalls.data.every((c) => c.outcome === 'PROMISE_TO_PAY')).toBe(true);
      expect(ptpCalls.total).toBeGreaterThanOrEqual(1);

      const hardshipCalls = await callsService.findAll(mockUser, { outcome: 'UNABLE_TO_PAY' as any });
      expect(hardshipCalls.data.every((c) => c.outcome === 'UNABLE_TO_PAY')).toBe(true);
    });

    it('exports CSV accurately with sanitized formulas and correct outcome headers', async () => {
      await callsService.create(mockUser, {
        customerId: 'cust_001',
        duration: 95,
        outcome: 'WILL_PAY_LATER' as any,
        summary: '=cmd| "calc"!A0 Malicious Formula Attempt',
      });

      const csv = await callsService.exportCsv(mockUser, { outcome: 'WILL_PAY_LATER' as any });
      expect(csv).toContain('Customer,Phone,Duration (s),Date & Time,Outcome,Agent,Summary');
      expect(csv).toContain('WILL_PAY_LATER');
      // Formula injection defense: prefixed with apostrophe
      expect(csv).toContain("\"'=cmd|");
    });

    it('enforces tenant isolation on findOne and getCallForReport', async () => {
      await expect(
        callsService.findOne('call_other_tenant', mockUser),
      ).rejects.toThrow(NotFoundException);

      await expect(
        callsService.getCallForReport('call_other_tenant', mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
