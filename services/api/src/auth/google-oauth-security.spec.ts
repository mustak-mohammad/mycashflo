import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { DocumentDeliveryService } from '../voice/document-delivery.service.js';
import { ResendEmailAdapter } from '../integrations/adapters/resend-email.adapter.js';
import { WhatsAppCloudAdapter } from '../integrations/adapters/whatsapp-cloud.adapter.js';
import { SmsGatewayAdapter } from '../integrations/adapters/sms-gateway.adapter.js';
import { validateEnvironment } from '../common/env.validation.js';

describe('Google OAuth & Auth Fallback Security Hardening', () => {
  let mockPrisma: any;
  let mockJwt: any;
  let envValues: Record<string, string | undefined>;
  let mockConfig: any;
  let users: any[];
  let tenants: any[];
  let storedTokens: any[];
  let originalNodeEnv: string | undefined;
  let originalAllowDevMock: string | undefined;
  let originalGoogleClientId: string | undefined;
  let originalJwtAccessSecret: string | undefined;
  let originalJwtSecret: string | undefined;
  let originalDocSecret: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  const createService = () => new AuthService(mockPrisma, mockJwt, mockConfig);

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalAllowDevMock = process.env.ALLOW_DEV_MOCK_AUTH;
    originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    originalJwtAccessSecret = process.env.JWT_ACCESS_SECRET;
    originalJwtSecret = process.env.JWT_SECRET;
    originalDocSecret = process.env.DOCUMENT_DELIVERY_HMAC_SECRET;
    originalFetch = globalThis.fetch;

    delete process.env.ALLOW_DEV_MOCK_AUTH;
    delete process.env.GOOGLE_CLIENT_ID;

    tenants = [
      { id: 'tenant_001', name: 'Demo Corp', slug: 'democorp' },
    ];
    users = [
      {
        id: 'user_admin',
        email: 'admin@democorp.in',
        name: 'Priya Sharma',
        role: 'ADMIN',
        tenantId: 'tenant_001',
        isActive: true,
        tenant: tenants[0],
      },
      {
        id: 'user_superadmin',
        email: 'superadmin@mycashflo.internal',
        name: 'Platform Super Admin',
        role: 'SUPER_ADMIN',
        tenantId: 'tenant_platform',
        isActive: true,
        tenant: { id: 'tenant_platform', name: 'Platform', slug: 'platform' },
      },
    ];
    storedTokens = [];

    envValues = {
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'test_access_secret_key_min_16_chars',
      JWT_REFRESH_SECRET: 'test_refresh_secret_key_min_16_chars',
      GOOGLE_CLIENT_ID: 'real-client-id.apps.googleusercontent.com',
      ALLOW_DEV_MOCK_AUTH: undefined,
    };

    mockConfig = {
      get: vi.fn((key: string) => envValues[key]),
    };

    mockJwt = {
      sign: vi.fn((payload, options) => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = crypto
          .createHmac('sha256', options.secret)
          .update(`${header}.${body}`)
          .digest('base64url');
        return `${header}.${body}.${sig}`;
      }),
      verify: vi.fn(),
    };

    mockPrisma = {
      user: {
        findFirst: vi.fn(async ({ where }) => {
          return (
            users.find(
              (u) =>
                u.email === where.email &&
                (where.isActive === undefined || u.isActive === where.isActive),
            ) || null
          );
        }),
        create: vi.fn(async ({ data }) => {
          const tenant = tenants.find((t) => t.id === data.tenantId);
          const created = {
            id: `user_${users.length + 1}`,
            isActive: true,
            ...data,
            tenant,
          };
          users.push(created);
          return created;
        }),
      },
      tenant: {
        create: vi.fn(async ({ data }) => {
          const created = { id: `tenant_${tenants.length + 1}`, ...data };
          tenants.push(created);
          return created;
        }),
      },
      refreshToken: {
        create: vi.fn(async ({ data }) => {
          storedTokens.push(data);
          return data;
        }),
      },
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowDevMock === undefined) delete process.env.ALLOW_DEV_MOCK_AUTH;
    else process.env.ALLOW_DEV_MOCK_AUTH = originalAllowDevMock;
    if (originalGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    if (originalJwtAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalJwtAccessSecret;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalDocSecret === undefined) delete process.env.DOCUMENT_DELIVERY_HMAC_SECRET;
    else process.env.DOCUMENT_DELIVERY_HMAC_SECRET = originalDocSecret;

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Google OAuth Mock-Token Restrictions', () => {
    it('1. always rejects tokens beginning with mock_ in production and issues no JWT', async () => {
      process.env.NODE_ENV = 'production';
      envValues.NODE_ENV = 'production';
      const service = createService();

      await expect(
        service.googleAuth({
          idToken: 'mock_google_token_123',
          email: 'admin@democorp.in',
        }),
      ).rejects.toThrow(new UnauthorizedException('Mock Google authentication is forbidden in production'));

      // Also reject uppercase / leading-space variants
      await expect(
        service.googleAuth({
          idToken: '  MOCK_google_token_456',
          email: 'admin@democorp.in',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockJwt.sign).not.toHaveBeenCalled();
      expect(storedTokens).toHaveLength(0);
    });

    it('2. never allows ALLOW_DEV_MOCK_AUTH=true to override production restriction', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DEV_MOCK_AUTH = 'true';
      envValues.NODE_ENV = 'production';
      envValues.ALLOW_DEV_MOCK_AUTH = 'true';

      const service = createService();

      await expect(
        service.googleAuth({
          idToken: 'mock_google_token_override_attempt',
          email: 'admin@democorp.in',
        }),
      ).rejects.toThrow(new UnauthorizedException('Mock Google authentication is forbidden in production'));

      expect(mockJwt.sign).not.toHaveBeenCalled();
      expect(storedTokens).toHaveLength(0);
    });

    it('3. rejects mock tokens by default in non-production when ALLOW_DEV_MOCK_AUTH is disabled/unset', async () => {
      process.env.NODE_ENV = 'development';
      envValues.NODE_ENV = 'development';
      envValues.ALLOW_DEV_MOCK_AUTH = undefined;

      const service = createService();

      await expect(
        service.googleAuth({
          idToken: 'mock_google_token_default_off',
          email: 'admin@democorp.in',
        }),
      ).rejects.toThrow(UnauthorizedException);

      envValues.ALLOW_DEV_MOCK_AUTH = 'false';
      await expect(
        service.googleAuth({
          idToken: 'mock_google_token_explicit_false',
          email: 'admin@democorp.in',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('4. accepts mock token ONLY in explicitly enabled non-production environment and still blocks SUPER_ADMIN', async () => {
      process.env.NODE_ENV = 'development';
      envValues.NODE_ENV = 'development';
      envValues.ALLOW_DEV_MOCK_AUTH = 'true';

      const service = createService();

      const result = await service.googleAuth({
        idToken: 'mock_google_token_dev',
        email: 'admin@democorp.in',
        name: 'Priya Sharma',
      });

      expect(result.user.email).toBe('admin@democorp.in');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);

      // Even in enabled dev mode, mock auth cannot impersonate SUPER_ADMIN
      await expect(
        service.googleAuth({
          idToken: 'mock_superadmin_attempt',
          email: 'superadmin@mycashflo.internal',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Mock authentication cannot be used for Super Admin accounts'),
      );
    });
  });

  describe('Legitimate Google OAuth Verification Flow', () => {
    it('5. rejects invalid real Google ID tokens returned as non-OK by Google tokeninfo', async () => {
      process.env.NODE_ENV = 'production';
      envValues.NODE_ENV = 'production';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      } as any);

      const service = createService();
      await expect(
        service.googleAuth({ idToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.invalid.sig' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid Google ID token'));

      expect(mockJwt.sign).not.toHaveBeenCalled();
    });

    it('6. rejects real Google tokens with unverified email, mismatched audience, or missing GOOGLE_CLIENT_ID in prod', async () => {
      process.env.NODE_ENV = 'production';
      envValues.NODE_ENV = 'production';
      const service = createService();

      // Case A: Unverified email
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          email: 'admin@democorp.in',
          email_verified: false,
          aud: 'real-client-id.apps.googleusercontent.com',
        }),
      } as any);

      await expect(
        service.googleAuth({ idToken: 'real.google.jwt.unverified' }),
      ).rejects.toThrow(new UnauthorizedException('Google email is not verified'));

      // Case B: Audience mismatch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          email: 'admin@democorp.in',
          email_verified: 'true',
          aud: 'attacker-other-app.apps.googleusercontent.com',
        }),
      } as any);

      await expect(
        service.googleAuth({ idToken: 'real.google.jwt.wrong_aud' }),
      ).rejects.toThrow(new UnauthorizedException('Google token audience mismatch'));

      // Case C: Placeholder/missing GOOGLE_CLIENT_ID in production fails closed
      envValues.GOOGLE_CLIENT_ID = 'your_google_client_id.apps.googleusercontent.com';
      await expect(
        service.googleAuth({ idToken: 'real.google.jwt.no_client_id' }),
      ).rejects.toThrow(new UnauthorizedException('Google OAuth is not configured on this server'));
    });

    it('7. preserves legitimate Google OAuth login and new-tenant signup in production', async () => {
      process.env.NODE_ENV = 'production';
      envValues.NODE_ENV = 'production';
      const service = createService();

      // Existing user login
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          email: 'admin@democorp.in',
          email_verified: true,
          name: 'Priya Sharma',
          aud: 'real-client-id.apps.googleusercontent.com',
        }),
      } as any);

      const loginResult = await service.googleAuth({ idToken: 'valid.google.id.token' });
      expect(loginResult.user.email).toBe('admin@democorp.in');
      expect(loginResult.user.role).toBe('ADMIN');
      expect(loginResult.tokens.accessToken).toBeDefined();

      // New user signup
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          email: 'newfounder@acme.in',
          email_verified: 'true',
          name: 'Aarav Mehta',
          aud: 'real-client-id.apps.googleusercontent.com',
        }),
      } as any);

      const signupResult = await service.googleAuth({ idToken: 'valid.google.id.token.new' });
      expect(signupResult.user.email).toBe('newfounder@acme.in');
      expect(signupResult.user.role).toBe('ADMIN');
      expect(signupResult.tokens.accessToken).toBeDefined();
      expect(mockPrisma.tenant.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Other Authentication & Signature Fallbacks', () => {
    it('8. JwtStrategy refuses to initialize with fallback secret in production or non-test without JWT_ACCESS_SECRET', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_ACCESS_SECRET;
      const prodMissingConfig = {
        get: vi.fn((key: string) => (key === 'NODE_ENV' ? 'production' : undefined)),
      } as any;

      expect(() => new JwtStrategy(prodMissingConfig, mockPrisma)).toThrow(
        'JWT_ACCESS_SECRET is required and cannot use a fallback secret',
      );
    });

    it('9. DocumentDeliveryService refuses hardcoded fallback HMAC secret in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DOCUMENT_DELIVERY_HMAC_SECRET;
      delete process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_SECRET;

      expect(
        () =>
          new DocumentDeliveryService(
            mockPrisma,
            {} as any,
            {} as any,
            {} as any,
          ),
      ).toThrow('DOCUMENT_DELIVERY_HMAC_SECRET or JWT_ACCESS_SECRET must be configured');
    });

    it('10. Notification/webhook adapters reject mock/sim signatures and demo secrets in production', () => {
      process.env.NODE_ENV = 'production';
      const resend = new ResendEmailAdapter();
      const whatsapp = new WhatsAppCloudAdapter();
      const sms = new SmsGatewayAdapter();

      expect(resend.verifyWebhookSignature({ type: 'email.delivered' }, 'mock_valid_signature')).toBe(false);
      expect(resend.verifyWebhookSignature({ type: 'email.delivered' }, 'sim_123')).toBe(false);

      expect(whatsapp.verifyWebhookSignature({ entry: [] }, 'mock_valid_signature')).toBe(false);
      expect(whatsapp.verifyWebhookSignature({ entry: [] }, 'sim_123')).toBe(false);
      expect(
        whatsapp.verifyWebhookChallenge('subscribe', 'mycashflo_whatsapp_verify_token', 'ch_1'),
      ).toBeNull();

      expect(sms.verifyWebhookSignature({ MessageStatus: 'delivered' }, 'mock_sms_valid_signature')).toBe(false);
      expect(sms.verifyWebhookSignature({ MessageStatus: 'delivered' }, 'sim_sms_123')).toBe(false);
    });

    it('11. validateEnvironment validates ALLOW_DEV_MOCK_AUTH boolean string format', () => {
      const base = {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/mycashflo',
        JWT_ACCESS_SECRET: '1234567890abcdef1234567890abcdef',
        JWT_REFRESH_SECRET: 'abcdef1234567890abcdef1234567890',
      };

      expect(() => validateEnvironment({ ...base, ALLOW_DEV_MOCK_AUTH: 'false' })).not.toThrow();
      expect(() => validateEnvironment({ ...base, ALLOW_DEV_MOCK_AUTH: 'true' })).not.toThrow();
      expect(() => validateEnvironment({ ...base, ALLOW_DEV_MOCK_AUTH: 'yes' })).toThrow(
        'ALLOW_DEV_MOCK_AUTH must be "true" or "false"',
      );
    });
  });
});

