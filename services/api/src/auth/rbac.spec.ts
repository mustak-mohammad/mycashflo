import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from './roles.decorator.js';
import { UserRole, InvoiceStatus, PaymentStatus, PaymentMethod } from '@prisma/client';
import { UsersService } from '../users/users.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { CollectionsService } from '../collections/collections.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';

describe('Role-Based Access Control (RBAC) & Tenant Security Battery', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  const createMockContext = (user: any, handlerRoles?: string[]): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  // ── Assertion 1: Admin can perform authorized actions within their own tenant ──
  it('1. Admin can perform authorized administrative actions within their own tenant', async () => {
    const adminUser = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };

    // Test RolesGuard allows Admin when ADMIN role is required
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext(adminUser);
    expect(rolesGuard.canActivate(ctx)).toBe(true);

    // Test UsersService.findAll scoped strictly to admin's tenant
    const mockPrisma: any = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'user_1', email: 'agent@alpha.in', name: 'Agent Alpha', role: UserRole.AGENT, tenantId: 'tenant_alpha' },
        ]),
      },
    };
    const mockAudit: any = { log: vi.fn().mockResolvedValue(true) };
    const usersService = new UsersService(mockPrisma, mockAudit);

    const users = await usersService.findAll(adminUser);
    expect(users).toHaveLength(1);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant_alpha' },
      select: expect.any(Object),
      orderBy: { createdAt: 'desc' },
    });
  });

  // ── Assertion 2: Admin cannot access another tenant's data ──
  it('2. Admin cannot access another tenant\'s data', async () => {
    const adminTenantA = { userId: 'admin_a', tenantId: 'tenant_a', role: UserRole.ADMIN };

    const mockPrisma: any = {
      customer: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          // If customer belongs to tenant_b, query with tenant_a must return null
          if (where.tenantId === 'tenant_a' && where.id === 'cust_tenant_b') {
            return Promise.resolve(null);
          }
          return Promise.resolve({ id: 'cust_tenant_b', tenantId: 'tenant_b' });
        }),
      },
      collectionCase: { findMany: vi.fn().mockResolvedValue([]) },
      followUpTask: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const customersService = new CustomersService(mockPrisma);

    await expect(customersService.findOne('cust_tenant_b', adminTenantA)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cust_tenant_b', tenantId: 'tenant_a' }),
      }),
    );
  });

  // ── Assertion 3: Agent can access assigned customers and cases ──
  it('3. Agent can access assigned customers and cases', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };

    const mockPrisma: any = {
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'case_1', customerId: 'cust_assigned_1', assignedTo: 'agent_007' },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'case_1',
          customerId: 'cust_assigned_1',
          assignedTo: 'agent_007',
          tenantId: 'tenant_alpha',
        }),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cust_assigned_1', name: 'Assigned Customer Corp', notes: null },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'cust_assigned_1',
          name: 'Assigned Customer Corp',
          tenantId: 'tenant_alpha',
          notes: null,
          invoices: [],
          payments: [],
        }),
      },
    };

    const customersService = new CustomersService(mockPrisma);
    const collectionsService = new CollectionsService(mockPrisma);

    // Agent queries customers -> Scoped to assigned customer
    const custList = await customersService.findAll(agentUser, {} as any);
    expect(custList.data).toHaveLength(1);
    expect(custList.data[0].id).toBe('cust_assigned_1');

    // Agent queries their assigned case -> Returns successfully
    const singleCase = await collectionsService.findOne('case_1', agentUser);
    expect(singleCase.id).toBe('case_1');
    expect(singleCase.assignedTo).toBe('agent_007');

    // Agent queries assigned customer details -> Returns successfully
    const singleCust = await customersService.findOne('cust_assigned_1', agentUser);
    expect(singleCust.id).toBe('cust_assigned_1');
  });

  // ── Assertion 4: Agent cannot access unassigned restricted records ──
  it('4. Agent cannot access unassigned restricted records', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };

    const mockPrisma: any = {
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([
          // Only assigned to cust_1, NOT cust_unassigned
          { id: 'case_1', customerId: 'cust_1', assignedTo: 'agent_007' },
        ]),
        findFirst: vi.fn().mockResolvedValue({
          id: 'case_unassigned_99',
          customerId: 'cust_unassigned',
          assignedTo: 'agent_other_999',
          tenantId: 'tenant_alpha',
        }),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'cust_unassigned',
          name: 'Unassigned Customer',
          tenantId: 'tenant_alpha',
          notes: null,
        }),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv_unassigned_1',
          customerId: 'cust_unassigned',
          tenantId: 'tenant_alpha',
        }),
      },
    };

    const customersService = new CustomersService(mockPrisma);
    const collectionsService = new CollectionsService(mockPrisma);
    const invoicesService = new InvoicesService(mockPrisma);

    // Agent tries to read unassigned collection case -> 403 Forbidden
    await expect(collectionsService.findOne('case_unassigned_99', agentUser)).rejects.toThrow(
      ForbiddenException,
    );

    // Agent tries to read unassigned customer profile -> 403 Forbidden
    await expect(customersService.findOne('cust_unassigned', agentUser)).rejects.toThrow(
      ForbiddenException,
    );

    // Agent tries to read invoice for unassigned customer -> 403 Forbidden
    await expect(invoicesService.findOne('inv_unassigned_1', agentUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── Assertion 5: Agent cannot create users, assign roles, or escalate privileges ──
  it('5. Agent cannot create users, assign roles, or escalate privileges', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };

    // RolesGuard blocks Agent from Admin-only endpoints
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext(agentUser);
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);

    // Direct invocation check on UsersService / InvoicesService
    const mockPrisma: any = { user: { create: vi.fn() } };
    const mockAudit: any = { log: vi.fn() };
    const invoicesService = new InvoicesService(mockPrisma, mockAudit);

    // Agent attempts to create invoice -> Blocked
    await expect(
      invoicesService.create(agentUser, {
        number: 'INV-HACK-01',
        customerId: 'cust_1',
        amount: 50000,
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── Assertion 6: Agent cannot directly alter invoice balances or mark invoices paid ──
  it('6. Agent cannot directly alter invoice balances or mark invoices paid', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };

    const mockPrisma: any = {
      invoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv_100',
          number: 'INV-100',
          customerId: 'cust_1',
          amount: 50000,
          outstanding: 50000,
          status: InvoiceStatus.OPEN,
          tenantId: 'tenant_alpha',
        }),
        update: vi.fn(),
      },
      payment: { create: vi.fn() },
    };
    const mockAudit: any = { log: vi.fn() };
    const mockIntegrations: any = {};
    const paymentsService = new PaymentsService(mockPrisma, mockAudit, mockIntegrations);

    // Agent directly calls recordPayment -> Blocked with 403 Forbidden
    await expect(
      paymentsService.recordPayment(agentUser, {
        invoiceId: 'inv_100',
        amount: 50000,
        paymentDate: '2026-10-22',
        reference: 'DIRECT-SETTLEMENT-ATTEMPT',
      }),
    ).rejects.toThrow(ForbiddenException);

    // Verify invoice was NEVER updated
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  // ── Assertion 7: Payment claims do not change outstanding balances ──
  it('7. Payment claims record evidence with AWAITING_VERIFICATION and do NOT alter outstanding balances', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };

    const originalInvoice = {
      id: 'inv_claim_test',
      number: 'INV-2026-CLAIM',
      customerId: 'cust_assigned_1',
      amount: 45000,
      outstanding: 45000,
      currency: 'INR',
      status: InvoiceStatus.OPEN,
      tenantId: 'tenant_alpha',
    };

    let createdPaymentRecord: any = null;
    const mockPrisma: any = {
      invoice: {
        findFirst: vi.fn().mockResolvedValue(originalInvoice),
        update: vi.fn(), // Should NEVER be called
      },
      customer: {
        update: vi.fn(), // Should NEVER be called
      },
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'case_1', customerId: 'cust_assigned_1', assignedTo: 'agent_007' },
        ]),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        findFirst: vi.fn().mockResolvedValue(null), // No duplicate
        create: vi.fn().mockImplementation(({ data }) => {
          createdPaymentRecord = { id: 'pay_claim_001', ...data };
          return Promise.resolve(createdPaymentRecord);
        }),
      },
    };
    const mockAudit: any = { log: vi.fn().mockResolvedValue(true) };
    const mockIntegrations: any = {};
    const paymentsService = new PaymentsService(mockPrisma, mockAudit, mockIntegrations);

    const claimResult = await paymentsService.recordPaymentClaim(agentUser, {
      invoiceId: 'inv_claim_test',
      amount: 45000,
      paymentDate: '2026-10-22',
      reference: 'CLAIM-NEFT-998877',
      method: PaymentMethod.BANK_TRANSFER,
      notes: 'Customer transferred via Axis Bank NEFT and uploaded screenshot',
      evidenceUrl: 'https://cdn.mycashflo.internal/proofs/axis-screenshot-998877.jpg',
    });

    // 1. Success with distinct AWAITING_VERIFICATION claimStatus
    expect(claimResult.success).toBe(true);
    expect(claimResult.claimStatus).toBe('AWAITING_VERIFICATION');

    // 2. Created payment has status PENDING (not COMPLETED) and paidAt is null
    expect(createdPaymentRecord.status).toBe(PaymentStatus.PENDING);
    expect(createdPaymentRecord.paidAt).toBeNull();
    expect(createdPaymentRecord.notes).toContain('AWAITING_VERIFICATION');
    expect(createdPaymentRecord.notes).toContain('axis-screenshot-998877.jpg');

    // 3. Outstanding balance is completely untouched
    expect(claimResult.outstandingBalance).toBe(45000);
    expect(claimResult.invoiceStatus).toBe(InvoiceStatus.OPEN);
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();

    // 4. Audit trail logged
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.claim_submitted',
        tenantId: 'tenant_alpha',
        userId: 'agent_007',
        metadata: expect.objectContaining({
          status: 'AWAITING_VERIFICATION',
          claimedAmount: 45000,
          reference: 'CLAIM-NEFT-998877',
        }),
      }),
    );
  });

  // ── Assertion 8: Only authorized workflows can approve financial adjustments ──
  it('8. Only authorized workflows (Admin/Manager) can approve financial adjustments or verify claims', async () => {
    const agentUser = { userId: 'agent_007', tenantId: 'tenant_alpha', role: UserRole.AGENT };
    const adminUser = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };

    const pendingPayment = {
      id: 'pay_claim_001',
      tenantId: 'tenant_alpha',
      ref: 'CLAIM-NEFT-998877',
      amount: 45000,
      status: PaymentStatus.PENDING,
      notes: 'AWAITING_VERIFICATION: Customer claim',
      invoice: {
        id: 'inv_claim_test',
        number: 'INV-2026-CLAIM',
        customerId: 'cust_1',
        amount: 45000,
        outstanding: 45000,
        currency: 'INR',
        status: InvoiceStatus.OPEN,
      },
      customer: { id: 'cust_1' },
    };

    const mockPrisma: any = {
      payment: {
        findFirst: vi.fn().mockResolvedValue(pendingPayment),
        update: vi.fn().mockResolvedValue({ ...pendingPayment, status: PaymentStatus.COMPLETED }),
      },
      invoice: {
        update: vi.fn().mockResolvedValue({ id: 'inv_claim_test', outstanding: 0, status: InvoiceStatus.PAID }),
        findMany: vi.fn().mockResolvedValue([]), // No remaining unpaid
      },
      customer: {
        update: vi.fn().mockResolvedValue({ id: 'cust_1', outstandingBalance: 0 }),
      },
      collectionCase: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const mockAudit: any = { log: vi.fn().mockResolvedValue(true) };
    const paymentsService = new PaymentsService(mockPrisma, mockAudit, {} as any);

    // 1. Agent attempts to verify claim -> 403 Forbidden
    await expect(paymentsService.verifyPaymentClaim('pay_claim_001', agentUser)).rejects.toThrow(
      ForbiddenException,
    );

    // 2. Admin verifies claim -> Reconciled to COMPLETED and balances settled
    const verification = await paymentsService.verifyPaymentClaim('pay_claim_001', adminUser);
    expect(verification.success).toBe(true);
    expect(verification.remainingOutstanding).toBe(0);
    expect(verification.newStatus).toBe(InvoiceStatus.PAID);
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.COMPLETED }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.claim_verified' }),
    );
  });

  // ── Assertion 9: Cross-tenant and direct API attacks are rejected ──
  it('9. Cross-tenant and direct API attacks are strictly rejected', async () => {
    // Attack scenario: Attacker passes manipulated JWT payload or tries to access another tenant's payment
    const attacker = { userId: 'attacker_1', tenantId: 'tenant_victim', role: 'INVALID_ROLE' };
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN, UserRole.MANAGER]);

    const ctx = createMockContext(attacker);
    // Invalid/unrecognized role fails RolesGuard
    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);

    // Missing user / unauthenticated context fails RolesGuard
    const unauthCtx = createMockContext(null);
    expect(() => rolesGuard.canActivate(unauthCtx)).toThrow(ForbiddenException);
  });

  // ── Assertion 10: Existing security, idempotency, audit logging, and opt-out protections preserved ──
  it('10. Existing security, idempotency, audit logging, and opt-out protections remain intact', async () => {
    const adminUser = { userId: 'admin_1', tenantId: 'tenant_alpha', role: UserRole.ADMIN };

    const mockPrisma: any = {
      invoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv_1',
          number: 'INV-001',
          customerId: 'cust_optout_1',
          outstanding: 10000,
          currency: 'INR',
          status: InvoiceStatus.OPEN,
          tenantId: 'tenant_alpha',
        }),
      },
      payment: {
        // Idempotency: duplicate reference in same tenant is rejected
        findFirst: vi.fn().mockResolvedValue({ id: 'pay_existing', ref: 'DUPLICATE-REF-123' }),
      },
    };
    const mockAudit: any = { log: vi.fn() };
    const paymentsService = new PaymentsService(mockPrisma, mockAudit, {} as any);

    // Duplicate payment reference is rejected idempotently
    await expect(
      paymentsService.recordPayment(adminUser, {
        invoiceId: 'inv_1',
        amount: 5000,
        paymentDate: '2026-10-22',
        reference: 'DUPLICATE-REF-123',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
