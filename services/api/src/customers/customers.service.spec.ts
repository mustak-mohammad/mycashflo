import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from './customers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: any;

  const mockUser: AuthUser = {
    userId: 'user_123',
    tenantId: 'tenant_123',
    role: 'ADMIN',
  };

  beforeEach(() => {
    prisma = {
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'Acme Corp', outstandingBalance: 1000, tenantId: 'tenant_123' },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 'c1', name: 'Acme Corp', tenantId: 'tenant_123' }),
        create: vi.fn().mockResolvedValue({ id: 'c2', name: 'New Corp', tenantId: 'tenant_123' }),
      },
    };

    service = new CustomersService(prisma as PrismaService);
  });

  it('should list customers for tenant', async () => {
    const result = await service.findAll(mockUser, { page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant_123' }),
      }),
    );
  });

  it('should find single customer', async () => {
    const customer = await service.findOne('c1', mockUser);
    expect(customer.id).toBe('c1');
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', tenantId: 'tenant_123' },
      }),
    );
  });
});
