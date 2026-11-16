import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { assertStrongPassword } from '../common/password-policy.js';
import { UserRole } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.user.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!record) {
      throw new NotFoundException('User not found in current tenant');
    }
    return record;
  }

  async create(user: AuthUser, dto: CreateUserDto) {
    const cleanEmail = dto.email.trim().toLowerCase();

    // Check if user with this email already exists in this tenant
    const existingInTenant = await this.prisma.user.findFirst({
      where: { email: cleanEmail, tenantId: user.tenantId },
    });
    if (existingInTenant) {
      throw new ConflictException(`User with email '${cleanEmail}' already exists in this tenant`);
    }

    assertStrongPassword(dto.password);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const role = dto.role ?? UserRole.AGENT;

    // Security guard: Only an existing Super Admin can create a Super Admin user
    if (role === UserRole.SUPER_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }

    const created = await this.prisma.user.create({
      data: {
        email: cleanEmail,
        name: dto.name.trim(),
        passwordHash,
        role,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'user.created',
      entityType: 'User',
      entityId: created.id,
      metadata: {
        email: created.email,
        name: created.name,
        role: created.role,
      },
    });

    return created;
  }

  async update(id: string, user: AuthUser, dto: UpdateUserDto) {
    const targetUser = await this.prisma.user.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found in current tenant');
    }

    // Security guard: Tenant admins cannot modify a Super Admin user
    if (targetUser.role === UserRole.SUPER_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Tenant administrators cannot modify Super Admin accounts');
    }

    // Security guard: Only Super Admin can promote to Super Admin
    if (dto.role === UserRole.SUPER_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can assign the Super Admin role');
    }

    // Safety guard: Cannot demote or deactivate the last active ADMIN in the tenant
    if (
      (dto.role && dto.role !== UserRole.ADMIN && targetUser.role === UserRole.ADMIN) ||
      (dto.isActive === false && targetUser.role === UserRole.ADMIN)
    ) {
      const activeAdminCount = await this.prisma.user.count({
        where: { tenantId: user.tenantId, role: UserRole.ADMIN, isActive: true },
      });
      if (activeAdminCount <= 1) {
        throw new BadRequestException('Cannot demote or deactivate the only active Admin in the tenant');
      }
    }

    // Safety guard: Cannot demote or deactivate the last active SUPER_ADMIN on the platform
    if (
      (dto.role && dto.role !== UserRole.SUPER_ADMIN && targetUser.role === UserRole.SUPER_ADMIN) ||
      (dto.isActive === false && targetUser.role === UserRole.SUPER_ADMIN)
    ) {
      const activeSuperAdminCount = await this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
      });
      if (activeSuperAdminCount <= 1) {
        throw new BadRequestException(
          'Cannot demote or deactivate the only active Super Admin on the platform',
        );
      }
    }

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password !== undefined) {
      assertStrongPassword(dto.password);
      data.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'user.updated',
      entityType: 'User',
      entityId: updated.id,
      metadata: {
        changes: Object.keys(data).filter((k) => k !== 'passwordHash'),
        newRole: updated.role,
        isActive: updated.isActive,
      },
    });

    return updated;
  }
}
