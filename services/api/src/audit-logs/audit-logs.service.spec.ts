import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogsService, sanitizeAuditMetadata } from './audit-logs.service.js';

describe('AuditLogsService & Metadata Sanitization (SEC-INPUT-001)', () => {
  let service: AuditLogsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'user_123' }),
      },
      auditLog: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'aud_1',
          ...data,
          createdAt: new Date(),
        })),
      },
    };
    service = new AuditLogsService(mockPrisma);
  });

  describe('sanitizeAuditMetadata', () => {
    it('redacts sensitive keys including password, token, apiKey, and secret', () => {
      const input = {
        username: 'john_doe',
        password: 'SuperSecretPassword@123',
        newPassword: 'AnotherPassword@123',
        passwordHash: '$2b$12$xyz...',
        token: 'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
        accessToken: 'access_12345',
        refreshToken: 'refresh_67890',
        apiKey: 'rzp_live_secretkey123',
        keySecret: 'topsecretkey',
        webhookSecret: 'whsec_98765',
        authorization: 'Bearer secret_token',
        nested: {
          clientSecret: 'secret_val',
          safeField: 'visible_val',
        },
      };

      const result = sanitizeAuditMetadata(input);

      expect(result.username).toBe('john_doe');
      expect(result.password).toBe('[REDACTED]');
      expect(result.newPassword).toBe('[REDACTED]');
      expect(result.passwordHash).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.refreshToken).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.keySecret).toBe('[REDACTED]');
      expect(result.webhookSecret).toBe('[REDACTED]');
      expect(result.authorization).toBe('[REDACTED]');
      expect(result.nested.clientSecret).toBe('[REDACTED]');
      expect(result.nested.safeField).toBe('visible_val');
    });

    it('redacts bearer tokens in string values', () => {
      const input = {
        header: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        auth: 'bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo.bar',
      };
      const result = sanitizeAuditMetadata(input);
      expect(result.header).toBe('[REDACTED]');
      expect(result.auth).toBe('[REDACTED]');
    });

    it('preserves safe metadata untouched', () => {
      const safe = {
        action: 'invoice.downloaded',
        invoiceNumber: 'INV-2026-001',
        amount: 50000,
        status: 'PAID',
        customerName: 'Acme Corp',
      };
      const result = sanitizeAuditMetadata(safe);
      expect(result).toEqual(safe);
    });
  });

  describe('AuditLogsService.log', () => {
    it('persists sanitized metadata to the database', async () => {
      await service.log({
        tenantId: 'tenant_1',
        userId: 'user_123',
        action: 'auth.login_attempt',
        metadata: {
          email: 'user@test.com',
          password: 'AttemptedPassword123',
          apiKey: 'key_123',
        },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant_1',
          userId: 'user_123',
          action: 'auth.login_attempt',
          metadata: {
            email: 'user@test.com',
            password: '[REDACTED]',
            apiKey: '[REDACTED]',
          },
        }),
      });
    });
  });
});
