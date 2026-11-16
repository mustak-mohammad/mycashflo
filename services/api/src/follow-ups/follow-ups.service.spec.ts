import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FollowUpsService } from './follow-ups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CasePriority } from '@prisma/client';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('FollowUpsService', () => {
  let service: FollowUpsService;
  let prisma: any;

  const mockUser: AuthUser = {
    userId: 'user_123',
    tenantId: 'tenant_123',
    role: 'ADMIN',
  };

  const mockAgentUser: AuthUser = {
    userId: 'agent_user_01',
    tenantId: 'tenant_123',
    role: 'AGENT',
  };

  beforeEach(() => {
    prisma = {
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: 't1', title: 'Call client', done: false, tenantId: 'tenant_123' },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 't1', title: 'Call client', tenantId: 'tenant_123', assignedTo: 'user_123' }),
        create: vi.fn().mockResolvedValue({ id: 't2', title: 'New task', tenantId: 'tenant_123' }),
        update: vi.fn().mockResolvedValue({ id: 't1', title: 'Call client', done: true }),
        delete: vi.fn().mockResolvedValue({ id: 't1' }),
      },
      customer: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.tenantId === 'tenant_123' && where.id === 'cust_123') {
            return { id: 'cust_123', name: 'Valid Customer', tenantId: 'tenant_123' };
          }
          return null;
        }),
      },
      collectionCase: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.tenantId === 'tenant_123' && where.id === 'case_123') {
            return {
              id: 'case_123',
              customerId: 'cust_123',
              tenantId: 'tenant_123',
              assignedTo: 'agent_user_01',
            };
          }
          return null;
        }),
      },
      user: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          if (where.tenantId === 'tenant_123' && where.id === 'user_target_01' && where.isActive) {
            return { id: 'user_target_01', tenantId: 'tenant_123', isActive: true };
          }
          return null;
        }),
      },
    };

    service = new FollowUpsService(prisma as PrismaService);
  });

  it('should list follow up tasks with summary', async () => {
    const result = await service.findAll(mockUser, { page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('should create a task scoped to tenant', async () => {
    const res = await service.create(mockUser, {
      title: 'New task',
      dueDate: '2026-10-20T10:00:00Z',
      priority: CasePriority.HIGH,
    });
    expect(res.id).toBe('t2');
    expect(prisma.followUpTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant_123',
          assignedTo: 'user_123',
        }),
      }),
    );
  });

  describe('Tenant Isolation & Referential Integrity Remediation (SEC-TENANT-002)', () => {
    it('Scenario 6: Follow-up creation succeeds when collection case and customer belong to tenant and each other', async () => {
      prisma.collectionCase.findFirst.mockResolvedValue({
        id: 'case_valid',
        customerId: 'cust_valid',
        tenantId: 'tenant_123',
      });
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust_valid',
        tenantId: 'tenant_123',
      });
      prisma.followUpTask.create.mockResolvedValue({
        id: 'task_created_01',
        title: 'Valid Follow Up',
        customerId: 'cust_valid',
        collectionCaseId: 'case_valid',
        tenantId: 'tenant_123',
      });

      const res = await service.create(mockUser, {
        title: 'Valid Follow Up',
        dueDate: '2026-11-20T10:00:00Z',
        collectionCaseId: 'case_valid',
        customerId: 'cust_valid',
      });

      expect(res.id).toBe('task_created_01');
      expect(prisma.followUpTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant_123',
            customerId: 'cust_valid',
            collectionCaseId: 'case_valid',
            assignedTo: 'user_123',
          }),
        }),
      );
    });

    it('Scenario 7: Follow-up creation fails when collection case belongs to another tenant', async () => {
      // collectionCase query in current tenant returns null because ID belongs to foreign tenant
      prisma.collectionCase.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockUser, {
          title: 'Exploit Task',
          dueDate: '2026-11-20T10:00:00Z',
          collectionCaseId: 'case_foreign_tenant',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.followUpTask.create).not.toHaveBeenCalled();
    });

    it('Scenario 8: Follow-up creation fails when collection case belongs to another customer', async () => {
      prisma.collectionCase.findFirst.mockResolvedValue({
        id: 'case_cust_A',
        customerId: 'cust_A',
        tenantId: 'tenant_123',
      });
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust_B',
        tenantId: 'tenant_123',
      });

      await expect(
        service.create(mockUser, {
          title: 'Mismatched Task',
          dueDate: '2026-11-20T10:00:00Z',
          collectionCaseId: 'case_cust_A',
          customerId: 'cust_B',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.followUpTask.create).not.toHaveBeenCalled();
    });

    it('Scenario 9: Follow-up creation fails when assigned user belongs to another tenant or is inactive', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust_valid',
        tenantId: 'tenant_123',
      });
      // User findFirst returns null for assignee belonging to foreign tenant
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockUser, {
          title: 'Cross Tenant Assignee Task',
          dueDate: '2026-11-20T10:00:00Z',
          customerId: 'cust_valid',
          assignedTo: 'user_from_foreign_tenant',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.followUpTask.create).not.toHaveBeenCalled();
    });

    it('Scenario 10a: Follow-up findOne strips cross-tenant eager-loaded collectionCase data', async () => {
      prisma.followUpTask.findFirst.mockResolvedValue({
        id: 't_leak_test',
        title: 'Leaked Case Task',
        tenantId: 'tenant_123',
        assignedTo: 'user_123',
        collectionCaseId: 'case_foreign_tenant',
        collectionCase: {
          id: 'case_foreign_tenant',
          tenantId: 'victim_tenant_999',
          customer: { name: 'Victim Customer', email: 'secret@victim.com' },
          invoice: { number: 'INV-SECRET-01' },
        },
      });

      const res = await service.findOne('t_leak_test', mockUser);
      expect(res.collectionCase).toBeNull();
      expect(res.collectionCaseId).toBeNull();
    });

    it('Scenario 10b: Follow-up findAll sanitizes cross-tenant eager-loaded collectionCase data', async () => {
      prisma.followUpTask.findMany.mockResolvedValue([
        {
          id: 't_safe',
          title: 'Safe Task',
          tenantId: 'tenant_123',
          collectionCaseId: 'case_safe',
          collectionCase: {
            id: 'case_safe',
            tenantId: 'tenant_123',
            customer: { name: 'Safe Customer' },
          },
        },
        {
          id: 't_foreign',
          title: 'Foreign Case Task',
          tenantId: 'tenant_123',
          collectionCaseId: 'case_foreign',
          collectionCase: {
            id: 'case_foreign',
            tenantId: 'other_tenant_456',
            customer: { name: 'Leaked Other Customer' },
          },
        },
      ]);
      prisma.followUpTask.count.mockResolvedValue(2);

      const res = await service.findAll(mockUser, { page: 1, limit: 10 });
      expect(res.data).toHaveLength(2);
      expect(res.data[0].collectionCase).toBeDefined();
      expect(res.data[0].collectionCase?.customer?.name).toBe('Safe Customer');
      // Foreign case must be sanitized to null
      expect(res.data[1].collectionCase).toBeNull();
      expect(res.data[1].collectionCaseId).toBeNull();
    });

    it('Scenario 11: Agent cannot create task for collection case assigned to another agent', async () => {
      prisma.collectionCase.findFirst.mockResolvedValue({
        id: 'case_other_agent',
        customerId: 'cust_123',
        tenantId: 'tenant_123',
        assignedTo: 'agent_user_02', // assigned to different agent
      });

      await expect(
        service.create(mockAgentUser, {
          title: 'Unauthorized Agent Task',
          dueDate: '2026-11-20T10:00:00Z',
          collectionCaseId: 'case_other_agent',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.followUpTask.create).not.toHaveBeenCalled();
    });

    it('Scenario 12: Agent cannot reassign task to another user via update', async () => {
      prisma.followUpTask.findFirst.mockResolvedValue({
        id: 'task_agent_01',
        title: 'Agent Task',
        tenantId: 'tenant_123',
        assignedTo: 'agent_user_01',
      });

      await expect(
        service.update('task_agent_01', mockAgentUser, {
          assignedTo: 'agent_user_02',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.followUpTask.update).not.toHaveBeenCalled();
    });
  });
});
