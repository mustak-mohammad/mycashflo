import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DocumentDeliveryService,
  CreateDocumentDeliveryDto,
} from './document-delivery.service.js';
import {
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
  PaymentMethod,
  PaymentStatus,
  ConsentState,
} from '@prisma/client';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('DocumentDeliveryService - Customer-Requested Invoices & Payment Links', () => {
  let service: DocumentDeliveryService;
  let mockPrisma: any;
  let mockPaymentsService: any;
  let mockIntegrations: any;
  let mockAuditLogs: any;

  let customers: any[];
  let invoices: any[];
  let payments: any[];
  let deliveryRequests: any[];
  let deliveryAttempts: any[];
  let tenants: any[];

  const adminUser: AuthUser = {
    userId: 'admin_1',
    tenantId: 'tenant_abc',
    role: 'ADMIN',
  };

  const agentUser: AuthUser = {
    userId: 'agent_1',
    tenantId: 'tenant_abc',
    role: 'AGENT',
  };

  beforeEach(() => {
    tenants = [
      { id: 'tenant_abc', name: 'ABC Corp' },
      { id: 'tenant_xyz', name: 'XYZ Corp' },
    ];

    customers = [
      {
        id: 'cust_100',
        tenantId: 'tenant_abc',
        name: 'Sharma Traders',
        phone: '+919876543210',
        email: 'accounts@sharma-traders.com',
        outstandingBalance: 25000,
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        smsConsent: ConsentState.OPTED_IN,
      },
      {
        id: 'cust_unassigned',
        tenantId: 'tenant_abc',
        name: 'Unassigned Customer',
        phone: '+919876543211',
        email: 'unassigned@example.com',
        outstandingBalance: 10000,
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        smsConsent: ConsentState.OPTED_IN,
      },
      {
        id: 'cust_other_tenant',
        tenantId: 'tenant_xyz',
        name: 'Other Tenant Customer',
        phone: '+919876543299',
        email: 'other@example.com',
        outstandingBalance: 50000,
      },
      {
        id: 'cust_no_contact',
        tenantId: 'tenant_abc',
        name: 'Incomplete Contacts Co',
        phone: '',
        email: 'invalid-email',
        outstandingBalance: 15000,
      },
    ];

    invoices = [
      {
        id: 'inv_100',
        number: 'INV-2026-100',
        customerId: 'cust_100',
        tenantId: 'tenant_abc',
        amount: 25000,
        outstanding: 25000,
        currency: 'INR',
        status: 'OVERDUE',
        dueDate: new Date('2026-11-01'),
        customer: customers[0],
      },
      {
        id: 'inv_paid',
        number: 'INV-2026-PAID',
        customerId: 'cust_100',
        tenantId: 'tenant_abc',
        amount: 5000,
        outstanding: 0,
        currency: 'INR',
        status: 'PAID',
        customer: customers[0],
      },
      {
        id: 'inv_cancelled',
        number: 'INV-2026-CANC',
        customerId: 'cust_100',
        tenantId: 'tenant_abc',
        amount: 12000,
        outstanding: 12000,
        currency: 'INR',
        status: 'CANCELLED',
        customer: customers[0],
      },
    ];

    payments = [];
    deliveryRequests = [];
    deliveryAttempts = [];

    mockPrisma = {
      tenant: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          return tenants.find((t) => t.id === where.id) || null;
        }),
      },
      customer: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return customers.find((c) => {
            if (where.id && c.id !== where.id) return false;
            if (where.tenantId && c.tenantId !== where.tenantId) return false;
            return true;
          }) || null;
        }),
      },
      invoice: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return invoices.find((inv) => {
            if (where.id && inv.id !== where.id) return false;
            if (where.tenantId && inv.tenantId !== where.tenantId) return false;
            if (where.customerId && inv.customerId !== where.customerId) return false;
            return true;
          }) || null;
        }),
        findMany: vi.fn().mockImplementation(({ where }) => {
          return invoices.filter((inv) => {
            if (where.tenantId && inv.tenantId !== where.tenantId) return false;
            if (where.customerId && inv.customerId !== where.customerId) return false;
            if (where.status?.in && !where.status.in.includes(inv.status)) return false;
            return true;
          });
        }),
      },
      payment: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return payments.find((p) => {
            if (where.tenantId && p.tenantId !== where.tenantId) return false;
            if (where.invoiceId && p.invoiceId !== where.invoiceId) return false;
            if (where.method && p.method !== where.method) return false;
            if (where.status && p.status !== where.status) return false;
            return true;
          }) || null;
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const newPay = { id: `pay_${Date.now()}`, ...data };
          payments.push(newPay);
          return newPay;
        }),
      },
      documentDeliveryRequest: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          return deliveryRequests.find((r) => r.idempotencyKey === where.idempotencyKey) || null;
        }),
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return deliveryRequests.find((r) => {
            if (where.id && r.id !== where.id) return false;
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.customerId && r.customerId !== where.customerId) return false;
            if (where.invoiceId && r.invoiceId !== where.invoiceId) return false;
            if (where.requestType && r.requestType !== where.requestType) return false;
            if (where.deliveryChannel && r.deliveryChannel !== where.deliveryChannel) return false;
            return true;
          }) || null;
        }),
        findMany: vi.fn().mockImplementation(({ where }) => {
          return deliveryRequests.filter((r) => {
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.customerId && r.customerId !== where.customerId) return false;
            return true;
          });
        }),
        count: vi.fn().mockImplementation(() => deliveryRequests.length),
        create: vi.fn().mockImplementation(({ data }) => {
          const req = {
            id: `req_${deliveryRequests.length + 1}`,
            requestedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            attempts: [],
            ...data,
          };
          deliveryRequests.push(req);
          return req;
        }),
        update: vi.fn().mockImplementation(({ where, data }) => {
          const existing = deliveryRequests.find((r) => r.id === where.id);
          if (existing) {
            Object.assign(existing, data);
            existing.attempts = deliveryAttempts.filter((a) => a.requestId === existing.id);
            existing.customer = customers.find((c) => c.id === existing.customerId);
            existing.invoice = invoices.find((i) => i.id === existing.invoiceId);
          }
          return existing;
        }),
      },
      deliveryAttempt: {
        create: vi.fn().mockImplementation(({ data }) => {
          const attempt = {
            id: `att_${deliveryAttempts.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          deliveryAttempts.push(attempt);
          return attempt;
        }),
      },
      collectionCase: {
        findMany: vi.fn().mockImplementation(({ where }) => {
          if (where.assignedTo === 'agent_1') {
            return [{ customerId: 'cust_100' }];
          }
          return [];
        }),
      },
      followUpTask: {
        findMany: vi.fn().mockReturnValue([]),
      },
    };

    mockPaymentsService = {
      createPaymentLink: vi.fn().mockResolvedValue({
        paymentLinkId: 'plink_generated_123',
        shortUrl: 'https://pay.mycashflo.in/l/plink_generated_123',
        isSimulated: true,
      }),
    };

    mockIntegrations = {
      whatsapp: {
        send: vi.fn().mockResolvedValue({
          messageId: 'wamid.simulated_12345',
          status: 'DELIVERED',
          isSimulated: true,
        }),
      },
      email: {
        send: vi.fn().mockResolvedValue({
          messageId: 'msg_simulated_email_123',
          status: 'DELIVERED',
          isSimulated: true,
        }),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({}),
    };

    service = new DocumentDeliveryService(
      mockPrisma,
      mockPaymentsService,
      mockIntegrations,
      mockAuditLogs,
    );
  });

  // ── 1. Tenant & Customer Ownership Validation ─────────────────────────────
  describe('Tenant & Customer Ownership Validation', () => {
    it('throws NotFoundException if customer does not exist in the tenant', async () => {
      await expect(
        service.requestDelivery(adminUser, { customerId: 'non_existent_cust' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if customer belongs to another tenant (strict isolation)', async () => {
      await expect(
        service.requestDelivery(adminUser, { customerId: 'cust_other_tenant' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces RBAC: Agent cannot request delivery for unassigned customer', async () => {
      await expect(
        service.requestDelivery(agentUser, { customerId: 'cust_unassigned' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('enforces RBAC: Agent CAN request delivery for assigned customer', async () => {
      const res = await service.requestDelivery(agentUser, { customerId: 'cust_100' });
      expect(res.request.status).toBe(DocumentDeliveryStatus.COMPLETED);
    });
  });

  // ── 2. Invoice Ownership & Resolution ─────────────────────────────────────
  describe('Invoice Ownership & Status Validation', () => {
    it('throws NotFoundException if invoice does not belong to customer', async () => {
      await expect(
        service.requestDelivery(adminUser, { customerId: 'cust_100', invoiceId: 'inv_other' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('auto-resolves customer overdue invoice when invoiceId is omitted', async () => {
      const res = await service.requestDelivery(adminUser, { customerId: 'cust_100' });
      expect(res.request.invoiceId).toBe('inv_100');
    });

    it('rejects delivery for CANCELLED invoice', async () => {
      await expect(
        service.requestDelivery(adminUser, { customerId: 'cust_100', invoiceId: 'inv_cancelled' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects PAYMENT_LINK request for already PAID invoice', async () => {
      await expect(
        service.requestDelivery(adminUser, {
          customerId: 'cust_100',
          invoiceId: 'inv_paid',
          requestType: DocumentRequestType.PAYMENT_LINK,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── 3. Scoped Idempotency & Debounce ───────────────────────────────────────
  describe('Scoped Idempotency & Resend Control', () => {
    it('deduplicates request with explicit idempotencyKey without re-dispatching', async () => {
      const key = 'user_defined_idempotency_key_999';
      const first = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        idempotencyKey: key,
      });
      expect(first.isDuplicate).toBe(false);

      const second = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        idempotencyKey: key,
      });
      expect(second.isDuplicate).toBe(true);
      expect(mockIntegrations.whatsapp.send).toHaveBeenCalledTimes(1);
    });

    it('deduplicates identical request within 15-minute debounce window', async () => {
      const first = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        requestType: DocumentRequestType.BOTH,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });
      expect(first.isDuplicate).toBe(false);

      const second = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        requestType: DocumentRequestType.BOTH,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });
      expect(second.isDuplicate).toBe(true);
      expect(mockIntegrations.whatsapp.send).toHaveBeenCalledTimes(1);
    });

    it('allows re-dispatch when resend: true is explicitly requested', async () => {
      const first = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
      });
      expect(first.isDuplicate).toBe(false);

      const resend = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        resend: true,
      });
      expect(resend.isDuplicate).toBe(false);
      expect(mockIntegrations.whatsapp.send).toHaveBeenCalledTimes(2);
    });
  });

  // ── 4. Payment Link Service Integration & Active Link Reuse ───────────────
  describe('Payment Link Integration & Link Reuse', () => {
    it('creates new simulated payment link if no active link exists', async () => {
      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        requestType: DocumentRequestType.PAYMENT_LINK,
      });

      expect(mockPaymentsService.createPaymentLink).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ invoiceId: 'inv_100', simulate: true }),
      );
      expect(res.request.metadata.paymentLinkUrl).toBe('https://pay.mycashflo.in/l/plink_generated_123');
      expect(res.request.metadata.isPaymentLinkReused).toBe(false);
    });

    it('reuses existing active pending payment link created within 24 hours', async () => {
      payments.push({
        id: 'pay_existing_1',
        tenantId: 'tenant_abc',
        invoiceId: 'inv_100',
        method: PaymentMethod.PAYMENT_LINK,
        status: PaymentStatus.PENDING,
        providerRef: 'plink_existing_456',
        notes: 'https://pay.mycashflo.in/l/plink_existing_456',
        createdAt: new Date(),
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        requestType: DocumentRequestType.BOTH,
      });

      expect(mockPaymentsService.createPaymentLink).not.toHaveBeenCalled();
      expect(res.request.metadata.paymentLinkUrl).toBe('https://pay.mycashflo.in/l/plink_existing_456');
      expect(res.request.metadata.isPaymentLinkReused).toBe(true);
    });

    it('does NOT create or attach payment link when requestType is INVOICE', async () => {
      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        requestType: DocumentRequestType.INVOICE,
      });

      expect(mockPaymentsService.createPaymentLink).not.toHaveBeenCalled();
      expect(res.request.metadata.paymentLinkUrl).toBeUndefined();
    });
  });

  // ── 5. Secure Short-Lived Signed PDF URLs ──────────────────────────────────
  describe('Cryptographically Signed Short-Lived PDF Tokens', () => {
    it('generates a valid signed token and verifies it', () => {
      const token = service.generateSignedInvoiceToken('tenant_abc', 'inv_100', 'cust_100');
      expect(token).toContain('.');

      const verification = service.verifySignedInvoiceToken(token, 'inv_100');
      expect(verification.valid).toBe(true);
      expect(verification.payload?.tenantId).toBe('tenant_abc');
      expect(verification.payload?.customerId).toBe('cust_100');
    });

    it('rejects a tampered token signature', () => {
      const token = service.generateSignedInvoiceToken('tenant_abc', 'inv_100', 'cust_100');
      const [payload] = token.split('.');
      const tampered = `${payload}.invalid_signature_hex`;

      const verification = service.verifySignedInvoiceToken(tampered, 'inv_100');
      expect(verification.valid).toBe(false);
    });

    it('rejects a token issued for a different invoice', () => {
      const token = service.generateSignedInvoiceToken('tenant_abc', 'inv_100', 'cust_100');
      const verification = service.verifySignedInvoiceToken(token, 'inv_different');
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('different invoice');
    });

    it('rejects an expired token', () => {
      const expiredToken = service.generateSignedInvoiceToken('tenant_abc', 'inv_100', 'cust_100', -1000);
      const verification = service.verifySignedInvoiceToken(expiredToken, 'inv_100');
      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('expired');
    });

    it('retrieves secure invoice PDF buffer and valid filename', async () => {
      const token = service.generateSignedInvoiceToken('tenant_abc', 'inv_100', 'cust_100');
      const { buffer, filename } = await service.getSecureInvoicePdf('inv_100', token);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
      expect(filename).toBe('invoice-INV-2026-100.pdf');
    });

    it('throws UnauthorizedException on invalid token during PDF download', async () => {
      await expect(
        service.getSecureInvoicePdf('inv_100', 'invalid.token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── 6. Independent Multi-Channel Dispatch & Status Persistence ─────────────
  describe('Independent Multi-Channel Dispatch & Per-Channel Status', () => {
    it('dispatches both WhatsApp and Email independently in simulation mode', async () => {
      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.COMPLETED);
      expect(deliveryAttempts).toHaveLength(2);

      const waAttempt = deliveryAttempts.find((a) => a.channel === DeliveryAttemptChannel.WHATSAPP);
      const emailAttempt = deliveryAttempts.find((a) => a.channel === DeliveryAttemptChannel.EMAIL);

      expect(waAttempt).toBeDefined();
      expect(waAttempt.status).toBe(DeliveryAttemptStatus.SIMULATED);
      expect(waAttempt.provider).toBe('WHATSAPP_CLOUD');
      expect(waAttempt.destinationMasked).toBe(service.maskPhone(customers[0].phone));

      expect(emailAttempt).toBeDefined();
      expect(emailAttempt.status).toBe(DeliveryAttemptStatus.SIMULATED);
      expect(emailAttempt.provider).toBe('RESEND');
      expect(emailAttempt.destinationMasked).toBe(service.maskEmail(customers[0].email));
    });

    it('marks PARTIAL_SUCCESS when WhatsApp succeeds but email is invalid', async () => {
      customers.push({
        id: 'cust_phone_only',
        tenantId: 'tenant_abc',
        name: 'Phone Only Corp',
        phone: '+919876543222',
        email: 'invalid-email-address',
        outstandingBalance: 12000,
        whatsappConsent: ConsentState.OPTED_IN,
        emailConsent: ConsentState.OPTED_IN,
      });

      invoices.push({
        id: 'inv_phone_only',
        number: 'INV-PHONE-001',
        customerId: 'cust_phone_only',
        tenantId: 'tenant_abc',
        amount: 12000,
        outstanding: 12000,
        currency: 'INR',
        status: 'OPEN',
        customer: customers[customers.length - 1],
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_phone_only',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.PARTIAL_SUCCESS);

      const waAttempt = deliveryAttempts.find((a) => a.requestId === res.request.id && a.channel === 'WHATSAPP');
      const emailAttempt = deliveryAttempts.find((a) => a.requestId === res.request.id && a.channel === 'EMAIL');

      expect(waAttempt.status).toBe(DeliveryAttemptStatus.SIMULATED);
      expect(emailAttempt.status).toBe(DeliveryAttemptStatus.FAILED);
      expect(emailAttempt.errorMessage).toContain('valid email');
    });

    it('marks FAILED when both phone and email are missing/invalid', async () => {
      invoices.push({
        id: 'inv_no_contact',
        number: 'INV-NOCONTACT-001',
        customerId: 'cust_no_contact',
        tenantId: 'tenant_abc',
        amount: 15000,
        outstanding: 15000,
        currency: 'INR',
        status: 'OPEN',
        customer: customers.find((c) => c.id === 'cust_no_contact'),
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_no_contact',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      const attempts = deliveryAttempts.filter((a) => a.requestId === res.request.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].status).toBe(DeliveryAttemptStatus.FAILED);
      expect(attempts[1].status).toBe(DeliveryAttemptStatus.FAILED);
    });
  });

  // ── 7. Privacy Masking & Audit Logging ────────────────────────────────────
  describe('Privacy Masking & Audit Logging', () => {
    it('masks phone numbers and email addresses properly', () => {
      expect(service.maskPhone('+919876543210')).toBe('+91 ****3210');
      expect(service.maskPhone(null)).toBe('****');

      expect(service.maskEmail('john.doe@example.com')).toBe('j****e@example.com');
      expect(service.maskEmail(null)).toBe('****');
    });

    it('records structured audit log for document delivery process', async () => {
      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_100',
      });

      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_abc',
          userId: 'admin_1',
          action: 'document_delivery.processed',
          entityType: 'DocumentDeliveryRequest',
          entityId: res.request.id,
          metadata: expect.objectContaining({
            invoiceNumber: 'INV-2026-100',
            customerId: 'cust_100',
            status: DocumentDeliveryStatus.COMPLETED,
          }),
        }),
      );
    });
  });

  // ── 8. Phase 1C.1 Centralized Consent Enforcement Guard ───────────────────
  describe('Phase 1C.1 — Centralized Consent Enforcement Guard', () => {
    it('suppresses Email dispatch and does NOT call provider when emailConsent is OPTED_OUT', async () => {
      customers.push({
        id: 'cust_email_opted_out',
        tenantId: 'tenant_abc',
        name: 'Opted Out Email Corp',
        phone: '+919876543201',
        email: 'optout@emailcorp.in',
        emailConsent: ConsentState.OPTED_OUT,
        whatsappConsent: ConsentState.OPTED_IN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_email_optout',
        number: 'INV-EM-001',
        customerId: 'cust_email_opted_out',
        tenantId: 'tenant_abc',
        amount: 5000,
        outstanding: 5000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_email_opted_out',
        deliveryChannel: DeliveryChannelPreference.EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      const attempt = deliveryAttempts.find((a) => a.requestId === res.request.id && a.channel === 'EMAIL');
      expect(attempt).toBeDefined();
      expect(attempt.status).toBe(DeliveryAttemptStatus.FAILED);
      expect(attempt.errorMessage).toContain('Outreach suppressed: Customer has explicitly opted out of EMAIL communications');
      expect(attempt.sentAt).toBeNull();
    });

    it('suppresses WhatsApp dispatch and does NOT call provider when whatsappConsent is OPTED_OUT', async () => {
      customers.push({
        id: 'cust_wa_opted_out',
        tenantId: 'tenant_abc',
        name: 'Opted Out WA Corp',
        phone: '+919876543202',
        email: 'waoptout@corp.in',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_OUT,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_wa_optout',
        number: 'INV-WA-001',
        customerId: 'cust_wa_opted_out',
        tenantId: 'tenant_abc',
        amount: 6000,
        outstanding: 6000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_wa_opted_out',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      const attempt = deliveryAttempts.find((a) => a.requestId === res.request.id && a.channel === 'WHATSAPP');
      expect(attempt).toBeDefined();
      expect(attempt.status).toBe(DeliveryAttemptStatus.FAILED);
      expect(attempt.errorMessage).toContain('Outreach suppressed: Customer has explicitly opted out of WHATSAPP communications');
      expect(attempt.sentAt).toBeNull();
    });

    it('suppresses dispatch when consent is UNKNOWN (never implies consent)', async () => {
      customers.push({
        id: 'cust_unknown_consent',
        tenantId: 'tenant_abc',
        name: 'Unknown Consent Ltd',
        phone: '+919876543203',
        email: 'unknown@consent.in',
        emailConsent: ConsentState.UNKNOWN,
        whatsappConsent: ConsentState.UNKNOWN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_unknown',
        number: 'INV-UNK-001',
        customerId: 'cust_unknown_consent',
        tenantId: 'tenant_abc',
        amount: 7000,
        outstanding: 7000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_unknown_consent',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      const attempts = deliveryAttempts.filter((a) => a.requestId === res.request.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[0].errorMessage).toContain('consent state: UNKNOWN');
      expect(attempts[1].errorMessage).toContain('consent state: UNKNOWN');
    });

    it('suppresses only target channel for legacy channel-specific DND', async () => {
      customers.push({
        id: 'cust_legacy_wa_dnd',
        tenantId: 'tenant_abc',
        name: 'Legacy WA DND Corp',
        phone: '+919876543204',
        email: 'legacydnd@corp.in',
        notes: '[OPT_OUT:WHATSAPP - Requested stop via WhatsApp]',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_legacy_dnd',
        number: 'INV-LEG-001',
        customerId: 'cust_legacy_wa_dnd',
        tenantId: 'tenant_abc',
        amount: 8000,
        outstanding: 8000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_legacy_wa_dnd',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      // WA suppressed, Email allowed -> PARTIAL_SUCCESS
      expect(res.request.status).toBe(DocumentDeliveryStatus.PARTIAL_SUCCESS);
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).toHaveBeenCalledTimes(1);

      const waAttempt = deliveryAttempts.find((a) => a.requestId === res.request.id && a.channel === 'WHATSAPP');
      expect(waAttempt.errorMessage).toContain('historical WhatsApp-specific opt-out directive');
    });

    it('suppresses all channels when customer has ambiguous legacy DND', async () => {
      customers.push({
        id: 'cust_ambiguous_dnd',
        tenantId: 'tenant_abc',
        name: 'Ambiguous DND Corp',
        phone: '+919876543205',
        email: 'ambiguous@corp.in',
        notes: '[DND:NO_CONTACT - Requested on 2026-11-02T10:29:00.907Z]',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_ambig',
        number: 'INV-AMB-001',
        customerId: 'cust_ambiguous_dnd',
        tenantId: 'tenant_abc',
        amount: 9000,
        outstanding: 9000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_ambiguous_dnd',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      const attempts = deliveryAttempts.filter((a) => a.requestId === res.request.id);
      expect(attempts[0].errorMessage).toContain('ambiguous historical DND/cease-contact record pending review');
      expect(attempts[1].errorMessage).toContain('ambiguous historical DND/cease-contact record pending review');
    });

    it('suppresses all channels when customer has global cease-contact directive', async () => {
      customers.push({
        id: 'cust_global_dnd',
        tenantId: 'tenant_abc',
        name: 'Global Cease Contact Ltd',
        phone: '+919876543206',
        email: 'cease@contact.in',
        notes: 'Customer demand: cease-contact on all channels immediately',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_global_cease',
        number: 'INV-GLO-001',
        customerId: 'cust_global_dnd',
        tenantId: 'tenant_abc',
        amount: 9500,
        outstanding: 9500,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_global_dnd',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.FAILED);
      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
      const attempts = deliveryAttempts.filter((a) => a.requestId === res.request.id);
      expect(attempts[0].errorMessage).toContain('explicit global cease-contact directive');
      expect(attempts[1].errorMessage).toContain('explicit global cease-contact directive');
    });

    it('dispatches cleanly when customer has explicit OPTED_IN consent on all channels', async () => {
      customers.push({
        id: 'cust_opted_in',
        tenantId: 'tenant_abc',
        name: 'Fully Consented Corp',
        phone: '+919876543207',
        email: 'consented@corp.in',
        emailConsent: ConsentState.OPTED_IN,
        whatsappConsent: ConsentState.OPTED_IN,
        status: 'ACTIVE',
      });
      invoices.push({
        id: 'inv_consented',
        number: 'INV-CON-001',
        customerId: 'cust_opted_in',
        tenantId: 'tenant_abc',
        amount: 11000,
        outstanding: 11000,
        currency: 'INR',
        status: 'OPEN',
      });

      const res = await service.requestDelivery(adminUser, {
        customerId: 'cust_opted_in',
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      });

      expect(res.request.status).toBe(DocumentDeliveryStatus.COMPLETED);
      expect(mockIntegrations.whatsapp.send).toHaveBeenCalledTimes(1);
      expect(mockIntegrations.email.send).toHaveBeenCalledTimes(1);
    });

    it('strictly isolates cross-tenant customer IDs before any dispatch evaluation', async () => {
      await expect(
        service.requestDelivery(adminUser, {
          customerId: 'cust_other_tenant', // belongs to tenant_xyz
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockIntegrations.whatsapp.send).not.toHaveBeenCalled();
      expect(mockIntegrations.email.send).not.toHaveBeenCalled();
    });
  });
});

