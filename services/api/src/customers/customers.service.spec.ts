import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from './customers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { ConsentState } from '@prisma/client';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: any;
  let auditLogs: any;

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
        findFirst: vi.fn().mockResolvedValue({
          id: 'c1',
          name: 'Acme Corp',
          email: 'acme@example.com',
          phone: '+919876543210',
          tenantId: 'tenant_123',
          emailConsent: ConsentState.UNKNOWN,
          whatsappConsent: ConsentState.UNKNOWN,
          smsConsent: ConsentState.UNKNOWN,
          voiceConsent: ConsentState.UNKNOWN,
          notes: null,
        }),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'c2', ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
    };

    auditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'audit_1' }),
    };

    service = new CustomersService(prisma as PrismaService, auditLogs as AuditLogsService);
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

  it('creates customer with explicit consent states, timestamps and provenance', async () => {
    const created = await service.create(mockUser, {
      name: 'Opted In Corp',
      email: 'opt@example.com',
      phone: '+919999988888',
      emailConsent: ConsentState.OPTED_IN,
      whatsappConsent: ConsentState.OPTED_OUT,
    });

    expect(created.name).toBe('Opted In Corp');
    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailConsent: ConsentState.OPTED_IN,
          emailConsentSource: 'PORTAL_CREATE',
          emailConsentAt: expect.any(Date),
          whatsappConsent: ConsentState.OPTED_OUT,
          whatsappConsentSource: 'PORTAL_CREATE',
          whatsappConsentAt: expect.any(Date),
        }),
      }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer.created',
        entityId: 'c2',
      }),
    );
  });

  it('records audit log when customer consent is updated', async () => {
    const updated = await service.update('c1', mockUser, {
      whatsappConsent: ConsentState.OPTED_IN,
    });

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          whatsappConsent: ConsentState.OPTED_IN,
          whatsappConsentSource: 'PORTAL_UPDATE',
          whatsappConsentAt: expect.any(Date),
        }),
      }),
    );

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer.consent_updated',
        entityId: 'c1',
        metadata: expect.objectContaining({
          changes: {
            whatsappConsent: { from: ConsentState.UNKNOWN, to: ConsentState.OPTED_IN },
          },
        }),
      }),
    );
  });

  it('never modifies consent fields or timestamps when updating unrelated details', async () => {
    await service.update('c1', mockUser, {
      company: 'Acme Global Ltd',
      billingAddress: 'Tower B, Silicon Park',
    });

    const updateCall = prisma.customer.update.mock.calls[0][0];
    expect(updateCall.data.emailConsent).toBeUndefined();
    expect(updateCall.data.emailConsentAt).toBeUndefined();
    expect(updateCall.data.whatsappConsent).toBeUndefined();
    expect(updateCall.data.whatsappConsentAt).toBeUndefined();
    expect(updateCall.data.smsConsent).toBeUndefined();
    expect(updateCall.data.smsConsentAt).toBeUndefined();
    expect(updateCall.data.voiceConsent).toBeUndefined();
    expect(updateCall.data.voiceConsentAt).toBeUndefined();
    expect(updateCall.data.company).toBe('Acme Global Ltd');

    // Did not log customer.consent_updated
    const consentLog = auditLogs.log.mock.calls.find((c: any) => c[0].action === 'customer.consent_updated');
    expect(consentLog).toBeUndefined();
  });

  it('records audit log when customer voiceConsent is updated', async () => {
    const updated = await service.update('c1', mockUser, {
      voiceConsent: ConsentState.OPTED_IN,
    });

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          voiceConsent: ConsentState.OPTED_IN,
          voiceConsentSource: 'PORTAL_UPDATE',
          voiceConsentAt: expect.any(Date),
        }),
      }),
    );

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer.consent_updated',
        entityId: 'c1',
        metadata: expect.objectContaining({
          changes: {
            voiceConsent: { from: ConsentState.UNKNOWN, to: ConsentState.OPTED_IN },
          },
        }),
      }),
    );
  });
});
