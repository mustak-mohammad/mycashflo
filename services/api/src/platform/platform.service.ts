import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
  PlatformAuditLogsQueryDto,
  UpdatePlatformUserRoleDto,
  UpdatePlatformUserStatusDto,
  PlatformUsersQueryDto,
} from './dto/platform.dto.js';
import { UserRole } from '@prisma/client';

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Platform-wide aggregate metrics across all tenants.
   */
  async getSummary(user: AuthUser) {
    const [
      tenantsCount,
      activeTenantsCount,
      usersCount,
      totalUsersCount,
      customersCount,
      invoicesAggregate,
      paymentsAggregate,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({
        where: { users: { some: { isActive: true } } },
      }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count(),
      this.prisma.customer.count(),
      this.prisma.invoice.aggregate({
        _sum: {
          amount: true,
          outstanding: true,
        },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: {
          amount: true,
        },
        _count: true,
      }),
    ]);

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.summary_viewed',
      entityType: 'Platform',
      metadata: {
        tenantsCount,
        usersCount,
        customersCount,
      },
    });

    return {
      tenantsCount,
      activeTenantsCount,
      usersCount,
      totalUsersCount,
      customersCount,
      invoicesCount: invoicesAggregate._count,
      totalInvoiced: invoicesAggregate._sum.amount ? Number(invoicesAggregate._sum.amount) : 0,
      totalOutstanding: invoicesAggregate._sum.outstanding
        ? Number(invoicesAggregate._sum.outstanding)
        : 0,
      totalCollected: paymentsAggregate._sum.amount
        ? Number(paymentsAggregate._sum.amount)
        : 0,
      completedPaymentsCount: paymentsAggregate._count,
    };
  }

  /**
   * List all tenants across the platform.
   */
  async listTenants(user: AuthUser) {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          select: { id: true, isActive: true },
        },
        _count: {
          select: {
            users: true,
            customers: true,
            invoices: true,
            payments: true,
          },
        },
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.tenants_listed',
      entityType: 'Tenant',
      metadata: { count: tenants.length },
    });

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      stats: {
        userCount: t._count.users,
        activeUserCount: t.users ? t.users.filter((u) => u.isActive).length : 0,
        customerCount: t._count.customers,
        invoiceCount: t._count.invoices,
        paymentCount: t._count.payments,
      },
    }));
  }

  /**
   * Create a new tenant.
   */
  async createTenant(user: AuthUser, dto: CreateTenantDto) {
    const cleanSlug = dto.slug.trim().toLowerCase();
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: cleanSlug },
    });
    if (existing) {
      throw new ConflictException(`Tenant with slug '${cleanSlug}' already exists`);
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name.trim(),
        slug: cleanSlug,
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.tenant_created',
      entityType: 'Tenant',
      entityId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug },
    });

    return tenant;
  }

  /**
   * Get single tenant details.
   */
  async getTenant(id: string, user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            customers: true,
            invoices: true,
            payments: true,
            collectionCases: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant '${id}' not found`);
    }

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.cross_tenant_access',
      entityType: 'Tenant',
      entityId: tenant.id,
      metadata: { targetTenantId: tenant.id, targetTenantSlug: tenant.slug },
    });

    return tenant;
  }

  /**
   * Update tenant.
   */
  async updateTenant(id: string, user: AuthUser, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${id}' not found`);
    }

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const cleanSlug = dto.slug.trim().toLowerCase();
      if (cleanSlug !== tenant.slug) {
        const existing = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
        if (existing) {
          throw new ConflictException(`Tenant with slug '${cleanSlug}' already exists`);
        }
        data.slug = cleanSlug;
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.tenant_updated',
      entityType: 'Tenant',
      entityId: updated.id,
      metadata: { changes: Object.keys(data), newSlug: updated.slug },
    });

    return updated;
  }

  /**
   * List platform users across tenants.
   */
  async listUsers(user: AuthUser, query: PlatformUsersQueryDto) {
    const where: any = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.role) where.role = query.role;

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.users_listed',
      entityType: 'User',
      metadata: { filter: query, count: users.length },
    });

    return users;
  }

  /**
   * Update a user's role across any tenant.
   */
  async updateUserRole(id: string, user: AuthUser, dto: UpdatePlatformUserRoleDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: true },
    });
    if (!targetUser) {
      throw new NotFoundException(`User '${id}' not found`);
    }

    // Protection: Cannot demote the last active SUPER_ADMIN on the entire platform
    if (targetUser.role === UserRole.SUPER_ADMIN && dto.role !== UserRole.SUPER_ADMIN) {
      const activeSuperAdminCount = await this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
      });
      if (activeSuperAdminCount <= 1) {
        throw new BadRequestException('Cannot demote the only active Super Admin on the platform');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: dto.role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        tenantId: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.user_role_updated',
      entityType: 'User',
      entityId: updated.id,
      metadata: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        targetTenantId: updated.tenantId,
        previousRole: targetUser.role,
        newRole: updated.role,
      },
    });

    return updated;
  }

  /**
   * Update a user's active status across any tenant.
   */
  async updateUserStatus(id: string, user: AuthUser, dto: UpdatePlatformUserStatusDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!targetUser) {
      throw new NotFoundException(`User '${id}' not found`);
    }

    // Protection: Cannot deactivate the last active SUPER_ADMIN on the platform
    if (targetUser.role === UserRole.SUPER_ADMIN && dto.isActive === false) {
      const activeSuperAdminCount = await this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
      });
      if (activeSuperAdminCount <= 1) {
        throw new BadRequestException('Cannot deactivate the only active Super Admin on the platform');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        tenantId: true,
        updatedAt: true,
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.user_status_updated',
      entityType: 'User',
      entityId: updated.id,
      metadata: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        targetTenantId: updated.tenantId,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  /**
   * Cross-tenant audit log viewer for Super Admin.
   */
  async getTenantAuditLogs(tenantId: string, user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${tenantId}' not found`);
    }

    const logs = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.cross_tenant_access',
      entityType: 'AuditLog',
      metadata: { targetTenantId: tenantId, targetTenantSlug: tenant.slug, logCount: logs.length },
    });

    return logs;
  }

  /**
   * Activate or suspend a tenant by updating all its users' active states.
   */
  async updateTenantStatus(id: string, user: AuthUser, dto: UpdateTenantStatusDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { users: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${id}' not found`);
    }

    if (!dto.isActive) {
      const superAdminsInTenant = tenant.users.filter(
        (u) => u.role === UserRole.SUPER_ADMIN && u.isActive,
      );
      if (superAdminsInTenant.length > 0) {
        const totalActiveSuperAdmins = await this.prisma.user.count({
          where: { role: UserRole.SUPER_ADMIN, isActive: true },
        });
        if (totalActiveSuperAdmins - superAdminsInTenant.length < 1) {
          throw new BadRequestException('Cannot suspend tenant containing the only active Super Admin');
        }
      }
    }

    await this.prisma.user.updateMany({
      where: { tenantId: id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.tenant_status_updated',
      entityType: 'Tenant',
      entityId: id,
      metadata: { targetTenantId: id, targetTenantSlug: tenant.slug, isActive: dto.isActive },
    });

    return {
      success: true,
      tenantId: id,
      isActive: dto.isActive,
      affectedUsers: tenant.users.length,
    };
  }

  /**
   * Platform-wide audit logs with cross-tenant visibility (Super Admin only).
   */
  async listPlatformAuditLogs(user: AuthUser, query: PlatformAuditLogsQueryDto) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
          tenant: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.audit_logs_viewed',
      entityType: 'Platform',
      metadata: { count: logs.length, total, page },
    });

    return {
      data: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Platform runtime settings & health metrics (Super Admin only).
   */
  async getPlatformSettings(user: AuthUser) {
    const env = process.env.NODE_ENV || 'development';
    const automatedReminders = process.env.AUTOMATED_REMINDERS_ENABLED === 'true';
    const outboundCalls =
      process.env.ENABLE_OUTBOUND_CALLS === 'true' ||
      process.env.OUTBOUND_CALLS_ENABLED === 'true';

    let dbStatus = 'healthy';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'degraded';
    }

    const isPlaceholder = (v?: string) =>
      !v || v.startsWith('your_') || v.includes('placeholder') || v.trim() === '';

    const livekitConfigured = Boolean(
      process.env.LIVEKIT_API_KEY &&
        !isPlaceholder(process.env.LIVEKIT_API_KEY) &&
        process.env.LIVEKIT_API_SECRET &&
        !isPlaceholder(process.env.LIVEKIT_API_SECRET),
    );

    const sipOutboundTrunk = process.env.SIP_OUTBOUND_TRUNK_ID;
    const sipCallerId = process.env.SIP_OUTBOUND_CALLER_ID;
    const sipConfigured = Boolean(sipOutboundTrunk && !isPlaceholder(sipOutboundTrunk));

    const providers = {
      database: { status: dbStatus, engine: 'PostgreSQL (Prisma)' },
      razorpay: {
        configured: Boolean(
          process.env.RAZORPAY_KEY_ID &&
            !isPlaceholder(process.env.RAZORPAY_KEY_ID) &&
            process.env.RAZORPAY_KEY_SECRET &&
            !isPlaceholder(process.env.RAZORPAY_KEY_SECRET),
        ),
        mode:
          !process.env.RAZORPAY_KEY_ID || isPlaceholder(process.env.RAZORPAY_KEY_ID)
            ? 'unconfigured'
            : process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')
              ? 'test'
              : 'live',
        webhookConfigured: Boolean(
          process.env.RAZORPAY_WEBHOOK_SECRET &&
            !isPlaceholder(process.env.RAZORPAY_WEBHOOK_SECRET),
        ),
        webhookStatus: Boolean(
          process.env.RAZORPAY_WEBHOOK_SECRET &&
            !isPlaceholder(process.env.RAZORPAY_WEBHOOK_SECRET),
        )
          ? 'CONFIGURED'
          : 'NOT_CONFIGURED',
      },
      stripe: {
        configured: Boolean(
          process.env.STRIPE_SECRET_KEY && !isPlaceholder(process.env.STRIPE_SECRET_KEY),
        ),
      },
      resend: {
        configured: Boolean(
          process.env.RESEND_API_KEY && !isPlaceholder(process.env.RESEND_API_KEY),
        ),
      },
      whatsapp: {
        configured: Boolean(
          process.env.WHATSAPP_TOKEN &&
            !isPlaceholder(process.env.WHATSAPP_TOKEN) &&
            process.env.WHATSAPP_PHONE_NUMBER_ID &&
            !isPlaceholder(process.env.WHATSAPP_PHONE_NUMBER_ID),
        ),
      },
      livekit: {
        configured: livekitConfigured,
        agentName: process.env.LIVEKIT_AGENT_NAME || 'chotu-voice-agent',
        webhookConfigured: Boolean(
          process.env.LIVEKIT_WEBHOOK_SECRET && !isPlaceholder(process.env.LIVEKIT_WEBHOOK_SECRET),
        ),
        egressConfigured: Boolean(
          process.env.LIVEKIT_EGRESS_S3_BUCKET || process.env.LIVEKIT_EGRESS_PATH,
        ),
      },
      sipTelephony: {
        configured: sipConfigured,
        outboundTrunkConfigured: sipConfigured,
        inboundTrunkConfigured: Boolean(
          process.env.SIP_INBOUND_TRUNK_ID && !isPlaceholder(process.env.SIP_INBOUND_TRUNK_ID),
        ),
        callerIdConfigured: Boolean(sipCallerId && sipCallerId.startsWith('+')),
        policy: outboundCalls ? 'LIVE_DISPATCH_ENABLED' : 'OUTBOUND_CALLS_DISABLED_BY_POLICY',
      },
    };

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.settings_viewed',
      entityType: 'Platform',
      metadata: { env },
    });

    return {
      environment: env,
      version: '0.2.0',
      systemHealth: dbStatus === 'healthy' ? 'operational' : 'degraded',
      securityPolicies: {
        outboundCallsEnabled: outboundCalls,
        automatedRemindersEnabled: automatedReminders,
        secretMaskingEnforced: true,
        tenantIsolationEnforced: true,
        superAdminBootstrapSafeguards: true,
      },
      providers,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Platform analytics aggregated across all tenants (Super Admin only).
   */
  async getPlatformAnalytics(user: AuthUser) {
    const allTenants = await this.prisma.tenant.findMany({
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const allUsers = await this.prisma.user.findMany({
      select: { id: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const [invoiceAgg, paymentAgg] = await Promise.all([
      this.prisma.invoice.aggregate({
        _count: true,
        _sum: { amount: true, outstanding: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const roleCounts: Record<string, number> = {};
    for (const u of allUsers) {
      roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
    }

    await this.auditLogs.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'platform.analytics_viewed',
      entityType: 'Platform',
      metadata: { totalTenants: allTenants.length, totalUsers: allUsers.length },
    });

    return {
      tenantsTotal: allTenants.length,
      usersTotal: allUsers.length,
      activeUsersTotal: allUsers.filter((u) => u.isActive).length,
      roleDistribution: roleCounts,
      financials: {
        totalInvoiced: Number(invoiceAgg._sum.amount || 0),
        totalOutstanding: Number(invoiceAgg._sum.outstanding || 0),
        totalCollected: Number(paymentAgg._sum.amount || 0),
        completedPaymentsCount: paymentAgg._count,
      },
      tenantCreationTimeline: allTenants.map((t) => ({
        id: t.id,
        createdAt: t.createdAt.toISOString(),
      })),
      userCreationTimeline: allUsers.map((u) => ({
        id: u.id,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }
}

