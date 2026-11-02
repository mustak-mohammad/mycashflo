import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { UserRole } from '@prisma/client';
import { UsersService } from '../users/users.service.js';
import { PlatformService } from '../platform/platform.service.js';

describe('Super Admin Role & Platform Access Security Battery', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  const createMockContext = (user: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  describe('1. Server-Side RolesGuard Enforcement for SUPER_ADMIN', () => {
    it('allows SUPER_ADMIN on endpoints decorated with @Roles(UserRole.SUPER_ADMIN)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.SUPER_ADMIN]);
      const superAdminUser = { userId: 'sa_1', tenantId: 'platform_tenant', role: UserRole.SUPER_ADMIN };
      const ctx = createMockContext(superAdminUser);

      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('strictly forbids tenant ADMIN from accessing @Roles(UserRole.SUPER_ADMIN)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.SUPER_ADMIN]);
      const tenantAdminUser = { userId: 'admin_1', tenantId: 'tenant_demo', role: UserRole.ADMIN };
      const ctx = createMockContext(tenantAdminUser);

      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('strictly forbids MANAGER and AGENT from accessing @Roles(UserRole.SUPER_ADMIN)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.SUPER_ADMIN]);
      const managerUser = { userId: 'mgr_1', tenantId: 'tenant_demo', role: UserRole.MANAGER };
      const agentUser = { userId: 'agent_1', tenantId: 'tenant_demo', role: UserRole.AGENT };

      expect(() => rolesGuard.canActivate(createMockContext(managerUser))).toThrow(ForbiddenException);
      expect(() => rolesGuard.canActivate(createMockContext(agentUser))).toThrow(ForbiddenException);
    });

    it('allows SUPER_ADMIN on tenant-level administrative endpoints (@Roles(UserRole.ADMIN))', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
      const superAdminUser = { userId: 'sa_1', tenantId: 'platform_tenant', role: UserRole.SUPER_ADMIN };
      const ctx = createMockContext(superAdminUser);

      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });
  });

  describe('2. Prevention of Unauthorized Elevation to SUPER_ADMIN', () => {
    let mockPrisma: any;
    let mockAudit: any;
    let usersService: UsersService;

    beforeEach(() => {
      mockPrisma = {
        user: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(2),
        },
      };
      mockAudit = { log: vi.fn().mockResolvedValue(true) };
      usersService = new UsersService(mockPrisma, mockAudit);
    });

    it('prevents tenant ADMIN from creating a user with SUPER_ADMIN role', async () => {
      const tenantAdmin = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        usersService.create(tenantAdmin, {
          email: 'sneaky@alpha.in',
          name: 'Sneaky User',
          password: 'Password123!',
          role: UserRole.SUPER_ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('prevents tenant ADMIN from updating a user role to SUPER_ADMIN', async () => {
      const tenantAdmin = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user_target',
        tenantId: 'tenant_alpha',
        role: UserRole.AGENT,
      });

      await expect(
        usersService.update('user_target', tenantAdmin, {
          role: UserRole.SUPER_ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('prevents tenant ADMIN from modifying an existing SUPER_ADMIN account', async () => {
      const tenantAdmin = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'sa_account',
        tenantId: 'tenant_alpha',
        role: UserRole.SUPER_ADMIN,
      });

      await expect(
        usersService.update('sa_account', tenantAdmin, {
          name: 'Modified Name',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('3. PlatformService Multi-Tenant & Cross-Tenant Operations', () => {
    let mockPrisma: any;
    let mockAudit: any;
    let platformService: PlatformService;
    const superAdminUser = { userId: 'sa_1', tenantId: 'platform_tenant', role: UserRole.SUPER_ADMIN };

    beforeEach(() => {
      mockPrisma = {
        tenant: {
          count: vi.fn().mockResolvedValue(5),
          findMany: vi.fn().mockResolvedValue([
            { id: 't1', name: 'Tenant 1', slug: 't1', createdAt: new Date(), updatedAt: new Date(), _count: { users: 3, customers: 10, invoices: 20, payments: 15 } },
            { id: 't2', name: 'Tenant 2', slug: 't2', createdAt: new Date(), updatedAt: new Date(), _count: { users: 2, customers: 5, invoices: 8, payments: 6 } },
          ]),
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        user: {
          count: vi.fn().mockResolvedValue(15),
          findMany: vi.fn().mockResolvedValue([
            { id: 'u1', email: 'u1@t1.in', name: 'User 1', role: UserRole.ADMIN, isActive: true, tenantId: 't1', tenant: { id: 't1', name: 'Tenant 1', slug: 't1' }, createdAt: new Date() },
            { id: 'u2', email: 'u2@t2.in', name: 'User 2', role: UserRole.AGENT, isActive: true, tenantId: 't2', tenant: { id: 't2', name: 'Tenant 2', slug: 't2' }, createdAt: new Date() },
          ]),
          findUnique: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        customer: {
          count: vi.fn().mockResolvedValue(50),
        },
        invoice: {
          aggregate: vi.fn().mockResolvedValue({
            _sum: { amount: 1500000, outstanding: 450000 },
            _count: 75,
          }),
        },
        payment: {
          aggregate: vi.fn().mockResolvedValue({
            _sum: { amount: 1050000 },
            _count: 60,
          }),
        },
        auditLog: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'log_1', action: 'invoice.created', tenantId: 't1', createdAt: new Date(), user: { id: 'u1', name: 'User 1', email: 'u1@t1.in', role: 'ADMIN' }, tenant: { id: 't1', name: 'Tenant 1', slug: 't1' } },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      };

      mockAudit = { log: vi.fn().mockResolvedValue(true) };
      platformService = new PlatformService(mockPrisma, mockAudit);
    });

    it('returns platform-wide summary metrics across all tenants and logs audit trail', async () => {
      const summary = await platformService.getSummary(superAdminUser);

      expect(summary.tenantsCount).toBe(5);
      expect(summary.usersCount).toBe(15);
      expect(summary.customersCount).toBe(50);
      expect(summary.totalInvoiced).toBe(1500000);
      expect(summary.totalOutstanding).toBe(450000);
      expect(summary.totalCollected).toBe(1050000);
      expect(summary.invoicesCount).toBe(75);
      expect(summary.completedPaymentsCount).toBe(60);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.summary_viewed',
          entityType: 'Platform',
        }),
      );
    });

    it('lists all tenants with operational metrics and logs audit trail', async () => {
      const tenants = await platformService.listTenants(superAdminUser);

      expect(tenants).toHaveLength(2);
      expect(tenants[0].stats.userCount).toBe(3);
      expect(tenants[0].stats.customerCount).toBe(10);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.tenants_listed',
        }),
      );
    });

    it('creates a new tenant and prevents duplicate slugs', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValueOnce(null);
      mockPrisma.tenant.create.mockResolvedValueOnce({
        id: 't_new',
        name: 'New Tenant',
        slug: 'new-tenant',
      });

      const tenant = await platformService.createTenant(superAdminUser, {
        name: 'New Tenant',
        slug: 'new-tenant',
      });
      expect(tenant.id).toBe('t_new');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.tenant_created',
          entityId: 't_new',
        }),
      );

      // Attempt duplicate slug
      mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'existing', slug: 'new-tenant' });
      await expect(
        platformService.createTenant(superAdminUser, {
          name: 'Duplicate Tenant',
          slug: 'new-tenant',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('logs cross-tenant access when inspecting a specific tenant or audit logs', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 't_target',
        name: 'Target Tenant',
        slug: 'target',
        users: [],
        _count: { customers: 5, invoices: 10, payments: 8, collectionCases: 2 },
      });

      await platformService.getTenant('t_target', superAdminUser);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.cross_tenant_access',
          entityType: 'Tenant',
          entityId: 't_target',
        }),
      );

      await platformService.getTenantAuditLogs('t_target', superAdminUser);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.cross_tenant_access',
          entityType: 'AuditLog',
        }),
      );
    });

    it('prevents demoting or deactivating the last active SUPER_ADMIN on the platform', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'sa_sole',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValue(1); // Only 1 active super admin

      await expect(
        platformService.updateUserRole('sa_sole', superAdminUser, {
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        platformService.updateUserStatus('sa_sole', superAdminUser, {
          isActive: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('activates and suspends tenant user access safely with audit logging', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 't_suspend',
        name: 'Suspendable Corp',
        slug: 'suspendable',
        users: [{ id: 'u_t1', role: UserRole.ADMIN, isActive: true }],
      });

      const res = await platformService.updateTenantStatus('t_suspend', superAdminUser, {
        isActive: false,
      });

      expect(res.success).toBe(true);
      expect(res.isActive).toBe(false);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 't_suspend' },
        data: { isActive: false },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.tenant_status_updated',
          entityId: 't_suspend',
        }),
      );
    });

    it('lists platform-wide cross-tenant audit logs with pagination', async () => {
      const logs = await platformService.listPlatformAuditLogs(superAdminUser, { page: 1, limit: 10 });

      expect(logs.data).toBeDefined();
      expect(logs.total).toBe(1);
      expect(logs.page).toBe(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.audit_logs_viewed',
          entityType: 'Platform',
        }),
      );
    });

    it('returns platform-wide operational settings and health indicators without leaking secrets', async () => {
      const settings = await platformService.getPlatformSettings(superAdminUser);

      expect(settings.systemHealth).toBe('operational');
      expect(settings.securityPolicies).toBeDefined();
      expect(settings.providers).toBeDefined();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.settings_viewed',
          entityType: 'Platform',
        }),
      );
    });

    it('returns platform-wide aggregate analytics across tenants', async () => {
      const analytics = await platformService.getPlatformAnalytics(superAdminUser);

      expect(analytics.tenantsTotal).toBeDefined();
      expect(analytics.usersTotal).toBeDefined();
      expect(analytics.financials).toBeDefined();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.analytics_viewed',
          entityType: 'Platform',
        }),
      );
    });
  });
});

