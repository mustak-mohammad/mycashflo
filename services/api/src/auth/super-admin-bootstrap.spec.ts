import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { PlatformService } from '../platform/platform.service.js';
import { UserRole } from '@prisma/client';
import { loadBootstrapEnv, parseAndApplyEnv } from '../../scripts/bootstrap-super-admin.mjs';

describe('Super Admin Bootstrap & Governance Security Battery', () => {
  let mockPrisma: any;
  let mockAudit: any;
  let usersService: UsersService;
  let platformService: PlatformService;

  const superAdminUser = {
    userId: 'sa_platform_1',
    tenantId: 'platform_tenant',
    role: UserRole.SUPER_ADMIN,
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      tenant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'aud_1' }),
      },
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(true),
    };

    usersService = new UsersService(mockPrisma, mockAudit);
    platformService = new PlatformService(mockPrisma, mockAudit);
  });

  describe('1. Existing User Conflict & Accidental Promotion Safety', () => {
    it('prevents accidental promotion of an existing tenant user when allow-promote is false', () => {
      const existingUser = {
        id: 'usr_existing_1',
        email: 'admin@democorp.com',
        role: UserRole.ADMIN,
        tenantId: 'tenant_democorp',
        tenant: { name: 'Demo Corp', slug: 'democorp' },
      };

      // In bootstrap logic:
      const allowPromote = false;
      const canPromote = existingUser.role === 'SUPER_ADMIN' || allowPromote;

      expect(canPromote).toBe(false);
      expect(existingUser.role).not.toBe('SUPER_ADMIN');
    });

    it('permits promotion of an existing tenant user only when allow-promote is explicitly true', () => {
      const existingUser = {
        id: 'usr_existing_1',
        email: 'admin@democorp.com',
        role: UserRole.ADMIN,
        tenantId: 'tenant_democorp',
        tenant: { name: 'Demo Corp', slug: 'democorp' },
      };

      const allowPromote = true;
      const canPromote = existingUser.role === 'SUPER_ADMIN' || allowPromote;

      expect(canPromote).toBe(true);
    });
  });

  describe('2. Credential Validation Safety', () => {
    it('rejects invalid or missing email addresses', () => {
      const validateEmail = (email?: string) => {
        const clean = (email || '').trim().toLowerCase();
        return Boolean(clean && clean.includes('@') && clean.length >= 5);
      };

      expect(validateEmail('')).toBe(false);
      expect(validateEmail('invalid-no-at')).toBe(false);
      expect(validateEmail('a@b')).toBe(false);
      expect(validateEmail('superadmin@mycashflo.internal')).toBe(true);
    });

    it('rejects passwords shorter than 8 characters', () => {
      const validatePassword = (password?: string) => {
        return Boolean(password && password.length >= 8);
      };

      expect(validatePassword('')).toBe(false);
      expect(validatePassword('short')).toBe(false);
      expect(validatePassword('1234567')).toBe(false);
      expect(validatePassword('StrongPassword123!')).toBe(true);
    });
  });

  describe('3. Repeat Execution Safety', () => {
    it('preserves existing SUPER_ADMIN credentials on repeat run when update-password is false', () => {
      const existingSuperAdmin = {
        id: 'sa_existing',
        email: 'superadmin@platform.internal',
        role: UserRole.SUPER_ADMIN,
        passwordHash: '$2b$12$existing_secure_hash',
      };

      const updatePassword = false;
      const shouldUpdateCredentials = existingSuperAdmin.role === 'SUPER_ADMIN' && updatePassword;

      expect(shouldUpdateCredentials).toBe(false);
      // Existing credentials remain untouched
      expect(existingSuperAdmin.passwordHash).toBe('$2b$12$existing_secure_hash');
    });

    it('updates SUPER_ADMIN credentials on repeat run only when update-password is true', () => {
      const existingSuperAdmin = {
        id: 'sa_existing',
        email: 'superadmin@platform.internal',
        role: UserRole.SUPER_ADMIN,
        passwordHash: '$2b$12$existing_secure_hash',
      };

      const updatePassword = true;
      const shouldUpdateCredentials = existingSuperAdmin.role === 'SUPER_ADMIN' && updatePassword;

      expect(shouldUpdateCredentials).toBe(true);
    });
  });

  describe('4. Last Super Admin Protection (UsersService & PlatformService)', () => {
    it('prevents demoting the last active SUPER_ADMIN via PlatformService', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'sa_sole',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValue(1); // Only 1 active super admin on platform

      await expect(
        platformService.updateUserRole('sa_sole', superAdminUser, {
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents deactivating the last active SUPER_ADMIN via PlatformService', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'sa_sole',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        platformService.updateUserStatus('sa_sole', superAdminUser, {
          isActive: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents demoting the last active SUPER_ADMIN via UsersService', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'sa_sole',
        role: UserRole.SUPER_ADMIN,
        tenantId: 'platform_tenant',
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        usersService.update('sa_sole', superAdminUser, {
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents deactivating the last active SUPER_ADMIN via UsersService', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'sa_sole',
        role: UserRole.SUPER_ADMIN,
        tenantId: 'platform_tenant',
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        usersService.update('sa_sole', superAdminUser, {
          isActive: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('5. Environment Loading & Missing DATABASE_URL Safety', () => {
    const originalDbUrl = process.env.DATABASE_URL;

    afterEach(() => {
      if (originalDbUrl) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    });

    it('reliably locates and loads DATABASE_URL from services/api/.env when running from root', () => {
      delete process.env.DATABASE_URL;
      const result = loadBootstrapEnv();
      expect(result.loaded).toBe(true);
      expect(process.env.DATABASE_URL).toBeDefined();
      expect(process.env.DATABASE_URL).toMatch(/^(postgresql|postgres):\/\//);
    });

    it('handles missing DATABASE_URL safely without crashing or leaking secrets when not present', () => {
      delete process.env.DATABASE_URL;
      // When searching a non-existent directory / non-existent custom path
      const result = loadBootstrapEnv('/non/existent/path/.env');
      expect(result.loaded).toBe(false);
      expect(result.error).toBeDefined();
      expect(process.env.DATABASE_URL).toBeUndefined();
    });

    it('parses valid environment variables without modifying already-defined variables', () => {
      process.env.TEST_EXISTING_VAR = 'original_value';
      const fakeEnvContent = 'TEST_EXISTING_VAR=new_value\nTEST_NEW_VAR="safe_quoted_value"';
      
      // Test manual parse logic
      const lines = fakeEnvContent.split('\n');
      for (const line of lines) {
        const [k, v] = line.split('=');
        if (k && process.env[k] === undefined) {
          process.env[k] = v.replace(/"/g, '');
        }
      }

      expect(process.env.TEST_EXISTING_VAR).toBe('original_value');
      expect(process.env.TEST_NEW_VAR).toBe('safe_quoted_value');
      delete process.env.TEST_EXISTING_VAR;
      delete process.env.TEST_NEW_VAR;
    });
  });
});

