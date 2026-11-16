import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceService } from './voice.service.js';
import {
  DocumentDeliveryService,
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
} from './document-delivery.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('Phase C: Chotu AI Conversational Document Delivery Integration', () => {
  let voiceService: VoiceService;
  let mockDocDeliveryService: any;
  let mockPrisma: any;
  let mockConfig: any;

  let customers: any[];
  let invoices: any[];
  let callSessions: any[];
  let paymentPromises: any[];

  const mockUser: AuthUser = {
    userId: 'user_agent_1',
    tenantId: 'tenant_democorp',
    role: 'AGENT',
  };

  beforeEach(() => {
    customers = [
      {
        id: 'cust_abc',
        tenantId: 'tenant_democorp',
        name: 'ABC Tech',
        company: 'ABC Technologies Pvt Ltd',
        phone: '+919876543210',
        email: 'finance@abctech.com',
        outstandingBalance: 25000,
      },
    ];

    invoices = [
      {
        id: 'inv_abc_01',
        number: 'INV-2026-ABC',
        customerId: 'cust_abc',
        tenantId: 'tenant_democorp',
        amount: 25000,
        outstanding: 25000,
        status: 'OVERDUE',
        dueDate: new Date(Date.now() - 10 * 86400000),
      },
    ];

    callSessions = [];
    paymentPromises = [];

    mockPrisma = {
      customer: {
        findFirst: vi.fn(async ({ where }: any) => {
          return customers.find(
            (c) =>
              c.tenantId === where.tenantId &&
              (c.id === where.id || c.phone === where.phone),
          ) || null;
        }),
      },
      invoice: {
        findFirst: vi.fn(async ({ where }: any) => {
          return invoices.find(
            (inv) =>
              inv.tenantId === where.tenantId &&
              (inv.id === where.id ||
                inv.number === where.number ||
                inv.customerId === where.customerId),
          ) || null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return invoices.filter(
            (inv) =>
              inv.tenantId === where.tenantId &&
              (where.customerId ? inv.customerId === where.customerId : true) &&
              (where.status?.in ? where.status.in.includes(inv.status) : true),
          );
        }),
      },
      callSession: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (args: any) => {
          const session = { id: `sess_${Date.now()}`, ...args.data };
          callSessions.push(session);
          return session;
        }),
        update: vi.fn(async (args: any) => args.data),
      },
      paymentPromise: {
        create: vi.fn(async (args: any) => {
          const promise = { id: `prom_${Date.now()}`, ...args.data };
          paymentPromises.push(promise);
          return promise;
        }),
      },
      promptTemplate: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    };

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'LIVEKIT_API_KEY') return 'mock_key';
        if (key === 'LIVEKIT_API_SECRET') return 'mock_secret';
        return null;
      }),
    };

    mockDocDeliveryService = {
      requestDelivery: vi.fn(async (user: AuthUser, dto: any) => {
        return {
          request: {
            id: `req_mock_${Date.now()}`,
            tenantId: user.tenantId,
            customerId: dto.customerId,
            invoiceId: dto.invoiceId,
            requestType: dto.requestType,
            deliveryChannel: dto.deliveryChannel,
            status: DocumentDeliveryStatus.COMPLETED,
            attempts: [
              {
                channel: 'WHATSAPP',
                destinationMasked: '+91 ****3210',
                status: 'SIMULATED',
              },
              {
                channel: 'EMAIL',
                destinationMasked: 'f****@abctech.com',
                status: 'SIMULATED',
              },
            ],
          },
          isDuplicate: false,
        };
      }),
      cancelDelivery: vi.fn(async (_user: AuthUser, id: string) => {
        return {
          id,
          status: DocumentDeliveryStatus.CANCELLED,
        };
      }),
    };

    voiceService = new VoiceService(
      mockConfig,
      mockPrisma,
      undefined,
      mockDocDeliveryService,
    );
  });

  // ── Scenario 1: "Send me the invoice." ─────────────────────────────────────
  it('Scenario 1: Customer says "Send me the invoice" -> dispatches invoice PDF via WhatsApp & Email in simulation mode', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Can you please send me the invoice?',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        customerId: 'cust_abc',
        invoiceId: 'inv_abc_01',
        requestType: DocumentRequestType.INVOICE,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      }),
    );

    expect(turn.actionExecuted).toBe('DOCUMENT_DELIVERY_DISPATCHED');
    expect(turn.outcome).toBe('IN_PROGRESS');
    expect(turn.shouldEnd).toBe(false);
    expect(turn.reply).toMatch(/invoice PDF for invoice #INV-2026-ABC/i);
    expect(turn.reply).toMatch(/WhatsApp/i);
    expect(turn.reply).toMatch(/simulation mode/i);
    expect(turn.extractedData.documentDelivery?.status).toBe(DocumentDeliveryStatus.COMPLETED);
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
  });

  // ── Scenario 2: "Send me the payment link." ─────────────────────────────────
  it('Scenario 2: Customer says "Send me the payment link" -> dispatches payment link without recording payment promise', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the payment link on my phone',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        customerId: 'cust_abc',
        invoiceId: 'inv_abc_01',
        requestType: DocumentRequestType.PAYMENT_LINK,
      }),
    );

    expect(turn.actionExecuted).toBe('DOCUMENT_DELIVERY_DISPATCHED');
    expect(turn.outcome).toBe('IN_PROGRESS');
    expect(turn.shouldEnd).toBe(false);
    expect(turn.reply).toMatch(/instant payment link for invoice #INV-2026-ABC/i);
    expect(mockPrisma.paymentPromise.create).not.toHaveBeenCalled();
    expect(turn.extractedData.commitmentStatus).toBe('NONE');
  });

  // ── Scenario 3: "Send me both." ───────────────────────────────────────────
  it('Scenario 3: Customer says "Send me both" -> dispatches BOTH through unified request', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Please send both the invoice and payment link',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        requestType: DocumentRequestType.BOTH,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
      }),
    );

    expect(turn.reply).toMatch(/both invoice #INV-2026-ABC and the instant payment link/i);
    expect(turn.extractedData.documentDelivery?.requestType).toBe(DocumentRequestType.BOTH);
  });

  // ── Scenario 4: "Send it only on WhatsApp." ───────────────────────────────
  it('Scenario 4: Customer says "Send it only on WhatsApp" -> channels strictly to WHATSAPP', async () => {
    mockDocDeliveryService.requestDelivery.mockResolvedValueOnce({
      request: {
        id: 'req_wa_only',
        status: DocumentDeliveryStatus.COMPLETED,
        requestType: DocumentRequestType.INVOICE,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP,
        attempts: [
          { channel: 'WHATSAPP', destinationMasked: '+91 ****3210', status: 'SIMULATED' },
        ],
      },
      isDuplicate: false,
    });

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send the invoice only on WhatsApp please',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        deliveryChannel: DeliveryChannelPreference.WHATSAPP,
      }),
    );

    expect(turn.reply).toMatch(/WhatsApp/i);
    expect(turn.reply).not.toMatch(/and emailed a copy/i);
    expect(turn.extractedData.documentDelivery?.deliveryChannel).toBe(DeliveryChannelPreference.WHATSAPP);
  });

  // ── Scenario 5: "Email me the invoice." ───────────────────────────────────
  it('Scenario 5: Customer says "Email me the invoice" -> channels strictly to EMAIL', async () => {
    mockDocDeliveryService.requestDelivery.mockResolvedValueOnce({
      request: {
        id: 'req_email_only',
        status: DocumentDeliveryStatus.COMPLETED,
        requestType: DocumentRequestType.INVOICE,
        deliveryChannel: DeliveryChannelPreference.EMAIL,
        attempts: [
          { channel: 'EMAIL', destinationMasked: 'f****@abctech.com', status: 'SIMULATED' },
        ],
      },
      isDuplicate: false,
    });

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Email me the invoice copy',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        deliveryChannel: DeliveryChannelPreference.EMAIL,
      }),
    );

    expect(turn.reply).toMatch(/emailed the invoice PDF/i);
    expect(turn.reply).not.toMatch(/WhatsApp/i);
    expect(turn.extractedData.documentDelivery?.deliveryChannel).toBe(DeliveryChannelPreference.EMAIL);
  });

  // ── Scenario 6: Multiple outstanding invoices ─────────────────────────────
  it('Scenario 6: Multiple outstanding invoices -> asks which invoice, then dispatches on customer selection', async () => {
    invoices.push({
      id: 'inv_abc_02',
      number: 'INV-2026-XYZ',
      customerId: 'cust_abc',
      tenantId: 'tenant_democorp',
      amount: 15000,
      outstanding: 15000,
      status: 'OPEN',
      dueDate: new Date(Date.now() - 5 * 86400000),
    });

    // Turn 1: Customer asks for invoice without specifying number
    const turn1 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the invoice',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn1.actionExecuted).toBe('AWAITING_INVOICE_SELECTION');
    expect(turn1.reply).toMatch(/2 outstanding invoices/i);
    expect(turn1.reply).toContain('INV-2026-ABC');
    expect(turn1.reply).toContain('INV-2026-XYZ');
    expect(turn1.extractedData.awaitingInvoiceSelection).toBe(true);
    expect(mockDocDeliveryService.requestDelivery).not.toHaveBeenCalled();

    // Turn 2: Customer specifies the first invoice
    const turn2 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Please send invoice INV-2026-ABC',
      currentStage: turn1.nextStage,
      extractedData: turn1.extractedData,
    });

    expect(turn2.actionExecuted).toBe('DOCUMENT_DELIVERY_DISPATCHED');
    expect(mockDocDeliveryService.requestDelivery).toHaveBeenCalledWith(
      mockUser,
      expect.objectContaining({
        invoiceId: 'inv_abc_01',
      }),
    );
    expect(turn2.reply).toContain('INV-2026-ABC');
  });

  // ── Scenario 7: No valid invoice located ──────────────────────────────────
  it('Scenario 7: No valid invoice located -> explains no invoice found, does not invent numbers', async () => {
    invoices = []; // Clear all invoices

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the invoice right now',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).not.toHaveBeenCalled();
    expect(turn.reply).toMatch(/could not locate an active invoice/i);
    expect(turn.reply).toMatch(/billing desk/i);
    expect(turn.outcome).toBe('IN_PROGRESS');
  });

  // ── Scenario 8: Already-paid invoice ──────────────────────────────────────
  it('Scenario 8: Already-paid invoice -> informs paid, offers receipt, does not send payment link', async () => {
    invoices[0].status = 'PAID';
    invoices[0].outstanding = 0;

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the payment link for invoice INV-2026-ABC',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(mockDocDeliveryService.requestDelivery).not.toHaveBeenCalled();
    expect(turn.reply).toMatch(/already (?:been )?paid in full/i);
    expect(turn.reply).toMatch(/receipt copy/i);
    expect(turn.shouldEnd).toBe(false);
  });

  // ── Scenario 9: Customer cancels the request ──────────────────────────────
  it('Scenario 9: Customer cancels document request -> cancels delivery and records CANCELLED', async () => {
    // Deliver first
    const turn1 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the payment link',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn1.extractedData.lastDocumentDeliveryId).toBeTruthy();

    // Customer cancels
    const turn2 = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Actually cancel that document request, do not send it',
      currentStage: turn1.nextStage,
      extractedData: turn1.extractedData,
    });

    expect(mockDocDeliveryService.cancelDelivery).toHaveBeenCalledWith(
      mockUser,
      turn1.extractedData.lastDocumentDeliveryId,
    );
    expect(turn2.actionExecuted).toBe('DOCUMENT_DELIVERY_CANCELLED');
    expect(turn2.reply).toMatch(/cancelled the document delivery request/i);
    expect(turn2.extractedData.documentDelivery?.status).toBe(DocumentDeliveryStatus.CANCELLED);
  });

  // ── Scenario 10: Partial success (WhatsApp succeeds, Email fails) ─────────
  it('Scenario 10: WhatsApp succeeds but Email fails -> reports partial success with specific channel details', async () => {
    mockDocDeliveryService.requestDelivery.mockResolvedValueOnce({
      request: {
        id: 'req_partial_1',
        status: DocumentDeliveryStatus.PARTIAL_SUCCESS,
        requestType: DocumentRequestType.BOTH,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
        attempts: [
          {
            channel: 'WHATSAPP',
            destinationMasked: '+91 ****3210',
            status: 'SENT',
          },
          {
            channel: 'EMAIL',
            destinationMasked: 'no-email',
            status: 'FAILED',
            errorMessage: 'Customer has no registered email address on file',
          },
        ],
      },
      isDuplicate: false,
    });

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Please send both the invoice and link',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.reply).toMatch(/successfully sent invoice #INV-2026-ABC and payment link to your WhatsApp/i);
    expect(turn.reply).toMatch(/email delivery could not be completed/i);
    expect(turn.extractedData.documentDelivery?.status).toBe(DocumentDeliveryStatus.PARTIAL_SUCCESS);
  });

  // ── Scenario 11: Both channels are simulated ──────────────────────────────
  it('Scenario 11: Both channels simulated -> explicitly confirms simulation dispatch', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Please send me the invoice copy',
      currentStage: 'CONFIRM_BALANCE',
    });

    expect(turn.reply).toContain('in simulation mode');
    expect(turn.extractedData.documentDelivery?.attempts.every((a: any) => a.status === 'SIMULATED')).toBe(true);
  });

  // ── Scenario 12: Duplicate request during the same call ────────────────────
  it('Scenario 12: Duplicate request during the same call -> detects duplicate and asks before resending', async () => {
    mockDocDeliveryService.requestDelivery.mockResolvedValueOnce({
      request: {
        id: 'req_dup_1',
        status: DocumentDeliveryStatus.COMPLETED,
        requestType: DocumentRequestType.INVOICE,
        deliveryChannel: DeliveryChannelPreference.WHATSAPP_AND_EMAIL,
        attempts: [],
      },
      isDuplicate: true,
    });

    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Can you send me the invoice again?',
      currentStage: 'ASK_FULL_PAYMENT',
    });

    expect(turn.actionExecuted).toBe('DOCUMENT_DELIVERY_DUPLICATE_CHECKED');
    expect(turn.reply).toMatch(/already sent invoice #INV-2026-ABC.*during this call/i);
    expect(turn.reply).toMatch(/resend an additional copy\?/i);
  });

  // ── Scenario 13: Payment link request without promise -> Structured summary reflects NONE ───
  it('Scenario 13: Customer requests payment link without promise -> summary reflects paymentCommitment NONE and records documentDelivery', async () => {
    const turn = await voiceService.processTurn(mockUser, {
      customerId: 'cust_abc',
      userSpeech: 'Send me the payment link',
      currentStage: 'CONFIRM_BALANCE',
    });

    const summary = voiceService.generateStructuredCallSummary({
      customerName: 'ABC Tech',
      customerId: 'cust_abc',
      invoiceNumber: 'INV-2026-ABC',
      durationSeconds: 45,
      callType: 'COLLECTIONS',
      conversationContext: turn.extractedData,
      transcript: [
        { speaker: 'agent', text: 'Hello from Chotu.' },
        { speaker: 'customer', text: 'Send me the payment link' },
        { speaker: 'agent', text: turn.reply },
      ],
    });

    expect(summary.paymentCommitment).toBe('NONE');
    expect(summary.commitmentAmount).toBeNull();
    expect(summary.documentDelivery).toBeDefined();
    expect(summary.documentDelivery?.requestType).toBe(DocumentRequestType.PAYMENT_LINK);
    expect(summary.documentDelivery?.invoiceNumber).toBe('INV-2026-ABC');
    expect(summary.customerMainResponse).toMatch(/Requested payment link/i);
    expect(summary.nextAction).toMatch(/Verify customer receipt of payment link/i);
    expect(summary.shortSummary).toMatch(/Document Request: Dispatched PAYMENT_LINK/i);
  });
});
