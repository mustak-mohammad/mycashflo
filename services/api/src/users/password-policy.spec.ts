import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from '../auth/dto/change-password.dto.js';
import { UsersService } from './users.service.js';

describe('Consistent Password Policy Enforcement (DTOs & UsersService)', () => {
  const weakCases = [
    { label: 'below minimum length (<8 chars)', value: 'Ab1!' },
    { label: '7 chars even with complexity', value: 'Abcd12!' },
    { label: 'missing uppercase letter', value: 'lowercase123!' },
    { label: 'missing lowercase letter', value: 'UPPERCASE123!' },
    { label: 'missing number and special symbol', value: 'OnlyLettersMixed' },
  ];

  const validPasswords = ['ValidPass123', 'ValidPass!@#', 'MyCashFlo@2026'];

  describe('DTO validation parity across CreateUserDto, UpdateUserDto, and ChangePasswordDto', () => {
    it.each(weakCases)('rejects password $label across all 3 DTOs', async ({ value }) => {
      const createDto = plainToInstance(CreateUserDto, {
        email: 'newuser@company.in',
        name: 'New User',
        password: value,
        role: UserRole.AGENT,
      });
      const updateDto = plainToInstance(UpdateUserDto, {
        password: value,
      });
      const changeDto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'CurrentPassword@123',
        newPassword: value,
      });

      const [createErrors, updateErrors, changeErrors] = await Promise.all([
        validate(createDto),
        validate(updateDto),
        validate(changeDto),
      ]);

      expect(createErrors.some((e) => e.property === 'password')).toBe(true);
      expect(updateErrors.some((e) => e.property === 'password')).toBe(true);
      expect(changeErrors.some((e) => e.property === 'newPassword')).toBe(true);
    });

    it.each(validPasswords)('accepts strong password "%s" across all 3 DTOs', async (valid) => {
      const createDto = plainToInstance(CreateUserDto, {
        email: 'newuser@company.in',
        name: 'New User',
        password: valid,
        role: UserRole.AGENT,
      });
      const updateDto = plainToInstance(UpdateUserDto, {
        password: valid,
      });
      const changeDto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'CurrentPassword@123',
        newPassword: valid,
      });

      const [createErrors, updateErrors, changeErrors] = await Promise.all([
        validate(createDto),
        validate(updateDto),
        validate(changeDto),
      ]);

      expect(createErrors).toHaveLength(0);
      expect(updateErrors).toHaveLength(0);
      expect(changeErrors).toHaveLength(0);
    });

    it('allows UpdateUserDto updates when password is omitted', async () => {
      const updateDto = plainToInstance(UpdateUserDto, {
        name: 'Renamed User',
        isActive: false,
      });
      const errors = await validate(updateDto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('UsersService defense-in-depth password validation', () => {
    let service: UsersService;
    let mockPrisma: any;
    let mockAuditLogs: any;
    const adminActor = { userId: 'admin-1', tenantId: 'tenant-1', role: UserRole.ADMIN };

    beforeEach(() => {
      mockPrisma = {
        user: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(2),
        },
      };
      mockAuditLogs = { log: vi.fn().mockResolvedValue(undefined) };
      service = new UsersService(mockPrisma, mockAuditLogs);
    });

    it.each(weakCases)(
      'UsersService.create rejects weak password ($label) before hashing or DB write',
      async ({ value }) => {
        mockPrisma.user.findFirst.mockResolvedValueOnce(null);

        await expect(
          service.create(adminActor, {
            email: 'agent@company.in',
            name: 'Agent One',
            password: value,
            role: UserRole.AGENT,
          }),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.user.create).not.toHaveBeenCalled();
      },
    );

    it.each(weakCases)(
      'UsersService.update rejects weak password ($label) before hashing or DB write',
      async ({ value }) => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({
          id: 'target-1',
          tenantId: 'tenant-1',
          role: UserRole.AGENT,
          isActive: true,
        });

        await expect(
          service.update('target-1', adminActor, { password: value }),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('UsersService.create hashes valid password and never exposes password in return value or audit logs', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'created-1',
        email: 'agent@company.in',
        name: 'Agent One',
        role: UserRole.AGENT,
        isActive: true,
        createdAt: new Date(),
      });

      const plainSecret = 'StrongPass!99';
      const result = await service.create(adminActor, {
        email: 'agent@company.in',
        name: 'Agent One',
        password: plainSecret,
        role: UserRole.AGENT,
      });

      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordHash');
      const createArgs = mockPrisma.user.create.mock.calls[0][0];
      expect(createArgs.data.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(createArgs.data.passwordHash).not.toBe(plainSecret);

      const auditSerialized = JSON.stringify(mockAuditLogs.log.mock.calls[0][0]);
      expect(auditSerialized).not.toContain(plainSecret);
    });
  });
});

