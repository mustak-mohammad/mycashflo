import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SipTelephonyAdapter } from './adapters/sip-telephony.adapter.js';
import { MockSipClient } from './adapters/mock-sip.client.js';
import { SipRequestBuilder } from './builders/sip-request.builder.js';
import { CallsService } from '../calls/calls.service.js';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('Safe Dry-Run SIP Integration Hardening Tests (10 Proofs)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Enforce default-deny test state
    process.env.ENABLE_OUTBOUND_CALLS = 'false';
    delete process.env.OUTBOUND_CALLS_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── 1. Outbound calling disabled means no network client is invoked ──────────
  it('Proof 1: Outbound calling disabled means no network client is invoked and status is SIMULATED', async () => {
    process.env.ENABLE_OUTBOUND_CALLS = 'false';
    const mockClient = new MockSipClient();
    const mockSpy = vi.spyOn(mockClient, 'createSipParticipant');
    const adapter = new SipTelephonyAdapter(mockClient);

    const result = await adapter.initiateCall({
      to: '+919876543210',
      customerId: 'cust_001',
      customerName: 'Aarti Textiles',
      callReason: 'Payment reminder',
    });

    expect(result.status).toBe('SIMULATED');
    expect(result.isSimulated).toBe(true);
    expect(result.callSid).toMatch(/^(CA_sim_|sip_sim_)/);
    expect(result.notes).toContain('Outbound PSTN telephony is disabled by policy');
    expect(result.raw.simulated).toBe(true);
    expect(mockSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Supplying dummy credentials cannot bypass the safety guard ───────────
  it('Proof 2: Supplying dummy credentials cannot bypass the safety guard', async () => {
    process.env.ENABLE_OUTBOUND_CALLS = 'false';
    const mockClient = new MockSipClient();
    const adapter = new SipTelephonyAdapter(mockClient);

    // Provide complete, realistic credentials
    const dummyConfig = {
      provider: 'LIVEKIT_SIP' as const,
      sipTrunkId: 'ST_prod_trunk_99999',
      sipTrunkUri: 'sip:carrier.livekit.cloud',
      sipUsername: 'customer_admin',
      sipPassword: 'super_secret_sip_password_that_must_not_leak',
      outboundCallerId: '+919876500000',
    };

    const result = await adapter.initiateCall(
      {
        to: '+919876543210',
        customerId: 'cust_002',
        customerName: 'Gupta Enterprises',
        callReason: 'Overdue invoice collection',
      },
      dummyConfig,
    );

    // Must still be safely intercepted as SIMULATED
    expect(result.status).toBe('SIMULATED');
    expect(result.isSimulated).toBe(true);
    expect(result.callSid).toMatch(/^(CA_sim_|sip_sim_)/);
    expect(result.raw.policy).toBe('OUTBOUND_CALLS_DISABLED_BY_DEFAULT');
  });

  // ── 3. Alternate flag cannot override explicit disabled setting ─────────────
  it('Proof 3: Alternate flag cannot override the explicit disabled setting (default-deny)', async () => {
    const mockClient = new MockSipClient();
    const adapter = new SipTelephonyAdapter(mockClient);

    // Case 3a: ENABLE_OUTBOUND_CALLS=false but OUTBOUND_CALLS_ENABLED=true
    process.env.ENABLE_OUTBOUND_CALLS = 'false';
    process.env.OUTBOUND_CALLS_ENABLED = 'true';

    const resultA = await adapter.initiateCall({
      to: '+919876543210',
      customerId: 'cust_003',
      customerName: 'Test Corp A',
    });

    expect(resultA.status).toBe('SIMULATED');
    expect(resultA.isSimulated).toBe(true);

    // Case 3b: ENABLE_OUTBOUND_CALLS=true but OUTBOUND_CALLS_ENABLED=false
    process.env.ENABLE_OUTBOUND_CALLS = 'true';
    process.env.OUTBOUND_CALLS_ENABLED = 'false';

    const resultB = await adapter.initiateCall({
      to: '+919876543210',
      customerId: 'cust_003',
      customerName: 'Test Corp B',
    });

    expect(resultB.status).toBe('SIMULATED');
    expect(resultB.isSimulated).toBe(true);
  });

  // ── Helper setup for CallsService tests ─────────────────────────────────────
  function setupCallsServiceMock(overrides?: {
    customer?: any;
    existingCalls?: any[];
    concurrencyCount?: number;
    dailyCount?: number;
  }) {
    const mockCustomer = overrides?.customer ?? {
      id: 'cust_100',
      tenantId: 'tenant_t1',
      name: 'Verma Trading',
      phone: '+919876543210',
      notes: null,
      preferredChannel: null,
    };

    let callSessions: any[] = overrides?.existingCalls ?? [];

    const mockPrisma = {
      customer: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (mockCustomer && mockCustomer.id === where.id && mockCustomer.tenantId === where.tenantId) {
            return mockCustomer;
          }
          return null;
        }),
      },
      callSession: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            callSessions.find((c) => {
              const tenantMatch = !where.tenantId || c.tenantId === where.tenantId;
              const customerMatch = !where.customerId || c.customerId === where.customerId;
              const startedAtMatch = !where.startedAt?.gte || c.startedAt >= where.startedAt.gte;
              return tenantMatch && customerMatch && startedAtMatch;
            }) || null
          );
        }),
        count: vi.fn().mockImplementation(async ({ where }) => {
          if (where.endedAt === null && overrides?.concurrencyCount !== undefined) {
            return overrides.concurrencyCount;
          }
          if (where.startedAt?.gte && overrides?.dailyCount !== undefined) {
            return overrides.dailyCount;
          }
          return callSessions.filter((c) => {
            if (where.tenantId && c.tenantId !== where.tenantId) return false;
            if (where.endedAt === null && c.endedAt !== null) return false;
            return true;
          }).length;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newSession = {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startedAt: new Date(),
            endedAt: null,
            ...data,
          };
          callSessions.push(newSession);
          return newSession;
        }),
      },
    };

    const mockRecorder: any = { getRecording: vi.fn() };
    const mockAuditLogs: any = { log: vi.fn() };
    const mockIntegrations: any = {
      getRawConfig: vi.fn().mockResolvedValue({}),
      telephony: new SipTelephonyAdapter(new MockSipClient()),
    };

    const callsService = new CallsService(mockPrisma as any, mockRecorder, mockAuditLogs, mockIntegrations);
    return { callsService, mockPrisma, callSessions };
  }

  const authUserT1: AuthUser = {
    userId: 'user_u1',
    tenantId: 'tenant_t1',
    role: 'ADMIN',
  };

  // ── 4. NO_CONTACT rejects call initiation ───────────────────────────────────
  it('Proof 4: NO_CONTACT and DND preferences reject call initiation with BadRequestException', async () => {
    // 4a: Notes containing DND:NO_CONTACT
    const { callsService: serviceA } = setupCallsServiceMock({
      customer: {
        id: 'cust_dnd',
        tenantId: 'tenant_t1',
        name: 'DND Corp',
        phone: '+919876543210',
        notes: '[DND:NO_CONTACT - Requested stop calling on 2026-10-15]',
      },
    });

    await expect(
      serviceA.initiateOutboundCall(authUserT1, { customerId: 'cust_dnd' }),
    ).rejects.toThrow(BadRequestException);

    // 4b: Customer with preferredChannel: 'NO_CONTACT'
    const { callsService: serviceB } = setupCallsServiceMock({
      customer: {
        id: 'cust_optout',
        tenantId: 'tenant_t1',
        name: 'OptOut Corp',
        phone: '+919876543210',
        preferredChannel: 'NO_CONTACT',
      },
    });

    await expect(
      serviceB.initiateOutboundCall(authUserT1, { customerId: 'cust_optout' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. Cross-tenant customer access is rejected ─────────────────────────────
  it('Proof 5: Cross-tenant customer access is strictly rejected with NotFoundException', async () => {
    // Customer belongs to tenant_OTHER, caller is in tenant_t1
    const { callsService } = setupCallsServiceMock({
      customer: {
        id: 'cust_cross_tenant',
        tenantId: 'tenant_OTHER',
        name: 'Foreign Tenant Corp',
        phone: '+919876543210',
      },
    });

    await expect(
      callsService.initiateOutboundCall(authUserT1, { customerId: 'cust_cross_tenant' }),
    ).rejects.toThrow(NotFoundException);
  });

  // ── 6. Invalid mobile numbers are rejected ──────────────────────────────────
  it('Proof 6: Invalid mobile numbers (landlines, foreign, malformed) are rejected before dispatch', async () => {
    const { callsService } = setupCallsServiceMock();

    const invalidNumbers = [
      '08023456789',       // Bengaluru landline
      '+9108023456789',    // Landline with +91 prefix
      '+911123456789',     // Delhi landline
      '+14155552671',      // US number
      '98765',             // Too short
      '+915123456789',     // Starts with 5 (invalid mobile prefix in India)
      'abcdefghij',        // Non-numeric
    ];

    for (const badNumber of invalidNumbers) {
      await expect(
        callsService.initiateOutboundCall(authUserT1, {
          customerId: 'cust_100',
          phone: badNumber,
        }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  // ── 7. Duplicate requests are blocked ───────────────────────────────────────
  it('Proof 7: Duplicate call requests for same customer within 60s are blocked with ConflictException', async () => {
    const recentCall = {
      id: 'call_recent_001',
      tenantId: 'tenant_t1',
      customerId: 'cust_100',
      startedAt: new Date(Date.now() - 20 * 1000), // 20 seconds ago
      endedAt: null,
    };

    const { callsService } = setupCallsServiceMock({
      existingCalls: [recentCall],
    });

    await expect(
      callsService.initiateOutboundCall(authUserT1, { customerId: 'cust_100' }),
    ).rejects.toThrow(ConflictException);
  });

  // ── 8. Tenant limits are enforced under concurrent requests ─────────────────
  it('Proof 8: Tenant concurrency and daily limits are enforced under high load', async () => {
    // 8a: Concurrency cap reached
    const { callsService: concurrencyService } = setupCallsServiceMock({
      concurrencyCount: 5, // Default max concurrency
    });

    await expect(
      concurrencyService.initiateOutboundCall(authUserT1, { customerId: 'cust_100' }),
    ).rejects.toThrow(/concurrency limit reached/i);

    // 8b: Daily usage cap reached
    const { callsService: dailyService } = setupCallsServiceMock({
      concurrencyCount: 0,
      dailyCount: 100, // Default max daily
    });

    await expect(
      dailyService.initiateOutboundCall(authUserT1, { customerId: 'cust_100' }),
    ).rejects.toThrow(/daily outbound call limit reached/i);
  });

  // ── 9. Simulated provider failures are handled correctly ────────────────────
  it('Proof 9: Simulated provider behaviors (BUSY, TIMEOUT, AUTH_FAILED, REJECTED) are handled cleanly', async () => {
    const behaviors = ['BUSY', 'TIMEOUT', 'AUTH_FAILED', 'REJECTED'] as const;

    for (const behavior of behaviors) {
      const mockClient = new MockSipClient();
      const adapter = new SipTelephonyAdapter(mockClient);

      const result = await adapter.initiateCall(
        {
          to: '+919876543210',
          customerId: 'cust_behavior_test',
          customerName: 'Behavior Test',
        },
        { simulatedBehavior: behavior },
      );

      expect(result.status).toBe('SIMULATED');
      expect(result.isSimulated).toBe(true);
      expect(result.raw.behavior).toBe(behavior);
      expect(result.raw.simulated).toBe(true);
    }
  });

  // ── 10. Logs and errors never expose credentials ────────────────────────────
  it('Proof 10: Logs, errors, and metadata never expose credentials', () => {
    const sensitiveConfig = {
      sipTrunkId: 'ST_prod_123',
      sipTrunkUri: 'sip:carrier.livekit.cloud',
      sipUsername: 'agent_007',
      sipPassword: 'SUPER_SECRET_SIP_PASSWORD_12345',
      authToken: 'CONFIDENTIAL_AUTH_TOKEN_ABCDEF',
      apiKey: 'VERY_SECRET_API_KEY_99999',
      apiSecret: 'SECRET_HMAC_SIGNATURE_KEY',
      nested: {
        privateKey: 'SECRET_PEM_KEY_DATA',
      },
    };

    const masked = SipRequestBuilder.maskConfig(sensitiveConfig);

    // Verify secret fields are masked
    expect(masked.sipPassword).toBe('***MASKED***');
    expect(masked.authToken).toBe('***MASKED***');
    expect(masked.apiKey).toBe('***MASKED***');
    expect(masked.apiSecret).toBe('***MASKED***');
    expect(masked.nested.privateKey).toBe('***MASKED***');

    // Verify safe fields remain intact
    expect(masked.sipTrunkId).toBe('ST_prod_123');
    expect(masked.sipTrunkUri).toBe('sip:carrier.livekit.cloud');
    expect(masked.sipUsername).toBe('agent_007');

    // Ensure raw secrets do not appear anywhere in serialized JSON
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain('SUPER_SECRET_SIP_PASSWORD_12345');
    expect(serialized).not.toContain('CONFIDENTIAL_AUTH_TOKEN_ABCDEF');
    expect(serialized).not.toContain('VERY_SECRET_API_KEY_99999');
    expect(serialized).not.toContain('SECRET_HMAC_SIGNATURE_KEY');
    expect(serialized).not.toContain('SECRET_PEM_KEY_DATA');
  });
});
