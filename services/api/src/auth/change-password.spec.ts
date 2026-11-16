import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';

describe('AuthService — Secure Self-Service Password Change', () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockConfig: any;

  // Real fast bcrypt hash for testing (4 rounds = 2ms)
  const currentPlainPassword = 'CurrentPassword@123';
  const realPasswordHash = bcrypt.hashSync(currentPlainPassword, 4);

  const mockUser = {
    id: 'user_001',
    email: 'admin@democorp.in',
    name: 'Admin User',
    role: 'ADMIN',
    tenantId: 'tenant_001',
    passwordHash: realPasswordHash,
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      refreshToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit_123' }),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    mockJwt = {
      sign: vi.fn(),
      verify: vi.fn(),
    };

    mockConfig = {
      get: vi.fn(),
    };

    authService = new AuthService(mockPrisma, mockJwt, mockConfig);
  });

  it('successfully changes password with valid current password and revokes all active sessions', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue({
      ...mockUser,
      passwordHash: 'new_hashed_val',
    });

    const result = await authService.changePassword('user_001', 'tenant_001', {
      currentPassword: currentPlainPassword,
      newPassword: 'NewSecurePassword@456',
    });

    expect(result.message).toContain('Password changed successfully');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user_001' },
      })
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_001', revoked: false },
      data: { revoked: true },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant_001',
        userId: 'user_001',
        action: 'auth.password_changed',
        entityType: 'User',
      }),
    });

    // Security invariant: Audit log metadata MUST NOT leak passwords or hashes
    const auditCall = mockPrisma.auditLog.create.mock.calls[0][0];
    const metadataStr = JSON.stringify(auditCall.data.metadata || {});
    expect(metadataStr).not.toContain('CurrentPassword@123');
    expect(metadataStr).not.toContain('NewSecurePassword@456');
    expect(metadataStr).not.toContain('new_hashed_val');
    expect(auditCall.data.metadata.password).toBeUndefined();
    expect(auditCall.data.metadata.newPassword).toBeUndefined();
    expect(auditCall.data.metadata.currentPassword).toBeUndefined();
    expect(auditCall.data.metadata.passwordHash).toBeUndefined();
  });

  it('rejects password change if current password does not match', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);

    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: 'WrongPassword@999',
        newPassword: 'NewSecurePassword@456',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects password change if user is not found in tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      authService.changePassword('user_unknown', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: 'NewSecurePassword@456',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects password change if new password is identical to current password', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);

    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: currentPlainPassword,
      }),
    ).rejects.toThrow(new BadRequestException('New password must be different from current password'));

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects passwords that fail backend complexity requirements', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);

    // Too short (< 8 chars)
    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: 'Short1!',
      }),
    ).rejects.toThrow('New password must be at least 8 characters long');

    // No uppercase
    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: 'lowercase123!',
      }),
    ).rejects.toThrow('New password must contain at least one uppercase letter');

    // No lowercase
    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: 'UPPERCASE123!',
      }),
    ).rejects.toThrow('New password must contain at least one uppercase letter');

    // No number or symbol
    await expect(
      authService.changePassword('user_001', 'tenant_001', {
        currentPassword: currentPlainPassword,
        newPassword: 'LettersOnlyPassword',
      }),
    ).rejects.toThrow('at least one number or special symbol');
  });

  it('revokes in-flight access tokens for the target user without affecting unrelated users', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    mockPrisma.user.update.mockResolvedValue(mockUser);

    const pastTimestamp = Math.floor(Date.now() / 1000) - 10;
    const futureTimestamp = Math.floor(Date.now() / 1000) + 10;

    await authService.changePassword('user_001', 'tenant_001', {
      currentPassword: currentPlainPassword,
      newPassword: 'NewComplexPassword!888',
    });

    // Access token issued before password change for user_001 must be revoked
    expect(AuthService.isAccessTokenRevoked('user_001', pastTimestamp)).toBe(true);

    // Token issued after password change for user_001 must NOT be revoked
    expect(AuthService.isAccessTokenRevoked('user_001', futureTimestamp)).toBe(false);

    // Access tokens for completely unrelated user_002 must NEVER be revoked
    expect(AuthService.isAccessTokenRevoked('user_002', pastTimestamp)).toBe(false);
  });

  it('supports Super Admin changing their master password securely', async () => {
    const superAdminUser = {
      id: 'sa_master_001',
      email: 'superadmin@mycashflo.internal',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      tenantId: 'master',
      passwordHash: realPasswordHash,
    };

    mockPrisma.user.findFirst.mockResolvedValue(superAdminUser);
    mockPrisma.user.update.mockResolvedValue({
      ...superAdminUser,
      passwordHash: 'new_super_master_hash',
    });

    const result = await authService.changePassword('sa_master_001', 'master', {
      currentPassword: currentPlainPassword,
      newPassword: 'NewSuperMasterKey!999',
    });

    expect(result.message).toContain('Password changed successfully');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sa_master_001' },
      })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'master',
        userId: 'sa_master_001',
        action: 'auth.password_changed',
      }),
    });
  });

  describe('Durable Database-Backed Access Token Revocation (JwtStrategy)', () => {
    let jwtStrategy: JwtStrategy;

    beforeEach(() => {
      jwtStrategy = new JwtStrategy(mockConfig, mockPrisma);
    });

    it('rejects old access token issued before tokensValidAfter', async () => {
      const tokensValidAfter = new Date(Date.now() - 5000); // Revoked 5 seconds ago
      const tokenIat = Math.floor((Date.now() - 10000) / 1000); // Issued 10 seconds ago

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_001',
        role: 'ADMIN',
        tenantId: 'tenant_001',
        isActive: true,
        tokensValidAfter,
      });

      await expect(
        jwtStrategy.validate({
          sub: 'user_001',
          tenantId: 'tenant_001',
          role: 'ADMIN',
          iat: tokenIat,
          exp: tokenIat + 3600,
        }),
      ).rejects.toThrow(new UnauthorizedException('Access token has been revoked due to password change or session termination'));
    });

    it('accepts new access token issued after tokensValidAfter', async () => {
      const tokensValidAfter = new Date(Date.now() - 5000); // Revoked 5 seconds ago
      const tokenIat = Math.floor((Date.now() - 1000) / 1000); // Issued 1 second ago

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_001',
        role: 'ADMIN',
        tenantId: 'tenant_001',
        isActive: true,
        tokensValidAfter,
      });

      const user = await jwtStrategy.validate({
        sub: 'user_001',
        tenantId: 'tenant_001',
        role: 'ADMIN',
        iat: tokenIat,
        exp: tokenIat + 3600,
      });

      expect(user).toEqual({
        userId: 'user_001',
        tenantId: 'tenant_001',
        role: 'ADMIN',
      });
    });

    it('keeps unrelated users active when one user changes their password', async () => {
      // User 1 has tokensValidAfter set
      // User 2 has null tokensValidAfter (or an older timestamp)
      const tokenIat = Math.floor((Date.now() - 10000) / 1000);

      mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'user_001') {
          return {
            id: 'user_001',
            role: 'ADMIN',
            tenantId: 'tenant_001',
            isActive: true,
            tokensValidAfter: new Date(),
          };
        }
        return {
          id: 'unrelated_user_002',
          role: 'AGENT',
          tenantId: 'tenant_001',
          isActive: true,
          tokensValidAfter: null,
        };
      });

      // User 1 old token is rejected
      await expect(
        jwtStrategy.validate({
          sub: 'user_001',
          tenantId: 'tenant_001',
          role: 'ADMIN',
          iat: tokenIat,
          exp: tokenIat + 3600,
        }),
      ).rejects.toThrow(UnauthorizedException);

      // Unrelated User 2 token remains completely valid
      const unrelatedUser = await jwtStrategy.validate({
        sub: 'unrelated_user_002',
        tenantId: 'tenant_001',
        role: 'AGENT',
        iat: tokenIat,
        exp: tokenIat + 3600,
      });

      expect(unrelatedUser.userId).toBe('unrelated_user_002');
    });

    it('rejects access tokens for deactivated or deleted users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_deactivated',
        role: 'AGENT',
        tenantId: 'tenant_001',
        isActive: false,
        tokensValidAfter: null,
      });

      await expect(
        jwtStrategy.validate({
          sub: 'user_deactivated',
          tenantId: 'tenant_001',
          role: 'AGENT',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).rejects.toThrow(new UnauthorizedException('User account is inactive or not found'));
    });

    it('survives service reinitialization because revocation state is backed by database', async () => {
      const revokedDate = new Date();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_001',
        role: 'ADMIN',
        tenantId: 'tenant_001',
        isActive: true,
        tokensValidAfter: revokedDate,
      });

      // Instance 1
      const instance1 = new JwtStrategy(mockConfig, mockPrisma);
      // Instance 2 (e.g. after container restart or on another node)
      const instance2 = new JwtStrategy(mockConfig, mockPrisma);

      const oldToken = {
        sub: 'user_001',
        tenantId: 'tenant_001',
        role: 'ADMIN',
        iat: Math.floor(revokedDate.getTime() / 1000) - 20,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(instance1.validate(oldToken)).rejects.toThrow(UnauthorizedException);
      await expect(instance2.validate(oldToken)).rejects.toThrow(UnauthorizedException);
    });

    it('handles concurrent password changes and authentications safely', async () => {
      const now = new Date();
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_001',
        role: 'ADMIN',
        tenantId: 'tenant_001',
        isActive: true,
        tokensValidAfter: now,
      });

      const oldPayload = {
        sub: 'user_001',
        tenantId: 'tenant_001',
        role: 'ADMIN',
        iat: Math.floor(now.getTime() / 1000) - 5,
        exp: Math.floor(now.getTime() / 1000) + 3600,
      };

      const newPayload = {
        sub: 'user_001',
        tenantId: 'tenant_001',
        role: 'ADMIN',
        iat: Math.floor(now.getTime() / 1000) + 5,
        exp: Math.floor(now.getTime() / 1000) + 3600,
      };

      // Concurrent validation requests
      const [resOld1, resOld2, resNew1, resNew2] = await Promise.allSettled([
        jwtStrategy.validate(oldPayload),
        jwtStrategy.validate(oldPayload),
        jwtStrategy.validate(newPayload),
        jwtStrategy.validate(newPayload),
      ]);

      expect(resOld1.status).toBe('rejected');
      expect(resOld2.status).toBe('rejected');
      expect(resNew1.status).toBe('fulfilled');
      expect(resNew2.status).toBe('fulfilled');
    });
  });
});
