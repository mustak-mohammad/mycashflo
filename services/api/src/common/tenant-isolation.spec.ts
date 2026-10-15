import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from '../customers/customers.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { FollowUpsService } from '../follow-ups/follow-ups.service.js';
import { CallsService } from '../calls/calls.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { NotFoundException } from '@nestjs/common';

describe('Multi-Tenant Isolation Verification', () => {
  let mockPrisma: any;
  let customersService: CustomersService;
  let invoicesService: InvoicesService;
  let followUpsService: FollowUpsService;
  let callsService: CallsService;
  let auditLogsService: AuditLogsService;
  let notificationsService: NotificationsService;

  const tenantAUser: AuthUser = {
    userId: 'user_tenant_a',
    tenantId: 'tenant_a_id',
    role: 'ADMIN',
  };

  const tenantBUser: AuthUser = {
    userId: 'user_tenant_b',
    tenantId: 'tenant_b_id',
    role: 'ADMIN',
  };

  beforeEach(() => {
    mockPrisma = {
      customer: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      invoice: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      followUpTask: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      callSession: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
      notification: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
    };

    customersService = new CustomersService(mockPrisma as PrismaService);
    invoicesService = new InvoicesService(mockPrisma as PrismaService);
    followUpsService = new FollowUpsService(mockPrisma as PrismaService);
    callsService = new CallsService(mockPrisma as PrismaService);
    auditLogsService = new AuditLogsService(mockPrisma as PrismaService);
    notificationsService = new NotificationsService(mockPrisma as PrismaService, auditLogsService);
  });

  describe('Customer Isolation', () => {
    it('scopes customer queries strictly to the authenticated tenantId', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      await customersService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );

      await customersService.findAll(tenantBUser, { page: 1, limit: 10 });
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_b_id' }),
        }),
      );
    });

    it('denies access if a user attempts to find a customer from another tenant', async () => {
      // Return null because customer is in tenant_b, not tenant_a
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        customersService.findOne('customer_of_tenant_b', tenantAUser),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'customer_of_tenant_b', tenantId: 'tenant_a_id' },
        include: expect.any(Object),
      });
    });
  });

  describe('Invoice Isolation', () => {
    it('scopes invoice lists to the callers tenantId', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await invoicesService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );
    });

    it('rejects cross-tenant invoice retrieval', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        invoicesService.findOne('invoice_belonging_to_b', tenantAUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Follow-Up Task Isolation', () => {
    it('scopes follow-up tasks strictly to tenantId', async () => {
      mockPrisma.followUpTask.findMany.mockResolvedValue([]);
      mockPrisma.followUpTask.count.mockResolvedValue(0);

      await followUpsService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.followUpTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );
    });
  });

  describe('Call Sessions Isolation', () => {
    it('scopes call sessions strictly to tenantId', async () => {
      mockPrisma.callSession.findMany.mockResolvedValue([]);
      mockPrisma.callSession.count.mockResolvedValue(0);

      await callsService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.callSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );
    });
  });

  describe('Audit Log Isolation', () => {
    it('scopes audit logs strictly to the callers tenantId', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await auditLogsService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );

      await auditLogsService.findAll(tenantBUser, { page: 1, limit: 10 });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_b_id' }),
        }),
      );
    });
  });

  describe('Notification Isolation', () => {
    it('scopes notification queries strictly to the callers tenantId', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await notificationsService.findAll(tenantAUser, { page: 1, limit: 10 });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant_a_id' }),
        }),
      );
    });

    it('rejects cross-tenant notification retrieval', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        notificationsService.findOne('notif_of_tenant_b', tenantAUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

