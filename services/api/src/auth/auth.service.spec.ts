import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import * as crypto from 'crypto';

describe('AuthService - Refresh Token Flow & Security Tests', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockConfig: any;

  let storedTokens: any[];
  let users: any[];

  const ACCESS_SECRET = 'test_access_secret_12345';
  const REFRESH_SECRET = 'test_refresh_secret_67890';

  const hashToken = (token: string) =>
    crypto.createHash('sha256').update(token).digest('hex');

  beforeEach(() => {
    users = [
      {
        id: 'user_001',
        email: 'agent@democorp.in',
        passwordHash: '$2b$12$eX4mPl3H4sH1234567890abcdefghijklmnopqrstuv',
        name: 'Agent Smith',
        role: 'AGENT',
        tenantId: 'tenant_001',
        isActive: true,
        tenant: { id: 'tenant_001', name: 'Demo Corp', slug: 'democorp' },
      },
    ];

    storedTokens = [];

    mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return ACCESS_SECRET;
        if (key === 'JWT_REFRESH_SECRET') return REFRESH_SECRET;
        return null;
      }),
    };

    mockJwt = {
      sign: vi.fn().mockImplementation((payload, options) => {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + (options.expiresIn || 3600) })).toString('base64url');
        const sig = crypto.createHmac('sha256', options.secret || 'secret').update(`${header}.${body}`).digest('base64url');
        return `${header}.${body}.${sig}`;
      }),
      verify: vi.fn().mockImplementation((token, options) => {
        const parts = token.split('.');
        if (parts.length !== 3) {
          throw new Error('jwt malformed');
        }
        const [header, body, sig] = parts;
        const expectedSig = crypto.createHmac('sha256', options.secret).update(`${header}.${body}`).digest('base64url');
        if (sig !== expectedSig) {
          throw new Error('invalid signature');
        }
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
          throw new Error('jwt expired');
        }
        return payload;
      }),
    };

    mockPrisma = {
      refreshToken: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          return storedTokens.find((t) => t.token === where.token) || null;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return storedTokens.filter((t) => t.userId === where.userId);
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const t = storedTokens.find((item) => item.id === where.id);
          if (t) {
            Object.assign(t, data);
            return { ...t };
          }
          return null;
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          for (const t of storedTokens) {
            if (t.userId === where.userId && (where.revoked === undefined || t.revoked === where.revoked)) {
              Object.assign(t, data);
              count++;
            }
          }
          return { count };
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const newRec = {
            id: `rt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            revoked: false,
            createdAt: new Date(),
            ...data,
          };
          storedTokens.push(newRec);
          return newRec;
        }),
      },
      user: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            users.find(
              (u) =>
                (where.id === undefined || u.id === where.id) &&
                (where.email === undefined || u.email === where.email) &&
                (where.tenantId === undefined || u.tenantId === where.tenantId) &&
                (where.isActive === undefined || u.isActive === where.isActive),
            ) || null
          );
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const u = users.find((item) => item.id === where.id);
          if (u) {
            Object.assign(u, data);
            return { ...u };
          }
          return null;
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'aud_test_01' }),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        return await cb(mockPrisma);
      }),
    };

    service = new AuthService(mockPrisma, mockJwt, mockConfig);
  });

  // 1. Valid Refresh
  it('1. should rotate tokens when a valid refresh token is supplied', async () => {
    // Initial token issuance
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    expect(initial.refreshToken).toBeDefined();
    expect(storedTokens.length).toBe(1);

    const refreshResult = await service.refresh(initial.refreshToken);

    expect(refreshResult.tokens).toBeDefined();
    expect(refreshResult.tokens.accessToken).toBeDefined();
    expect(refreshResult.tokens.refreshToken).toBeDefined();
    expect(refreshResult.tokens.refreshToken).not.toBe(initial.refreshToken);
    expect(refreshResult.tokens.expiresIn).toBe(3600);

    // Stored tokens count should now be 2: original is revoked, new is active
    expect(storedTokens.length).toBe(2);
    expect(storedTokens[0].revoked).toBe(true);
    expect(storedTokens[1].revoked).toBe(false);
  });

  // 2. Expired Token
  it('2. should reject an expired refresh token', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    const tokenRecord = storedTokens[0];
    // Mark as expired in DB
    tokenRecord.expiresAt = new Date(Date.now() - 10000);

    await expect(service.refresh(initial.refreshToken)).rejects.toThrow(
      'Refresh token has expired',
    );
  });

  // 3. Invalid Token
  it('3. should reject an invalid signature or malformed refresh token', async () => {
    await expect(service.refresh('not.a.valid.jwt')).rejects.toThrow(
      'Invalid or expired refresh token',
    );

    // Valid JWT format but forged with wrong secret
    const forged = mockJwt.sign({ sub: 'user_001' }, { secret: 'wrong_secret' });
    await expect(service.refresh(forged)).rejects.toThrow(
      'Invalid or expired refresh token',
    );
  });

  // 4. Revoked Token
  it('4. should reject a previously revoked refresh token', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    storedTokens[0].revoked = true;

    await expect(service.refresh(initial.refreshToken)).rejects.toThrow(
      'Refresh token has been revoked or reused',
    );
  });

  // 5. Token Rotation
  it('5. should securely rotate refresh tokens and revoke the previous token', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    const oldHash = hashToken(initial.refreshToken);

    const rotated = await service.refresh(initial.refreshToken);

    const oldRecord = storedTokens.find((t) => t.token === oldHash);
    expect(oldRecord.revoked).toBe(true);

    const newHash = hashToken(rotated.tokens.refreshToken);
    const newRecord = storedTokens.find((t) => t.token === newHash);
    expect(newRecord).toBeDefined();
    expect(newRecord.revoked).toBe(false);
  });

  // 6. Reuse Detection
  it('6. should detect token reuse and invalidate all user refresh tokens', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    // First rotation succeeds
    const rotated = await service.refresh(initial.refreshToken);
    expect(rotated.tokens.accessToken).toBeDefined();

    // Attacker tries to reuse the old refresh token
    await expect(service.refresh(initial.refreshToken)).rejects.toThrow(
      'Refresh token has been revoked or reused',
    );

    // All refresh tokens for user_001 should now be revoked
    const userTokens = storedTokens.filter((t) => t.userId === 'user_001');
    expect(userTokens.every((t) => t.revoked === true)).toBe(true);

    // Even the rotated token can no longer be refreshed because all sessions were invalidated
    await expect(service.refresh(rotated.tokens.refreshToken)).rejects.toThrow(
      'Refresh token has been revoked or reused',
    );
  });

  // 7. Concurrent Refresh Requests
  it('7. should handle concurrent refresh attempts safely without race conditions', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');

    // Simulate two concurrent refresh calls using the same refresh token
    const [res1, res2] = await Promise.all([
      service.refresh(initial.refreshToken),
      service.refresh(initial.refreshToken),
    ]);

    // Both calls safely receive identical rotated tokens from the in-flight promise
    expect(res1.tokens.accessToken).toBe(res2.tokens.accessToken);
    expect(res1.tokens.refreshToken).toBe(res2.tokens.refreshToken);
    expect(storedTokens.length).toBe(2); // Only 1 rotation occurred
  });

  // 8. Never Log or Return Stored Token Hashes
  it('8. should never return stored token hashes in the API response', async () => {
    const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
    const res = await service.refresh(initial.refreshToken);

    // The response must only contain JWT tokens, no DB token hash
    expect(res).not.toHaveProperty('tokenHash');
    expect(res).not.toHaveProperty('hash');
    expect(res.tokens).toBeDefined();
    expect(Object.keys(res.tokens)).toEqual(['accessToken', 'refreshToken', 'expiresIn']);
  });

  // ── Logout & Session Revocation Tests ────────────────────────────────────
  describe('Logout & Session Revocation', () => {
    it('9. should successfully revoke specific refresh token on logout', async () => {
      const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
      expect(storedTokens[0].revoked).toBe(false);

      const logoutRes = await service.logout('user_001', initial.refreshToken);
      expect(logoutRes.success).toBe(true);
      expect(storedTokens[0].revoked).toBe(true);
    });

    it('10. should reject refresh requests after token has been logged out', async () => {
      const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
      await service.logout('user_001', initial.refreshToken);

      await expect(service.refresh(initial.refreshToken)).rejects.toThrow(
        'Refresh token has been revoked or reused',
      );
    });

    it('11. should handle repeated logout requests safely and idempotently', async () => {
      const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');
      const firstLogout = await service.logout('user_001', initial.refreshToken);
      expect(firstLogout.success).toBe(true);

      const secondLogout = await service.logout('user_001', initial.refreshToken);
      expect(secondLogout.success).toBe(true);
    });

    it('12. should revoke all active user sessions when no specific refresh token is provided', async () => {
      await service.issueTokens('user_001', 'tenant_001', 'AGENT');
      await service.issueTokens('user_001', 'tenant_001', 'AGENT');
      expect(storedTokens.filter((t) => t.userId === 'user_001' && !t.revoked).length).toBe(2);

      const logoutRes = await service.logout('user_001');
      expect(logoutRes.success).toBe(true);
      expect(logoutRes.revokedCount).toBe(2);
      expect(storedTokens.filter((t) => t.userId === 'user_001' && !t.revoked).length).toBe(0);
    });

    it('13. should handle unknown or missing token in database idempotently', async () => {
      const unissuedToken = mockJwt.sign({ sub: 'user_001' }, { secret: REFRESH_SECRET });
      const res = await service.logout('user_001', unissuedToken);
      expect(res.success).toBe(true);
      expect(res.message).toBe('Session already terminated');
    });

    it('14. should reject cross-user session revocation attempts with ForbiddenException', async () => {
      users.push({
        id: 'user_002',
        email: 'attacker@othercorp.in',
        name: 'Attacker',
        role: 'AGENT',
        tenantId: 'tenant_002',
        isActive: true,
      });
      const user2Tokens = await service.issueTokens('user_002', 'tenant_002', 'AGENT');

      // User 1 tries to revoke User 2's token
      await expect(service.logout('user_001', user2Tokens.refreshToken)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.logout('user_001', user2Tokens.refreshToken)).rejects.toThrow(
        'Cannot revoke session belonging to another user',
      );

      // Verify User 2's token was not revoked
      const user2Record = storedTokens.find((t) => t.userId === 'user_002');
      expect(user2Record.revoked).toBe(false);
    });
  });

  // ── Profile Update (Display Name) Tests ─────────────────────────────────
  describe('Profile Update (Display Name)', () => {
    it('15. should successfully update display name and trim whitespace', async () => {
      const res = await service.updateProfile('user_001', 'tenant_001', {
        name: '  Agent Thomas Anderson  ',
      });

      expect(res.name).toBe('Agent Thomas Anderson');
      expect(res.id).toBe('user_001');
      expect(res.email).toBe('agent@democorp.in');
      expect(res.role).toBe('AGENT');
      expect(res.tenantId).toBe('tenant_001');

      // Verify DB record updated
      const updatedUser = users.find((u) => u.id === 'user_001');
      expect(updatedUser.name).toBe('Agent Thomas Anderson');

      // Verify audit log created
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.profile_updated',
            userId: 'user_001',
            tenantId: 'tenant_001',
            metadata: {
              previousName: 'Agent Smith',
              newName: 'Agent Thomas Anderson',
            },
          }),
        }),
      );
    });

    it('16. should reject empty or whitespace-only display names with BadRequestException', async () => {
      await expect(
        service.updateProfile('user_001', 'tenant_001', { name: '' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateProfile('user_001', 'tenant_001', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateProfile('user_001', 'tenant_001', {} as any),
      ).rejects.toThrow('Display name cannot be empty');
    });

    it('17. should enforce tenant isolation and reject cross-tenant profile updates', async () => {
      // User 1 belongs to tenant_001; attempting update with tenant_002 must fail
      await expect(
        service.updateProfile('user_001', 'tenant_999_wrong', { name: 'Hacker' }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.updateProfile('user_001', 'tenant_999_wrong', { name: 'Hacker' }),
      ).rejects.toThrow('User not found in tenant');
    });

    it('18. should strictly prevent modifying role, tenantId, or email through profile update', async () => {
      const originalUser = { ...users.find((u) => u.id === 'user_001') };

      // Pass attempt to modify role or tenantId
      const res = await service.updateProfile('user_001', 'tenant_001', {
        name: 'Safe Name',
        role: 'SUPER_ADMIN',
        tenantId: 'other_tenant',
        email: 'hacked@example.com',
      } as any);

      expect(res.name).toBe('Safe Name');
      expect(res.role).toBe(originalUser.role);
      expect(res.tenantId).toBe(originalUser.tenantId);
      expect(res.email).toBe(originalUser.email);

      const dbUser = users.find((u) => u.id === 'user_001');
      expect(dbUser.role).toBe('AGENT');
      expect(dbUser.tenantId).toBe('tenant_001');
      expect(dbUser.email).toBe('agent@democorp.in');
    });
  });

  // ── Password Reset Flow (SEC-AUTH-001) ──────────────────────────────────
  describe('Password Reset Flow (SEC-AUTH-001)', () => {
    it('19. should issue cryptographically signed, expiring reset token for valid user', async () => {
      const res = await service.forgotPassword({ email: 'agent@democorp.in' });
      expect(res.success).toBe(true);
      expect(res.message).toContain('password reset instructions have been issued');
      expect(res.token).toBeDefined();

      // Verify token payload structure
      const payload = mockJwt.verify(res.token, { secret: ACCESS_SECRET });
      expect(payload.sub).toBe('user_001');
      expect(payload.email).toBe('agent@democorp.in');
      expect(payload.type).toBe('PASSWORD_RESET');
      expect(payload.pwdSig).toBeDefined();
    });

    it('20. should prevent email enumeration when requesting reset for non-existent email', async () => {
      const res = await service.forgotPassword({ email: 'nonexistent@democorp.in' });
      expect(res.success).toBe(true);
      expect(res.message).toContain('password reset instructions have been issued');
      expect(res.token).toBeUndefined();
    });

    it('21. should reset password, invalidate old sessions, and enforce single-use token', async () => {
      const forgotRes = await service.forgotPassword({ email: 'agent@democorp.in' });
      const resetToken = forgotRes.token!;

      // Reset password with strong password
      const resetRes = await service.resetPassword({
        token: resetToken,
        newPassword: 'NewSecretPassword@2026',
      });
      expect(resetRes.success).toBe(true);
      expect(resetRes.message).toContain('successfully reset');

      // Attempting to reuse the exact same reset token must fail (single-use guarantee)
      await expect(
        service.resetPassword({
          token: resetToken,
          newPassword: 'AnotherPassword@2026',
        }),
      ).rejects.toThrow('Password reset token has already been used or invalidated');
    });

    it('22. should reject weak password during reset', async () => {
      const forgotRes = await service.forgotPassword({ email: 'agent@democorp.in' });
      await expect(
        service.resetPassword({
          token: forgotRes.token!,
          newPassword: 'weak',
        }),
      ).rejects.toThrow('New password must be at least 8 characters long');
    });
  });

  // ── Refresh Token Race Condition Grace Window (SEC-SESSION-001) ──────────
  describe('Refresh Token Rotation Race Condition Grace Window (SEC-SESSION-001)', () => {
    it('23. should return rotated tokens within grace period when REFRESH_TOKEN_GRACE_MS is enabled', async () => {
      // Mock config to enable 15s grace window
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return ACCESS_SECRET;
        if (key === 'JWT_REFRESH_SECRET') return REFRESH_SECRET;
        if (key === 'REFRESH_TOKEN_GRACE_MS') return 15000;
        return null;
      });

      const initial = await service.issueTokens('user_001', 'tenant_001', 'AGENT');

      // Request 1 rotates the token
      const res1 = await service.refresh(initial.refreshToken);
      expect(res1.tokens.accessToken).toBeDefined();

      // Request 2 arrives immediately afterwards presenting the old token (concurrent race condition)
      const res2 = await service.refresh(initial.refreshToken);
      expect(res2.tokens.accessToken).toBe(res1.tokens.accessToken);
      expect(res2.tokens.refreshToken).toBe(res1.tokens.refreshToken);

      // Verify active sessions were NOT invalidated
      const userTokens = storedTokens.filter((t) => t.userId === 'user_001' && !t.revoked);
      expect(userTokens.length).toBeGreaterThan(0);
    });
  });
});
