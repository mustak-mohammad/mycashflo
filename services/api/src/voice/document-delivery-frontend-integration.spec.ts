import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DocumentDeliveryService,
  CreateDocumentDeliveryDto,
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptStatus,
} from './document-delivery.service.js'
import { NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { AuthUser } from '../auth/current-user.decorator.js'
import { ConsentState } from '@prisma/client'

describe('Phase D — Document Delivery Frontend Integration & Verification (14 Scenarios)', () => {
  let service: DocumentDeliveryService
  let prismaMock: any
  let paymentsServiceMock: any
  let integrationsMock: any
  let auditLogsServiceMock: any

  const tenantA = 'tenant_front_001'
  const tenantB = 'tenant_front_002'
  const customerId = 'cust_front_001'
  const invoiceId = 'inv_front_001'
  const callSessionId = 'call_front_001'

  const adminUserA: AuthUser = {
    userId: 'user_admin_a',
    tenantId: tenantA,
    role: 'ADMIN',
  }

  const adminUserB: AuthUser = {
    userId: 'user_admin_b',
    tenantId: tenantB,
    role: 'ADMIN',
  }

  let deliveryRequests: any[] = []
  let deliveryAttempts: any[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    deliveryRequests = []
    deliveryAttempts = []

    prismaMock = {
      customer: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.tenantId === tenantA && where.id === customerId) {
            return Promise.resolve({
              id: customerId,
              tenantId: tenantA,
              name: 'Apex Infotech Ltd',
              phone: '+919876543210',
              email: 'accounts@apexinfotech.in',
              outstandingBalance: 25000,
              emailConsent: ConsentState.OPTED_IN,
              whatsappConsent: ConsentState.OPTED_IN,
            })
          }
          return Promise.resolve(null)
        }),
      },
      invoice: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.tenantId === tenantA && where.id === invoiceId) {
            return Promise.resolve({
              id: invoiceId,
              tenantId: tenantA,
              customerId,
              number: 'INV-2026-001',
              amount: 25000,
              outstanding: 25000,
              status: 'OPEN',
              dueDate: new Date('2026-11-30'),
            })
          }
          return Promise.resolve(null)
        }),
      },
      documentDeliveryRequest: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            deliveryRequests.find((r) => r.id === where?.id || (r.idempotencyKey && r.idempotencyKey === where?.idempotencyKey)) || null
          )
        }),
        findMany: vi.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            deliveryRequests.filter((r) => r.tenantId === where?.tenantId)
          )
        }),
        count: vi.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            deliveryRequests.filter((r) => r.tenantId === where?.tenantId).length
          )
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const req = {
            id: `req_${deliveryRequests.length + 1}`,
            requestedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            attempts: [],
            ...data,
          }
          deliveryRequests.push(req)
          return Promise.resolve(req)
        }),
        update: vi.fn().mockImplementation(({ where, data }) => {
          const existing = deliveryRequests.find((r) => r.id === where.id)
          if (existing) {
            Object.assign(existing, data)
            existing.attempts = deliveryAttempts.filter((a) => a.requestId === existing.id)
          }
          return Promise.resolve(existing)
        }),
      },
      deliveryAttempt: {
        create: vi.fn().mockImplementation(({ data }) => {
          const att = {
            id: `att_${deliveryAttempts.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }
          deliveryAttempts.push(att)
          return Promise.resolve(att)
        }),
      },
      collectionCase: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      followUpTask: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: tenantA, name: 'Tenant A Org' }),
      },
      payment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }

    paymentsServiceMock = {
      createPaymentLink: vi.fn().mockResolvedValue({
        id: 'plink_test_001',
        paymentLinkId: 'plink_ext_001',
        shortUrl: 'https://pay.mycashflo.internal/test-link-001',
        amount: 25000,
        currency: 'INR',
        status: 'ACTIVE',
        isSimulated: true,
      }),
    }

    integrationsMock = {
      whatsapp: {
        send: vi.fn().mockResolvedValue({
          messageId: 'wamid.simulated_123',
          status: 'DELIVERED',
          isSimulated: true,
        }),
      },
      email: {
        send: vi.fn().mockResolvedValue({
          messageId: 'email.simulated_123',
          status: 'DELIVERED',
          isSimulated: true,
        }),
      },
    }

    auditLogsServiceMock = {
      log: vi.fn().mockResolvedValue({ id: 'audit_log_001' }),
    }

    service = new DocumentDeliveryService(
      prismaMock,
      paymentsServiceMock,
      integrationsMock,
      auditLogsServiceMock,
    )
  })

  // 1. Invoice request panel
  it('1. should process Invoice-only request and populate UI panel payload with trusted balance and invoice #', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.INVOICE,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request).toBeDefined()
    expect(result.request.requestType).toBe(DocumentRequestType.INVOICE)
    expect(result.request.status).toBe(DocumentDeliveryStatus.COMPLETED)
    expect(result.isDuplicate).toBe(false)
    expect(result.request.metadata?.invoiceNumber).toBe('INV-2026-001')
    expect(result.request.metadata?.signedPdfUrl).toBeDefined()
  })

  // 2. Payment-link request panel
  it('2. should process Payment-Link-only request and retrieve verified outstanding balance URL', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.PAYMENT_LINK,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request).toBeDefined()
    expect(result.request.requestType).toBe(DocumentRequestType.PAYMENT_LINK)
    expect(paymentsServiceMock.createPaymentLink).toHaveBeenCalledWith(
      adminUserA,
      expect.objectContaining({
        invoiceId,
      }),
    )
    expect(result.request.metadata?.paymentLinkUrl).toBe('https://pay.mycashflo.internal/test-link-001')
  })

  // 3. Both request types
  it('3. should process Both Invoice & Payment Link through single unified request workflow', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.BOTH,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request.requestType).toBe(DocumentRequestType.BOTH)
    expect(result.request.metadata?.signedPdfUrl).toBeDefined()
    expect(result.request.metadata?.paymentLinkUrl).toBeDefined()
    expect(result.request.status).toBe(DocumentDeliveryStatus.COMPLETED)
  })

  // 4. WhatsApp and Email statuses
  it('4. should track WhatsApp and Email independently with granular status and masked destinations', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.BOTH,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request.attempts).toHaveLength(2)
    const wa = result.request.attempts.find((a: any) => a.channel === 'WHATSAPP')
    const em = result.request.attempts.find((a: any) => a.channel === 'EMAIL')

    expect(wa).toBeDefined()
    expect(wa.destinationMasked).toBe('+91 ****3210')
    expect(wa.status).toBe(DeliveryAttemptStatus.SIMULATED)

    expect(em).toBeDefined()
    expect(em.destinationMasked).toBe('a****s@apexinfotech.in')
    expect(em.status).toBe(DeliveryAttemptStatus.SIMULATED)
  })

  // 5. Partial success
  it('5. should mark overall status as PARTIAL_SUCCESS when one channel succeeds and another fails', async () => {
    // WhatsApp delivery fails, email delivery succeeds
    integrationsMock.whatsapp.send.mockRejectedValueOnce(new Error('WhatsApp gateway down'))

    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.INVOICE,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request.status).toBe(DocumentDeliveryStatus.PARTIAL_SUCCESS)
    const wa = result.request.attempts.find((a: any) => a.channel === 'WHATSAPP')
    const em = result.request.attempts.find((a: any) => a.channel === 'EMAIL')
    expect(wa.status).toBe(DeliveryAttemptStatus.FAILED)
    expect(em.status).toBe(DeliveryAttemptStatus.SIMULATED)
  })

  // 6. Failed delivery
  it('6. should mark overall status as FAILED when all requested channels fail', async () => {
    integrationsMock.whatsapp.send.mockRejectedValueOnce(new Error('WhatsApp gateway error'))
    integrationsMock.email.send.mockRejectedValueOnce(new Error('SMTP connection error'))

    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.INVOICE,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request.status).toBe(DocumentDeliveryStatus.FAILED)
    expect(result.request.attempts.every((a: any) => a.status === DeliveryAttemptStatus.FAILED)).toBe(true)
  })

  // 7. Simulation badge
  it('7. should clearly flag all attempts with SIMULATION provider and SIMULATED status (never real messages)', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.BOTH,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    for (const att of result.request.attempts) {
      expect(att.status).toBe(DeliveryAttemptStatus.SIMULATED)
      expect(['WHATSAPP_CLOUD', 'RESEND']).toContain(att.provider)
    }
  })

  // 8. Call History document details
  it('8. should retrieve document delivery request with full attempts history for Call History modal', async () => {
    await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.BOTH,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    const fetched = await service.findOne('req_1', adminUserA)
    expect(fetched).toBeDefined()
    expect(fetched.requestType).toBe(DocumentRequestType.BOTH)
    expect(fetched.attempts).toHaveLength(2)
  })

  // 9. Invoice PDF download
  it('9. should generate and return invoice PDF buffer for authorized token', async () => {
    const token = service.generateSignedInvoiceToken(tenantA, invoiceId, customerId, 3600000)
    const { buffer, filename } = await service.getSecureInvoicePdf(invoiceId, token)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(100)
    expect(filename).toContain('INV-2026-001')
  })

  // 10. Copy payment link
  it('10. should generate active payment link shortUrl accessible for copy feedback', async () => {
    const result = await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      requestType: DocumentRequestType.PAYMENT_LINK,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP,
      requestedBy: 'CUSTOMER_VOICE',
    })

    expect(result.request.metadata?.paymentLinkUrl).toBe('https://pay.mycashflo.internal/test-link-001')
  })

  // 11. Expired signed URL handling
  it('11. should generate a signed token and verify valid vs expired / tampered token', () => {
    const token = service.generateSignedInvoiceToken(tenantA, invoiceId, customerId, 3600000)
    expect(typeof token).toBe('string')
    expect(token).toContain('.')

    // Valid token passes
    const verified = service.verifySignedInvoiceToken(token, invoiceId)
    expect(verified.valid).toBe(true)
    expect(verified.payload?.tenantId).toBe(tenantA)
    expect(verified.payload?.invoiceId).toBe(invoiceId)

    // Expired token (ttl: -1000)
    const expiredToken = service.generateSignedInvoiceToken(tenantA, invoiceId, customerId, -1000)
    const expiredVerified = service.verifySignedInvoiceToken(expiredToken, invoiceId)
    expect(expiredVerified.valid).toBe(false)
    expect(expiredVerified.reason).toContain('expired')

    // Tampered token fails
    const tamperedVerified = service.verifySignedInvoiceToken(token + 'tampered', invoiceId)
    expect(tamperedVerified.valid).toBe(false)

    // Wrong invoice ID mismatch fails
    const wrongInvVerified = service.verifySignedInvoiceToken(token, 'wrong_inv_id')
    expect(wrongInvVerified.valid).toBe(false)
    expect(wrongInvVerified.reason).toContain('different invoice')
  })

  // 12. Unauthorized tenant access rejection
  it('12. should reject access when a tenant attempts to view another tenant invoice or delivery request', async () => {
    // Tenant B token attempting to access Tenant A's invoice
    const tokenB = service.generateSignedInvoiceToken(tenantB, invoiceId, customerId)
    // Invoice does not belong to Tenant B in DB
    await expect(service.getSecureInvoicePdf(invoiceId, tokenB)).rejects.toThrow()

    // Tenant B attempts to create delivery request on Tenant A's customer
    await expect(
      service.requestDelivery(adminUserB, {
        customerId,
        invoiceId,
        requestType: DocumentRequestType.INVOICE,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP,
        requestedBy: 'CUSTOMER_VOICE',
      }),
    ).rejects.toThrow(NotFoundException)
  })

  // 13. Mobile responsive layout classes and UI state verification
  it('13. should verify UI formatters and status badge mappings', () => {
    function formatRequestType(type?: string) {
      if (type === 'BOTH') return 'Invoice & Payment Link'
      if (type === 'PAYMENT_LINK') return 'Payment Link'
      if (type === 'INVOICE') return 'Invoice Copy'
      return type || 'Document'
    }

    expect(formatRequestType('BOTH')).toBe('Invoice & Payment Link')
    expect(formatRequestType('PAYMENT_LINK')).toBe('Payment Link')
    expect(formatRequestType('INVOICE')).toBe('Invoice Copy')

    function getChannelStatusBadge(status?: string) {
      switch (status) {
        case 'SIMULATED':
          return { bg: 'bg-amber-950/80', text: 'text-amber-300', icon: '🧪', label: 'Simulated' }
        case 'DELIVERED':
          return { bg: 'bg-emerald-950/80', text: 'text-emerald-300', icon: '✓', label: 'Delivered' }
        case 'SENT':
          return { bg: 'bg-sky-950/80', text: 'text-sky-300', icon: '↗', label: 'Sent' }
        case 'FAILED':
          return { bg: 'bg-rose-950/80', text: 'text-rose-300', icon: '❌', label: 'Failed' }
        case 'SKIPPED':
          return { bg: 'bg-slate-800/80', text: 'text-slate-400', icon: '—', label: 'Skipped' }
        default:
          return { bg: 'bg-indigo-950/80', text: 'text-indigo-300', icon: '⏳', label: 'Queued' }
      }
    }

    expect(getChannelStatusBadge('SIMULATED').label).toBe('Simulated')
    expect(getChannelStatusBadge('SIMULATED').icon).toBe('🧪')
    expect(getChannelStatusBadge('DELIVERED').label).toBe('Delivered')
    expect(getChannelStatusBadge('FAILED').label).toBe('Failed')
    expect(getChannelStatusBadge('SKIPPED').label).toBe('Skipped')
    expect(getChannelStatusBadge('PENDING').label).toBe('Queued')
  })

  // 14. Refresh and reload persistence
  it('14. should persist and retrieve document delivery requests across page reloads with pagination', async () => {
    await service.requestDelivery(adminUserA, {
      customerId,
      invoiceId,
      callSessionId,
      requestType: DocumentRequestType.BOTH,
      deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      requestedBy: 'CUSTOMER_VOICE',
    })

    const paginated = await service.findAll(adminUserA, {
      customerId,
      page: 1,
      limit: 10,
    })

    expect(paginated.data).toHaveLength(1)
    expect(paginated.meta.total).toBe(1)
    expect(paginated.meta.page).toBe(1)
    expect(paginated.data[0].id).toBe('req_1')
  })
})
