import { describe, it, expect } from 'vitest';
import type {
  Invoice,
  Payment,
  PaymentMethod,
  PaymentStatus,
  PaymentLinkResponse,
  CallType,
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
  DeliveryAttempt,
  DocumentDeliveryRequest,
  CreateDocumentDeliveryDto,
  DocumentDeliveryResponse,
  StructuredCallSummary,
} from '../../../../packages/shared-types/index.js';

describe('Shared Types Contract Verification', () => {
  it('should validate DocumentDeliveryRequest and DeliveryAttempt contract structures', () => {
    const attempt: DeliveryAttempt = {
      id: 'att_123',
      tenantId: 'tenant_test',
      requestId: 'req_123',
      channel: 'WHATSAPP' as DeliveryAttemptChannel,
      destinationMasked: '+91 ****3210',
      status: 'SIMULATED' as DeliveryAttemptStatus,
      provider: 'WHATSAPP_SIMULATOR',
      providerMessageId: 'sim_msg_001',
      errorCode: null,
      errorMessage: null,
      sentAt: '2026-11-08T10:00:00Z',
      deliveredAt: '2026-11-08T10:00:01Z',
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-08T10:00:01Z',
    };

    const docRequest: DocumentDeliveryRequest = {
      id: 'req_123',
      tenantId: 'tenant_test',
      customerId: 'cust_123',
      invoiceId: 'inv_123',
      callSessionId: 'sess_123',
      requestType: 'BOTH' as DocumentRequestType,
      deliveryChannel: 'WHATSAPP_AND_EMAIL' as DeliveryChannelPreference,
      status: 'COMPLETED' as DocumentDeliveryStatus,
      requestedBy: 'CHOTU_AI_VOICE',
      idempotencyKey: 'idem_key_123',
      metadata: { source: 'unit_test' },
      requestedAt: '2026-11-08T10:00:00Z',
      createdAt: '2026-11-08T10:00:00Z',
      updatedAt: '2026-11-08T10:00:01Z',
      customer: {
        id: 'cust_123',
        name: 'Sharma Industries',
        phone: '+919876543210',
        email: 'sharma@example.com',
      },
      invoice: {
        id: 'inv_123',
        number: 'INV-2026-001',
        amount: 85000,
        outstanding: 85000,
        status: 'OVERDUE',
      },
      attempts: [attempt],
    };

    expect(docRequest.id).toBe('req_123');
    expect(docRequest.requestType).toBe('BOTH');
    expect(docRequest.deliveryChannel).toBe('WHATSAPP_AND_EMAIL');
    expect(docRequest.attempts?.[0].channel).toBe('WHATSAPP');
    expect(docRequest.attempts?.[0].status).toBe('SIMULATED');
  });

  it('should validate Invoice contract with customer relation and optional customerName', () => {
    const invoice: Invoice = {
      id: 'inv_456',
      number: 'INV-2026-002',
      customerId: 'cust_456',
      customer: { id: 'cust_456', name: 'Mehta Textiles' },
      amount: 120000,
      outstanding: 60000,
      currency: 'INR',
      status: 'PARTIALLY_PAID',
      issueDate: '2026-10-01T00:00:00Z',
      dueDate: '2026-10-15T00:00:00Z',
      tenantId: 'tenant_test',
      description: 'Q3 Textile Raw Materials',
    };

    expect(invoice.number).toBe('INV-2026-002');
    expect(invoice.customer?.name).toBe('Mehta Textiles');
    expect(invoice.outstanding).toBe(60000);
  });

  it('should validate Payment contract and method/status enums', () => {
    const payment: Payment = {
      id: 'pay_789',
      ref: 'PAY-REF-001',
      customerId: 'cust_456',
      customer: { id: 'cust_456', name: 'Mehta Textiles' },
      invoiceId: 'inv_456',
      invoice: { id: 'inv_456', number: 'INV-2026-002' },
      amount: 60000,
      currency: 'INR',
      method: 'BANK_TRANSFER' as PaymentMethod,
      status: 'COMPLETED' as PaymentStatus,
      paidAt: '2026-10-20T14:30:00Z',
      notes: 'NEFT transfer ref 987654321',
      tenantId: 'tenant_test',
      createdAt: '2026-10-20T14:30:00Z',
    };

    expect(payment.ref).toBe('PAY-REF-001');
    expect(payment.method).toBe('BANK_TRANSFER');
    expect(payment.status).toBe('COMPLETED');
  });

  it('should validate PaymentLinkResponse contract', () => {
    const linkRes: PaymentLinkResponse = {
      paymentLinkId: 'plink_123',
      paymentId: 'pay_123',
      provider: 'RAZORPAY',
      shortUrl: 'https://rzp.io/i/test_link',
      amount: 85000,
      currency: 'INR',
      status: 'created',
      invoiceId: 'inv_123',
      invoiceNumber: 'INV-2026-001',
      isSimulated: true,
    };

    expect(linkRes.paymentLinkId).toBe('plink_123');
    expect(linkRes.provider).toBe('RAZORPAY');
    expect(linkRes.isSimulated).toBe(true);
  });

  it('should validate StructuredCallSummary documentDelivery integration', () => {
    const summary: StructuredCallSummary = {
      customerName: 'Sharma Industries',
      customerId: 'cust_123',
      invoiceNumber: 'INV-2026-001',
      callDateTime: '2026-11-08T10:00:00Z',
      durationSeconds: 120,
      formattedDuration: '2m 0s',
      callType: 'COLLECTIONS' as CallType,
      reasonForCall: 'Pending invoice INV-2026-001 payment reminder',
      customerMainResponse: 'Customer requested invoice copy and agreed to pay next Friday.',
      outcomeCategory: 'PROMISE_TO_PAY',
      paymentCommitment: 'CONFIRMED',
      commitmentAmount: '85000',
      commitmentDate: '2026-11-14',
      paymentMethod: 'UPI',
      customerReportedPayment: null,
      disputeDetails: null,
      callbackRequest: null,
      humanHandoffRequested: false,
      noContactStatus: null,
      nextAction: 'Follow up on promised date',
      shortSummary: 'Sharma Industries confirmed payment of Rs. 85,000 on 2026-11-14 via UPI.',
      documentDelivery: {
        requestType: 'BOTH',
        invoiceNumber: 'INV-2026-001',
        deliveryChannel: 'WHATSAPP_AND_EMAIL',
        status: 'COMPLETED',
        requestedAt: '2026-11-08T10:01:00Z',
        paymentLinkUrl: 'https://rzp.io/i/test_link',
        attempts: [
          {
            channel: 'WHATSAPP',
            destinationMasked: '+91 ****3210',
            status: 'SIMULATED',
            errorMessage: null,
            provider: 'WHATSAPP_SIMULATOR',
            sentAt: '2026-11-08T10:01:05Z',
            deliveredAt: '2026-11-08T10:01:06Z',
          },
        ],
      },
    };

    expect(summary.documentDelivery?.requestType).toBe('BOTH');
    expect(summary.documentDelivery?.status).toBe('COMPLETED');
    expect(summary.documentDelivery?.attempts?.[0].status).toBe('SIMULATED');
  });
});

