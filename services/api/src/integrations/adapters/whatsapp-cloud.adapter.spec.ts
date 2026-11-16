import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import {
  WhatsAppCloudAdapter,
  APPROVED_WHATSAPP_TEMPLATES,
  validateCompanyContactNumber,
} from './whatsapp-cloud.adapter.js';

describe('WhatsAppCloudAdapter', () => {
  let adapter: WhatsAppCloudAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new WhatsAppCloudAdapter();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Approved Template Payload Generation & Parameter Ordering
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Approved Template Payload Generation & Ordering', () => {
    it('generates exact Meta payload for PAYMENT_REMINDER_OVERDUE with correct 6 parameters matching Meta schema', () => {
      const payload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Acme Enterprises',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Overdue invoice notice',
          payload: {
            customerName: 'Acme Enterprises',
            companyName: 'myCashflo Finance',
            invoiceNumber: 'INV-2026-001',
            amount: 85000,
            dueDate: '2026-09-13T00:00:00.000Z',
            companyContactNumber: '+919876543210',
          },
        },
        '919618954429',
      );

      expect(payload.messaging_product).toBe('whatsapp');
      expect(payload.recipient_type).toBe('individual');
      expect(payload.to).toBe('919618954429');
      expect(payload.type).toBe('template');
      expect(payload.template.name).toBe('payment_reminder_overdue');
      expect(payload.template.language.code).toBe('en');

      const bodyComp = payload.template.components.find((c: any) => c.type === 'body');
      expect(bodyComp).toBeDefined();
      expect(bodyComp.parameters).toHaveLength(6);

      // Exact ordered variable verification matching approved Meta template:
      // {{1}}: customerName
      expect(bodyComp.parameters[0]).toEqual({ type: 'text', text: 'Acme Enterprises' });
      // {{2}}: companyName
      expect(bodyComp.parameters[1]).toEqual({ type: 'text', text: 'myCashflo Finance' });
      // {{3}}: invoiceNumber
      expect(bodyComp.parameters[2]).toEqual({ type: 'text', text: 'INV-2026-001' });
      // {{4}}: formatted amount
      expect(bodyComp.parameters[3]).toEqual({ type: 'text', text: '₹85,000' });
      // {{5}}: formatted dueDate
      expect(bodyComp.parameters[4].text).toMatch(/13/);
      // {{6}}: companyContactNumber
      expect(bodyComp.parameters[5]).toEqual({ type: 'text', text: '+919876543210' });

      // No button on approved template
      const buttonComp = payload.template.components.find((c: any) => c.type === 'button');
      expect(buttonComp).toBeUndefined();
    });

    it('generates exact Meta payload for PAYMENT_REMINDER_UPCOMING with correct 5 parameters matching Meta schema', () => {
      const payload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Sharma Traders',
          template: 'PAYMENT_REMINDER_UPCOMING',
          message: 'Upcoming invoice notice',
          payload: {
            customerName: 'Sharma Traders',
            companyName: 'Demo Corp Pvt Ltd',
            invoiceNumber: 'INV-2026-002',
            amount: 25000,
            dueDate: '2026-10-30T00:00:00.000Z',
          },
        },
        '919618954429',
      );

      expect(payload.template.name).toBe('payment_reminder_upcoming');
      expect(payload.template.language.code).toBe('en_US');

      const bodyComp = payload.template.components.find((c: any) => c.type === 'body');
      expect(bodyComp).toBeDefined();
      expect(bodyComp.parameters).toHaveLength(5);

      // Order: customerName, companyName, invoiceNumber, amount, dueDate
      expect(bodyComp.parameters[0].text).toBe('Sharma Traders');
      expect(bodyComp.parameters[1].text).toBe('Demo Corp Pvt Ltd');
      expect(bodyComp.parameters[2].text).toBe('INV-2026-002');
      expect(bodyComp.parameters[3].text).toBe('₹25,000');
      expect(bodyComp.parameters[4].text).toMatch(/30/);

      // No button on approved template
      const buttonComp = payload.template.components.find((c: any) => c.type === 'button');
      expect(buttonComp).toBeUndefined();
    });

    it('generates exact Meta payload for PTP_CONFIRMATION', () => {
      const payload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Patel Logistics',
          template: 'PTP_CONFIRMATION',
          message: 'Promise to pay confirmed',
          payload: {
            customerName: 'Patel Logistics',
            promisedAmount: 50000,
            promisedDate: '2026-11-05T00:00:00.000Z',
            companyName: 'myCashflo Finance',
          },
        },
        '919618954429',
      );

      expect(payload.template.name).toBe('ptp_confirmation');
      const bodyComp = payload.template.components.find((c: any) => c.type === 'body');
      expect(bodyComp.parameters).toHaveLength(4);
      expect(bodyComp.parameters[0].text).toBe('Patel Logistics');
      expect(bodyComp.parameters[1].text).toBe('50000');
      expect(bodyComp.parameters[2].text).toMatch(/5/);
      expect(bodyComp.parameters[3].text).toBe('myCashflo Finance');
    });

    it('generates exact Meta payload for DISPUTE_ACKNOWLEDGMENT', () => {
      const payload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Verma Solutions',
          template: 'DISPUTE_ACKNOWLEDGMENT',
          message: 'Dispute recorded',
          payload: {
            customerName: 'Verma Solutions',
            invoiceNumber: 'INV-2026-009',
            reason: 'Goods received in damaged condition',
            companyName: 'myCashflo Logistics',
          },
        },
        '919618954429',
      );

      expect(payload.template.name).toBe('dispute_acknowledgment');
      const bodyComp = payload.template.components.find((c: any) => c.type === 'body');
      expect(bodyComp.parameters).toHaveLength(4);
      expect(bodyComp.parameters[0].text).toBe('Verma Solutions');
      expect(bodyComp.parameters[1].text).toBe('INV-2026-009');
      expect(bodyComp.parameters[2].text).toBe('Goods received in damaged condition');
      expect(bodyComp.parameters[3].text).toBe('myCashflo Logistics');
    });

    it('supports optional text and document header parameters', () => {
      const textHeaderPayload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Acme Corp',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Overdue notice',
          payload: {
            headerText: 'URGENT NOTICE',
            customerName: 'Acme Corp',
            invoiceNumber: 'INV-001',
            amount: '₹10,000',
            dueDate: '10/10/2026',
            daysOverdue: 5,
            companyName: 'Finance Co',
          },
        },
        '919618954429',
      );

      const textHeaderComp = textHeaderPayload.template.components.find((c: any) => c.type === 'header');
      expect(textHeaderComp).toBeDefined();
      expect(textHeaderComp.parameters[0]).toEqual({ type: 'text', text: 'URGENT NOTICE' });

      const docHeaderPayload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Acme Corp',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Overdue notice',
          payload: {
            headerDocumentUrl: 'https://cdn.mycashflo.internal/invoices/inv-001.pdf',
            headerDocumentName: 'Statement.pdf',
            customerName: 'Acme Corp',
            invoiceNumber: 'INV-001',
            amount: '₹10,000',
            dueDate: '10/10/2026',
            daysOverdue: 5,
            companyName: 'Finance Co',
          },
        },
        '919618954429',
      );

      const docHeaderComp = docHeaderPayload.template.components.find((c: any) => c.type === 'header');
      expect(docHeaderComp).toBeDefined();
      expect(docHeaderComp.parameters[0]).toEqual({
        type: 'document',
        document: {
          link: 'https://cdn.mycashflo.internal/invoices/inv-001.pdf',
          filename: 'Statement.pdf',
        },
      });
    });

    it('preserves pre-specified explicit parameters array if caller supplies bodyParameters', () => {
      const payload = adapter.buildTemplatePayload(
        {
          to: '+919618954429',
          recipientName: 'Custom Recipient',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Custom reminder',
          payload: {
            bodyParameters: ['Param1', 'Param2', 'Param3'],
          },
        },
        '919618954429',
      );

      const bodyComp = payload.template.components.find((c: any) => c.type === 'body');
      expect(bodyComp.parameters).toEqual([
        { type: 'text', text: 'Param1' },
        { type: 'text', text: 'Param2' },
        { type: 'text', text: 'Param3' },
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Safe Formatting & Malformed Data Handling
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Safe Formatting & Malformed Data Handling', () => {
    it('safely handles missing or undefined customerName by falling back to recipientName or default', () => {
      const val1 = adapter.formatVariableValue('customerName', undefined, {
        to: '+919618954429',
        recipientName: 'Fallback Name',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'test',
      });
      expect(val1).toBe('Fallback Name');

      const val2 = adapter.formatVariableValue('customerName', null, {
        to: '+919618954429',
        recipientName: '',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'test',
      });
      expect(val2).toBe('Valued Customer');
    });

    it('safely handles missing or malformed invoice amounts', () => {
      const zeroVal = adapter.formatVariableValue('amount', null, {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(zeroVal).toBe('₹0');

      const numericVal = adapter.formatVariableValue('amount', 45000.5, {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(numericVal).toBe('₹45,000.5');

      const stringVal = adapter.formatVariableValue('amount', '₹99,000', {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(stringVal).toBe('₹99,000');
    });

    it('safely formats Date objects and ISO date strings without throwing', () => {
      const dateObj = new Date('2026-10-15T00:00:00.000Z');
      const formatted = adapter.formatVariableValue('dueDate', dateObj, {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(formatted).toMatch(/15/);

      const nullDate = adapter.formatVariableValue('dueDate', undefined, {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(nullDate).toBe('immediate');
    });

    it('sanitizes tab and newline injection attempts from variable values', () => {
      const dirtyText = 'Line 1\nLine 2\r\nLine 3\tTabbed';
      const clean = adapter.formatVariableValue('companyName', dirtyText, {
        to: '+919618954429',
        recipientName: 'Test',
        template: 'TEST',
        message: 'test',
      });
      expect(clean).toBe('Line 1 Line 2 Line 3 Tabbed');
      expect(clean).not.toContain('\n');
      expect(clean).not.toContain('\t');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Safety Guard & Recipient Protection
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Safety Guard & Recipient Protection', () => {
    it('operates in safe simulation mode when credentials are not configured', async () => {
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      const result = await adapter.send({
        to: '+919618954429',
        recipientName: 'Demo Customer',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Simulated reminder',
      });

      expect(result.status).toBe('DELIVERED');
      expect(result.isSimulated).toBe(true);
      expect(result.provider).toBe('WHATSAPP_CLOUD');
      expect(result.messageId).toMatch(/^wamid\./);
    });

    it('strictly intercepts real customer numbers in non-production even if live credentials are set', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_test_live_token_12345';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      const fetchSpy = vi.spyOn(global, 'fetch');

      const blockedResult = await adapter.send(
        {
          to: '+919999900001', // Real synthetic customer number not matching testRecipient
          recipientName: 'Real Customer Inc',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Overdue balance',
        },
        {
          testRecipient: '919618954429',
        },
      );

      expect(blockedResult.isSimulated).toBe(true);
      expect(blockedResult.raw?.safetyGuard).toBe(true);
      expect(blockedResult.raw?.reason).toContain('Real customer phone suppressed');
      // Must NEVER call external Meta Graph API for non-allowlisted recipient
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('masks phone numbers in logged safety messages to prevent PII exposure', () => {
      const loggerSpy = vi.spyOn((adapter as any).logger, 'warn');
      (adapter as any).maskPhone('+919618954429');

      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_test_live_token_12345';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      return adapter
        .send({
          to: '+919876543210',
          recipientName: 'Customer',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Notice',
        })
        .then(() => {
          expect(loggerSpy).toHaveBeenCalled();
          const logCall = loggerSpy.mock.calls.find((call) =>
            call[0].includes('[SAFETY GUARD]'),
          );
          expect(logCall).toBeDefined();
          // Unmasked cleartext number must not appear in the log
          expect(logCall![0]).not.toContain('9876543210');
          expect(logCall![0]).toContain('****');
        });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Webhook Handshake, Signature Verification & Status Progression
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Webhook Verification & Status Progression', () => {
    it('verifies Meta challenge handshake with matching verifyToken', () => {
      const challenge = 'meta_hub_challenge_abcdef123';
      const verified = adapter.verifyWebhookChallenge(
        'subscribe',
        'mycashflo_whatsapp_verify_token',
        challenge,
        'mycashflo_whatsapp_verify_token',
      );
      expect(verified).toBe(challenge);

      const rejected = adapter.verifyWebhookChallenge(
        'subscribe',
        'invalid_token_456',
        challenge,
        'mycashflo_whatsapp_verify_token',
      );
      expect(rejected).toBeNull();
    });

    it('verifies webhook HMAC SHA-256 signature and rejects forged payload', () => {
      const appSecret = 'meta_app_secret_test_secret_789';
      const payload = { entry: [{ id: '123' }] };
      const rawBody = JSON.stringify(payload);
      const expectedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

      const isValid = adapter.verifyWebhookSignature(payload, `sha256=${expectedHash}`, appSecret);
      expect(isValid).toBe(true);

      const isInvalid = adapter.verifyWebhookSignature(payload, 'sha256=forged_bad_hash', appSecret);
      expect(isInvalid).toBe(false);

      const emptySig = adapter.verifyWebhookSignature(payload, '', appSecret);
      expect(emptySig).toBe(false);
    });

    it('parses complete status progression: sent, delivered, read, and failed', () => {
      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.HBgL_sent_1==',
                      status: 'sent',
                      timestamp: '1729160000',
                      recipient_id: '919618954429',
                    },
                    {
                      id: 'wamid.HBgL_delivered_2==',
                      status: 'delivered',
                      timestamp: '1729160005',
                      recipient_id: '919618954429',
                    },
                    {
                      id: 'wamid.HBgL_read_3==',
                      status: 'read',
                      timestamp: '1729160020',
                      recipient_id: '919618954429',
                    },
                    {
                      id: 'wamid.HBgL_failed_4==',
                      status: 'failed',
                      timestamp: '1729160030',
                      recipient_id: '919618954429',
                      errors: [
                        {
                          code: 131026,
                          title: 'Message Undeliverable',
                          message: 'Recipient handset is switched off or unreachable',
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const events = adapter.parseWebhook(metaPayload);
      expect(events).toHaveLength(4);

      // 1. Sent
      expect(events[0].messageId).toBe('wamid.HBgL_sent_1==');
      expect(events[0].status).toBe('SENT');

      // 2. Delivered
      expect(events[1].messageId).toBe('wamid.HBgL_delivered_2==');
      expect(events[1].status).toBe('DELIVERED');

      // 3. Read
      expect(events[2].messageId).toBe('wamid.HBgL_read_3==');
      expect(events[2].status).toBe('READ');

      // 4. Failed
      expect(events[3].messageId).toBe('wamid.HBgL_failed_4==');
      expect(events[3].status).toBe('FAILED');
      expect(events[3].errorCode).toBe(131026);
      expect(events[3].error).toBe('Recipient handset is switched off or unreachable');
    });

    it('safely handles empty or malformed webhook payload without throwing', () => {
      const emptyEvents = adapter.parseWebhook({});
      expect(emptyEvents).toEqual([]);

      const nullEvents = adapter.parseWebhook(null);
      expect(nullEvents).toEqual([]);

      const malformedEvents = adapter.parseWebhook({ entry: [{ changes: [] }] });
      expect(malformedEvents).toEqual([]);
    });
  });

  describe('Incoming WhatsApp Messages Parsing (parseInboundMessages)', () => {
    it('parses a valid incoming text message from Meta Cloud API payload', () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '1959193371412227',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '1265643423303870' },
                  contacts: [{ profile: { name: 'Ramesh Kumar' }, wa_id: '919618954429' }],
                  messages: [
                    {
                      from: '919618954429',
                      id: 'wamid.HBgL_inbound_valid_1==',
                      timestamp: '1729868400',
                      type: 'text',
                      text: { body: 'I have already paid this invoice via UPI' },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const messages = adapter.parseInboundMessages(payload);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('wamid.HBgL_inbound_valid_1==');
      expect(messages[0].senderPhone).toBe('919618954429');
      expect(messages[0].senderNumber).toBe('919618954429');
      expect(messages[0].type).toBe('text');
      expect(messages[0].text).toBe('I have already paid this invoice via UPI');
      expect(messages[0].timestamp).toEqual(new Date(1729868400 * 1000));
    });

    it('handles unsupported message types safely without extracting invalid text body', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '+91 96189 54429',
                      id: 'wamid.HBgL_image_msg_2==',
                      timestamp: '1729868405',
                      type: 'image',
                      image: { id: 'img_media_id_123', mime_type: 'image/jpeg' },
                    },
                    {
                      from: '919618954429',
                      id: 'wamid.HBgL_reaction_msg_3==',
                      timestamp: '1729868410',
                      type: 'reaction',
                      reaction: { message_id: 'wamid.orig==', emoji: '👍' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = adapter.parseInboundMessages(payload);
      expect(messages).toHaveLength(2);

      expect(messages[0].messageId).toBe('wamid.HBgL_image_msg_2==');
      expect(messages[0].senderPhone).toBe('919618954429');
      expect(messages[0].type).toBe('image');
      expect(messages[0].text).toBeUndefined();

      expect(messages[1].messageId).toBe('wamid.HBgL_reaction_msg_3==');
      expect(messages[1].type).toBe('reaction');
      expect(messages[1].text).toBeUndefined();
    });

    it('safely skips messages with missing mandatory fields (missing id or from)', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '919618954429', type: 'text', text: { body: 'Missing ID' } },
                    { id: 'wamid.missing_from==', type: 'text', text: { body: 'Missing from' } },
                    {
                      from: '919876543210',
                      id: 'wamid.valid_partial==',
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = adapter.parseInboundMessages(payload);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('wamid.valid_partial==');
      expect(messages[0].senderPhone).toBe('919876543210');
      expect(messages[0].text).toBeUndefined();
    });

    it('parses multiple messages across entries and changes in exact order', () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '919000000001',
                      id: 'wamid.msg_1==',
                      timestamp: '1729868400',
                      type: 'text',
                      text: { body: 'First message' },
                    },
                    {
                      from: '919000000002',
                      id: 'wamid.msg_2==',
                      timestamp: '1729868401',
                      type: 'text',
                      text: { body: 'Second message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = adapter.parseInboundMessages(payload);
      expect(messages).toHaveLength(2);
      expect(messages[0].messageId).toBe('wamid.msg_1==');
      expect(messages[0].text).toBe('First message');
      expect(messages[1].messageId).toBe('wamid.msg_2==');
      expect(messages[1].text).toBe('Second message');
    });

    it('safely handles empty or malformed payloads without throwing', () => {
      expect(adapter.parseInboundMessages(null)).toEqual([]);
      expect(adapter.parseInboundMessages(undefined)).toEqual([]);
      expect(adapter.parseInboundMessages({})).toEqual([]);
      expect(adapter.parseInboundMessages('not an object')).toEqual([]);
      expect(adapter.parseInboundMessages({ entry: 'invalid' })).toEqual([]);
      expect(adapter.parseInboundMessages({ entry: [{ changes: null }] })).toEqual([]);
      expect(adapter.parseInboundMessages({ entry: [{ changes: [{ value: { messages: [null, undefined, 42] } }] }] })).toEqual([]);
    });

    it('ensures status parsing remains completely decoupled and unchanged', () => {
      const statusPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [{ id: 'wamid.HBgL_status_only==', status: 'delivered', timestamp: '1729868400' }],
                },
              },
            ],
          },
        ],
      };

      const incomingMessagePayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '919618954429',
                      id: 'wamid.HBgL_inbound_only==',
                      timestamp: '1729868400',
                      type: 'text',
                      text: { body: 'Will clear by Friday' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      // 1. Status parsing does not produce inbound messages
      const inboundFromStatus = adapter.parseInboundMessages(statusPayload);
      expect(inboundFromStatus).toEqual([]);

      // 2. Inbound messages payload does not produce status events (not treated as delivery status)
      const statusesFromInbound = adapter.parseWebhook(incomingMessagePayload);
      expect(statusesFromInbound).toEqual([]);

      // 3. Status parsing works normally on status payload
      const statusEvents = adapter.parseWebhook(statusPayload);
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0].messageId).toBe('wamid.HBgL_status_only==');
      expect(statusEvents[0].status).toBe('DELIVERED');

      // 4. Inbound parsing works normally on incoming message payload
      const inboundEvents = adapter.parseInboundMessages(incomingMessagePayload);
      expect(inboundEvents).toHaveLength(1);
      expect(inboundEvents[0].messageId).toBe('wamid.HBgL_inbound_only==');
      expect(inboundEvents[0].text).toBe('Will clear by Friday');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Mock HTTP Response Dispatch & Error Handling
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Mocked HTTP Dispatch Behaviors & Truthful Failure Handling', () => {
    it('returns SENT with live messageId when Meta Cloud API responds with 200 OK', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '919618954429', wa_id: '919618954429' }],
          messages: [{ id: 'wamid.HBgMOTE5NjE4OTU0NDI5FQIAERgSNUIwNkVDNDM2RjIwNDY4MEZCAA==' }],
        }),
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Owner Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-001',
          amount: 5000,
          dueDate: '2026-10-25',
          daysOverdue: 1,
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('SENT');
      expect(result.isSimulated).toBe(false);
      expect(result.messageId).toBe('wamid.HBgMOTE5NjE4OTU0NDI5FQIAERgSNUIwNkVDNDM2RjIwNDY4MEZCAA==');
      expect(result.error).toBeUndefined();
    });

    it('returns FAILED when Meta API returns HTTP 400 Bad Request', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Parameter format does not match template schema',
            type: 'OAuthException',
            code: 100,
            fbtrace_id: 'FBT_400_XYZ',
          },
        }),
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-400',
          amount: 5000,
          dueDate: '2026-10-25',
          daysOverdue: 1,
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toBe('Parameter format does not match template schema');
      expect(result.raw?.httpStatus).toBe(400);
      expect(result.raw?.errorCode).toBe(100);
      expect(result.raw?.fbtraceId).toBe('FBT_400_XYZ');
      expect(result.messageId).toMatch(/^wamid\.failed\./);
    });

    it('returns FAILED and redacts access tokens when Meta API returns HTTP 401 Unauthorized', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_secret_access_token_abc';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: 'Invalid OAuth access token EAAG_secret_access_token_abc - session has expired',
            type: 'OAuthException',
            code: 190,
          },
        }),
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-401',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).not.toContain('EAAG_secret_access_token_abc');
      expect(result.error).toContain('[REDACTED_ACCESS_TOKEN]');
      expect(result.raw?.httpStatus).toBe(401);
      expect(result.raw?.errorCode).toBe(190);
    });

    it('returns FAILED when Meta API returns HTTP 404 (template unapproved)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            message: 'Template name does not exist in the translation',
            type: 'OAuthException',
            code: 132001,
            error_data: { details: 'payment_reminder_overdue in en_US' },
          },
        }),
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Owner Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-002',
          amount: 5000,
          dueDate: '2026-10-25',
          daysOverdue: 1,
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('Template name does not exist in the translation');
      expect(result.raw?.httpStatus).toBe(404);
      expect(result.raw?.errorCode).toBe(132001);
      expect(result.messageId).toMatch(/^wamid\.failed\./);
    });

    it('returns FAILED when Meta API returns HTTP 429 Too Many Requests (rate limited)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: 'Too many calls to this Phone-Number-ID. Wait before retrying.',
            type: 'OAuthException',
            code: 80007,
          },
        }),
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-429',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('Too many calls');
      expect(result.raw?.httpStatus).toBe(429);
      expect(result.raw?.errorCode).toBe(80007);
    });

    it('returns FAILED when Meta API returns HTTP 500 Internal Server Error', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Not JSON');
        },
      } as any);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-500',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('HTTP 500');
      expect(result.raw?.httpStatus).toBe(500);
      expect(result.messageId).toMatch(/^wamid\.failed\./);
    });

    it('returns FAILED on network connection error (e.g. DNS failure or ECONNREFUSED)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND graph.facebook.com'));

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-NET-ERR',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('ENOTFOUND');
      expect(result.raw?.networkError).toBe(true);
      expect(result.raw?.isTimeout).toBe(false);
      expect(result.messageId).toMatch(/^wamid\.err\./);
    });

    it('returns FAILED on request timeout (AbortError / TimeoutError)', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      const abortError = new Error('The operation was aborted due to timeout');
      abortError.name = 'TimeoutError';
      vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Recipient',
          invoiceNumber: 'INV-LIVE-TIMEOUT',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919123456789',
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.raw?.networkError).toBe(true);
      expect(result.raw?.isTimeout).toBe(true);
      expect(result.messageId).toMatch(/^wamid\.err\./);
    });

    it('guarantees that under NO failure scenario is status ever reported as DELIVERED', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      const errorStatusCodes = [400, 401, 403, 404, 429, 500, 502, 503];

      for (const code of errorStatusCodes) {
        vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: code,
          json: async () => ({ error: { message: `Meta Error HTTP ${code}`, code } }),
        } as any);

        const res = await adapter.send({
          to: '919618954429',
          recipientName: 'Test Recipient',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Notice',
          payload: {
            customerName: 'Test Recipient',
            companyContactNumber: '+919123456789',
          },
        });

        expect(res.status).not.toBe('DELIVERED');
        expect(res.status).toBe('FAILED');
        expect(res.isSimulated).toBe(false);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Tenant Contact Number Validation & Fail-Safe Protection
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Tenant Contact Number Validation & Fail-Safe Protection', () => {
    it('accepts valid phone number formats', () => {
      expect(validateCompanyContactNumber('+919876543210', '919618954429').valid).toBe(true);
      expect(validateCompanyContactNumber('+1 (555) 234-5678', '919618954429').valid).toBe(true);
      expect(validateCompanyContactNumber('09876543210', '919618954429').valid).toBe(true);
    });

    it('fails safely when contact number is undefined, null, or empty string', () => {
      const resUndefined = validateCompanyContactNumber(undefined);
      expect(resUndefined.valid).toBe(false);
      expect(resUndefined.reason).toContain('missing');

      const resEmpty = validateCompanyContactNumber('   ');
      expect(resEmpty.valid).toBe(false);
      expect(resEmpty.reason).toContain('empty');
    });

    it('fails safely when contact number is non-string or malformed', () => {
      const resNonString = validateCompanyContactNumber(1234567890 as any);
      expect(resNonString.valid).toBe(false);

      const resBadChars = validateCompanyContactNumber('+91-987-INVALID');
      expect(resBadChars.valid).toBe(false);
      expect(resBadChars.reason).toContain('invalid characters');
    });

    it('fails safely when contact number has fewer than 8 or more than 15 digits', () => {
      const resTooShort = validateCompanyContactNumber('+91123');
      expect(resTooShort.valid).toBe(false);
      expect(resTooShort.reason).toContain('between 8 and 15 digits');

      const resTooLong = validateCompanyContactNumber('+911234567890123456');
      expect(resTooLong.valid).toBe(false);
      expect(resTooLong.reason).toContain('between 8 and 15 digits');
    });

    it('fails safely when company contact number matches recipient customer phone', () => {
      const resSame = validateCompanyContactNumber('+919618954429', '919618954429');
      expect(resSame.valid).toBe(false);
      expect(resSame.reason).toContain('cannot match customer phone number');
    });

    it('rejects live dispatch for PAYMENT_REMINDER_OVERDUE if company contact number is missing', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Customer',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Customer',
          invoiceNumber: 'INV-LIVE-003',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          // companyContactNumber intentionally omitted
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.raw?.safetyGuard).toBe(true);
      expect(result.raw?.error).toContain('missing');
    });

    it('rejects dispatch if company contact number equals customer phone', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
      process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_valid_live_token_123';
      process.env.WHATSAPP_TEST_RECIPIENT = '919618954429';

      const result = await adapter.send({
        to: '919618954429',
        recipientName: 'Test Customer',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Invoice overdue notice',
        payload: {
          customerName: 'Test Customer',
          invoiceNumber: 'INV-LIVE-003',
          amount: 5000,
          dueDate: '2026-10-25',
          companyName: 'myCashflo',
          companyContactNumber: '+919618954429', // Same as recipient to
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.raw?.safetyGuard).toBe(true);
      expect(result.raw?.error).toContain('cannot match customer phone number');
    });
  });
});
