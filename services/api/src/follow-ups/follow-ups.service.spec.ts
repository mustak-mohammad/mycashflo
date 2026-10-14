import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FollowUpsService } from './follow-ups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { CasePriority } from '@prisma/client';

describe('FollowUpsService', () => {
  let service: FollowUpsService;
  let prisma: any;

  const mockUser: AuthUser = {
    userId: 'user_123',
    tenantId: 'tenant_123',
    role: 'ADMIN',
  };

  beforeEach(() => {
    prisma = {
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: 't1', title: 'Call client', done: false, tenantId: 'tenant_123' },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 't1', title: 'Call client', tenantId: 'tenant_123' }),
        create: vi.fn().mockResolvedValue({ id: 't2', title: 'New task', tenantId: 'tenant_123' }),
        update: vi.fn().mockResolvedValue({ id: 't1', title: 'Call client', done: true }),
        delete: vi.fn().mockResolvedValue({ id: 't1' }),
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
});
