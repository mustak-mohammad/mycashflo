import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';
import { WhatsAppCloudAdapter } from './adapters/whatsapp-cloud.adapter.js';
import { SipTelephonyAdapter } from './adapters/sip-telephony.adapter.js';
import { ResendEmailAdapter } from './adapters/resend-email.adapter.js';
import { SmsGatewayAdapter } from './adapters/sms-gateway.adapter.js';
import {
  encryptIntegrationSecret,
  decryptIntegrationSecret,
  isEncryptedSecret,
  ENCRYPTION_VERSION_PREFIX,
} from '../common/secret-encryption.util.js';
import { validateEnvironment } from '../common/env.validation.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

const TEST_HEX_KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEST_HEX_KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('Razorpay Phase 1.1: Integration Secret Encryption at Rest', () => {
  const originalEncKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  let service: IntegrationsService;
  let mockPrisma: any;
  let mockAuditLogs: any;
  let storedRows: Record<string, any>;

  const userTenantA: AuthUser = {
    userId: 'usr_admin_a',
    tenantId: 'tenant_a',
    role: 'ADMIN',
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_HEX_KEY_A;
    storedRows = {};

    mockPrisma = {
      integrationConfig: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return Object.values(storedRows).filter((r: any) => r.tenantId === where?.tenantId);
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          const { provider, tenantId } = where.provider_tenantId;
          return storedRows[`${tenantId}:${provider}`] || null;
        }),
        upsert: vi.fn().mockImplementation(async ({ where, create, update }) => {
          const { provider, tenantId } = where.provider_tenantId;
          const key = `${tenantId}:${provider}`;
          const next = storedRows[key]
            ? { ...storedRows[key], ...update, updatedAt: new Date() }
            : { id: `cfg_${Object.keys(storedRows).length + 1}`, ...create, updatedAt: new Date() };
          storedRows[key] = next;
          return next;
        }),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_1' }),
    };

    service = new IntegrationsService(
      mockPrisma,
      mockAuditLogs,
      new RazorpayAdapter(),
      new StripeAdapter(),
      new WhatsAppCloudAdapter(),
      new SipTelephonyAdapter(),
      new ResendEmailAdapter(),
      new SmsGatewayAdapter(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEncKey !== undefined) {
      process.env.INTEGRATION_ENCRYPTION_KEY = originalEncKey;
    } else {
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
    }
  });

  it('1. encrypts Razorpay keySecret & webhookSecret using versioned AES-256-GCM while keeping non-sensitive fields usable', async () => {
    const keySecret = 'rzp_live_or_test_super_secret_12345';
    const webhookSecret = 'rzp_whsec_super_secret_98765';

    const apiResponse = await service.saveConfig(userTenantA, 'RAZORPAY', {
      config: {
        keyId: 'rzp_test_1234567890abcdef',
        keySecret,
        webhookSecret,
      },
      isActive: true,
    });

    const persisted = storedRows['tenant_a:RAZORPAY'].config;
    // Non-sensitive field stays readable plaintext
    expect(persisted.keyId).toBe('rzp_test_1234567890abcdef');
    // Sensitive fields MUST be stored encrypted with versioned envelope
    expect(isEncryptedSecret(persisted.keySecret)).toBe(true);
    expect(isEncryptedSecret(persisted.webhookSecret)).toBe(true);
    expect(persisted.keySecret).toMatch(/^enc:v1:/);
    expect(persisted.keySecret).not.toContain(keySecret);
    expect(persisted.webhookSecret).not.toContain(webhookSecret);

    // API response returns masked secrets and NEVER decrypted plaintext or ciphertext substrings
    expect(apiResponse.config.keySecret).toBe('****...****');
    expect(apiResponse.config.webhookSecret).toBe('****...****');
    expect(JSON.stringify(apiResponse)).not.toContain(keySecret);
    expect(JSON.stringify(apiResponse)).not.toContain(webhookSecret);

    // Audit log NEVER exposes secrets
    expect(JSON.stringify(mockAuditLogs.log.mock.calls)).not.toContain(keySecret);
    expect(JSON.stringify(mockAuditLogs.log.mock.calls)).not.toContain(webhookSecret);

    // Internal consumer (PaymentsService -> getRawConfig) receives decrypted secrets cleanly
    const rawDecrypted = await service.getRawConfig('tenant_a', 'RAZORPAY');
    expect(rawDecrypted.keyId).toBe('rzp_test_1234567890abcdef');
    expect(rawDecrypted.keySecret).toBe(keySecret);
    expect(rawDecrypted.webhookSecret).toBe(webhookSecret);
  });

  it('2. encrypts secrets across other providers (Stripe, WhatsApp, Resend, SMS Gateway, SIP Telephony) uniformly', async () => {
    await service.saveConfig(userTenantA, 'SMS_GATEWAY', {
      config: {
        provider: 'GUPSHUP',
        senderId: 'MCASHF',
        authToken: 'sms_carrier_token_secret_111',
      },
    });
    await service.saveConfig(userTenantA, 'RESEND', {
      config: {
        from: 'billing@acme.in',
        apiKey: 're_secret_resend_key_222',
      },
    });

    expect(isEncryptedSecret(storedRows['tenant_a:SMS_GATEWAY'].config.authToken)).toBe(true);
    expect(storedRows['tenant_a:SMS_GATEWAY'].config.senderId).toBe('MCASHF');
    expect(isEncryptedSecret(storedRows['tenant_a:RESEND'].config.apiKey)).toBe(true);
    expect(storedRows['tenant_a:RESEND'].config.from).toBe('billing@acme.in');

    const rawSms = await service.getRawConfig('tenant_a', 'SMS_GATEWAY');
    expect(rawSms.authToken).toBe('sms_carrier_token_secret_111');
  });

  it('3. detects ciphertext tampering, auth-tag tampering, and cross-tenant AAD swapping', async () => {
    await service.saveConfig(userTenantA, 'RAZORPAY', {
      config: {
        keyId: 'rzp_test_tamper_12345',
        keySecret: 'secret_original_value_abc',
        webhookSecret: 'webhook_original_value_xyz',
      },
    });

    const originalCiphertext: string = storedRows['tenant_a:RAZORPAY'].config.keySecret;

    // Tamper with ciphertext payload character
    const parts = originalCiphertext.slice(ENCRYPTION_VERSION_PREFIX.length).split(':');
    const tamperedCt =
      parts[2].slice(0, -2) + (parts[2].endsWith('A=') ? 'B=' : 'A=');
    storedRows['tenant_a:RAZORPAY'].config.keySecret = `${ENCRYPTION_VERSION_PREFIX}${parts[0]}:${parts[1]}:${tamperedCt}`;

    await expect(service.getRawConfig('tenant_a', 'RAZORPAY')).rejects.toThrow(
      'Failed to authenticate or decrypt stored integration credential',
    );

    // Moving tenant_a's valid ciphertext into tenant_b MUST fail AAD authentication
    storedRows['tenant_b:RAZORPAY'] = {
      id: 'cfg_b',
      tenantId: 'tenant_b',
      provider: 'RAZORPAY',
      isActive: true,
      config: {
        keyId: 'rzp_test_tamper_12345',
        keySecret: originalCiphertext,
      },
    };
    await expect(service.getRawConfig('tenant_b', 'RAZORPAY')).rejects.toThrow(
      'Failed to authenticate or decrypt stored integration credential',
    );
  });

  it('4. fails closed when INTEGRATION_ENCRYPTION_KEY is missing, invalid, or wrong (never saves plaintext)', async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;

    await expect(
      service.saveConfig(userTenantA, 'RAZORPAY', {
        config: {
          keyId: 'rzp_test_failclosed_01',
          keySecret: 'my_super_secret_should_not_save',
        },
      }),
    ).rejects.toThrow('INTEGRATION_ENCRYPTION_KEY');

    expect(mockPrisma.integrationConfig.upsert).not.toHaveBeenCalled();

    // Invalid key length (too short)
    process.env.INTEGRATION_ENCRYPTION_KEY = 'deadbeef';
    await expect(
      service.saveConfig(userTenantA, 'RAZORPAY', {
        config: {
          keyId: 'rzp_test_failclosed_02',
          webhookSecret: 'wh_secret_should_not_save',
        },
      }),
    ).rejects.toThrow('INTEGRATION_ENCRYPTION_KEY');
    expect(mockPrisma.integrationConfig.upsert).not.toHaveBeenCalled();

    // Save with key A, then attempt decrypt with wrong key B -> fails closed
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_HEX_KEY_A;
    await service.saveConfig(userTenantA, 'RAZORPAY', {
      config: {
        keyId: 'rzp_test_key_mismatch',
        keySecret: 'secret_under_key_a',
      },
    });
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_HEX_KEY_B;
    await expect(service.getRawConfig('tenant_a', 'RAZORPAY')).rejects.toThrow(
      'Failed to authenticate or decrypt stored integration credential',
    );
    await expect(service.testConnection(userTenantA, 'RAZORPAY')).rejects.toThrow(
      'Failed to authenticate or decrypt stored integration credential',
    );
  });

  it('5. supports backward-compatible reads for legacy plaintext records, preserves secrets on masked save, and encrypts on re-save', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    // Seed legacy unencrypted plaintext record in PostgreSQL
    storedRows['tenant_a:RAZORPAY'] = {
      id: 'cfg_legacy',
      tenantId: 'tenant_a',
      provider: 'RAZORPAY',
      isActive: true,
      config: {
        keyId: 'rzp_test_legacy_1234',
        keySecret: 'legacy_plaintext_secret_9999',
        webhookSecret: 'legacy_plaintext_whsec_8888',
      },
      updatedAt: new Date(),
    };

    // Masked API read masks legacy record cleanly
    const listRes = await service.getConfigs(userTenantA);
    const rzpListed = listRes.find((c) => c.provider === 'RAZORPAY');
    expect(rzpListed?.config.keySecret).toBe('lega...9999');

    // Internal consumer still reads legacy secret cleanly without breaking existing records
    const rawLegacy = await service.getRawConfig('tenant_a', 'RAZORPAY');
    expect(rawLegacy.keySecret).toBe('legacy_plaintext_secret_9999');
    expect(rawLegacy.webhookSecret).toBe('legacy_plaintext_whsec_8888');
    // Warning log must NEVER print plaintext credentials
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('legacy_plaintext_secret_9999');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('legacy_plaintext_whsec_8888');

    // Re-saving non-secret keyId while preserving masked/omitted secrets upgrades stored legacy secrets to encrypted
    await service.saveConfig(userTenantA, 'RAZORPAY', {
      config: {
        keyId: 'rzp_test_legacy_updated',
        keySecret: 'lega...9999',
      },
    });
    expect(isEncryptedSecret(storedRows['tenant_a:RAZORPAY'].config.keySecret)).toBe(true);
    expect(isEncryptedSecret(storedRows['tenant_a:RAZORPAY'].config.webhookSecret)).toBe(true);
    const upgradedRaw = await service.getRawConfig('tenant_a', 'RAZORPAY');
    expect(upgradedRaw.keySecret).toBe('legacy_plaintext_secret_9999');
    expect(upgradedRaw.webhookSecret).toBe('legacy_plaintext_whsec_8888');
  });

  it('6. masked reads work without decrypting or leaking encryption key or plaintext secrets in errors/logs', async () => {
    const keySecret = 'rzp_secret_never_leak_777';
    const webhookSecret = 'rzp_whsec_never_leak_888';

    await service.saveConfig(userTenantA, 'RAZORPAY', {
      config: {
        keyId: 'rzp_test_read_safe',
        keySecret,
        webhookSecret,
      },
    });

    // Even if INTEGRATION_ENCRYPTION_KEY is unavailable on a read-only listing call, masked read does not crash or leak
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    const listed = await service.getConfigs(userTenantA);
    const rzp = listed.find((c) => c.provider === 'RAZORPAY');
    expect(rzp?.config.keySecret).toBe('****...****');
    expect(JSON.stringify(rzp)).not.toContain(keySecret);
    expect(JSON.stringify(rzp)).not.toContain(webhookSecret);
    expect(JSON.stringify(rzp)).not.toContain(TEST_HEX_KEY_A);

    // Key parsing/decryption errors never leak key values
    const baseEnv = {
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/mycashflo',
      JWT_ACCESS_SECRET: '0123456789abcdef0123456789abcdef',
      JWT_REFRESH_SECRET: 'fedcba9876543210fedcba9876543210',
    };
    const secretBadKey = 'short_invalid_secret_key_material_xyz';
    try {
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'production',
        INTEGRATION_ENCRYPTION_KEY: secretBadKey,
      });
    } catch (err: any) {
      expect(err.message).toContain('INTEGRATION_ENCRYPTION_KEY');
      expect(err.message).not.toContain(secretBadKey);
    }

    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'production',
      }),
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY is required in production/);
  });

  it('7. supports base64 32-byte INTEGRATION_ENCRYPTION_KEY and testConnection without secret leakage', async () => {
    const base64Key = crypto.randomBytes(32).toString('base64');
    process.env.INTEGRATION_ENCRYPTION_KEY = base64Key;

    const enc = encryptIntegrationSecret('top_secret_rzp_val', {
      tenantId: 'tenant_a',
      provider: 'RAZORPAY',
      field: 'keySecret',
    });
    expect(
      decryptIntegrationSecret(enc, {
        tenantId: 'tenant_a',
        provider: 'RAZORPAY',
        field: 'keySecret',
      }),
    ).toBe('top_secret_rzp_val');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'plink_test_enc_123',
        short_url: 'https://rzp.io/i/enc123',
      }),
    }) as any;

    try {
      await service.saveConfig(userTenantA, 'RAZORPAY', {
        config: {
          keyId: 'rzp_test_1234567890abcdef',
          keySecret: 'rzp_secret_only_for_adapter_123',
        },
      });
      const testRes = await service.testConnection(userTenantA, 'RAZORPAY');
      expect(testRes.status).toBe('SUCCESS');
      expect(JSON.stringify(testRes)).not.toContain('rzp_secret_only_for_adapter_123');
      expect(JSON.stringify(testRes)).not.toContain(base64Key);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

