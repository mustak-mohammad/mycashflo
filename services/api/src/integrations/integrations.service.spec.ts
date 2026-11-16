import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { IntegrationsService } from './integrations.service.js';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';
import { WhatsAppCloudAdapter } from './adapters/whatsapp-cloud.adapter.js';
import { SipTelephonyAdapter } from './adapters/sip-telephony.adapter.js';
import { ResendEmailAdapter } from './adapters/resend-email.adapter.js';
import { SmsGatewayAdapter } from './adapters/sms-gateway.adapter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';

describe('Phase 7 Integrations Unit Tests', () => {
  let integrationsService: IntegrationsService;
  let razorpay: RazorpayAdapter;
  let stripe: StripeAdapter;
  let whatsapp: WhatsAppCloudAdapter;
  let telephony: SipTelephonyAdapter;
  let email: ResendEmailAdapter;
  let sms: SmsGatewayAdapter;
  let mockPrisma: any;
  let mockAuditLogs: any;

  const mockUser: AuthUser = {
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'ADMIN',
  };

  const originalEncKey = process.env.INTEGRATION_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    mockPrisma = {
      integrationConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockAuditLogs = {
      log: vi.fn().mockResolvedValue({ id: 'log_1' }),
    };

    razorpay = new RazorpayAdapter();
    stripe = new StripeAdapter();
    whatsapp = new WhatsAppCloudAdapter();
    telephony = new SipTelephonyAdapter();
    email = new ResendEmailAdapter();
    sms = new SmsGatewayAdapter();

    integrationsService = new IntegrationsService(
      mockPrisma as PrismaService,
      mockAuditLogs as AuditLogsService,
      razorpay,
      stripe,
      whatsapp,
      telephony,
      email,
      sms,
    );
  });

  afterEach(() => {
    if (originalEncKey !== undefined) {
      process.env.INTEGRATION_ENCRYPTION_KEY = originalEncKey;
    } else {
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
    }
  });

  describe('RazorpayAdapter', () => {
    it('generates simulated payment link with valid structure when simulation requested', async () => {
      const link = await razorpay.createPaymentLink(
        {
          invoiceNumber: 'INV-2026-001',
          amount: 25000,
          currency: 'INR',
          customerName: 'Acme Corp',
          customerEmail: 'finance@acme.in',
        },
        { simulate: true },
      );

      expect(link.id).toMatch(/^plink_/);
      expect(link.provider).toBe('RAZORPAY');
      expect(link.url).toContain('rzp.io/i/mock_');
      expect(link.amount).toBe(25000);
      expect(link.currency).toBe('INR');
      expect(link.isSimulated).toBe(true);
    });

    it('verifies HMAC-SHA256 signature for Razorpay webhooks', async () => {
      const secret = 'test_webhook_secret_123';
      const body = {
        event: 'payment_link.paid',
        payload: {
          payment: {
            entity: {
              id: 'pay_998877',
              amount: 2500000,
              currency: 'INR',
              notes: { invoiceNumber: 'INV-2026-001' },
            },
          },
          payment_link: {
            entity: {
              id: 'plink_112233',
              notes: { invoiceNumber: 'INV-2026-001' },
            },
          },
        },
      };

      const raw = JSON.stringify(body);
      const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');

      const res = await razorpay.verifyWebhook(body, signature, secret);
      expect(res.isValid).toBe(true);
      expect(res.invoiceNumber).toBe('INV-2026-001');
      expect(res.amount).toBe(25000);
      expect(res.status).toBe('COMPLETED');
    });
  });

  describe('StripeAdapter', () => {
    it('generates simulated checkout link with valid structure when simulation requested', async () => {
      const link = await stripe.createPaymentLink(
        {
          invoiceNumber: 'INV-2026-USD-1',
          amount: 500,
          currency: 'USD',
          customerName: 'Global Inc',
          customerEmail: 'billing@global.com',
        },
        { simulate: true },
      );

      expect(link.id).toMatch(/^cs_/);
      expect(link.provider).toBe('STRIPE');
      expect(link.url).toContain('checkout.stripe.com');
      expect(link.amount).toBe(500);
      expect(link.currency).toBe('USD');
      expect(link.isSimulated).toBe(true);
    });

    it('verifies Stripe webhook signature and extracts event data', async () => {
      const secret = 'whsec_test_secret';
      const body = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session_4455',
            payment_intent: 'pi_test_9999',
            amount_total: 50000,
            currency: 'usd',
            metadata: { invoiceNumber: 'INV-2026-USD-1' },
          },
        },
      };

      const raw = JSON.stringify(body);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${raw}`;
      const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      const stripeSignature = `t=${timestamp},v1=${v1}`;

      const res = await stripe.verifyWebhook(body, stripeSignature, secret);
      expect(res.isValid).toBe(true);
      expect(res.invoiceNumber).toBe('INV-2026-USD-1');
      expect(res.amount).toBe(500);
      expect(res.status).toBe('COMPLETED');
    });
  });

  describe('WhatsAppCloudAdapter', () => {
    it('dispatches simulated WhatsApp message with messageId and valid delivery', async () => {
      const res = await whatsapp.send({
        to: '+919876543210',
        recipientName: 'Test Recipient',
        template: 'PAYMENT_REMINDER_OVERDUE',
        message: 'Reminder for overdue invoice',
      });

      expect(res.messageId).toMatch(/^wamid\./);
      expect(res.provider).toBe('WHATSAPP_CLOUD');
      expect(res.status).toBe('DELIVERED');
      expect(res.isSimulated).toBe(true);
    });

    it('validates Meta webhook challenge handshake', () => {
      const challenge = 'random_hub_challenge_12345';
      const result = whatsapp.verifyWebhookChallenge(
        'subscribe',
        'mycashflo_whatsapp_verify_token',
        challenge,
        'mycashflo_whatsapp_verify_token',
      );
      expect(result).toBe(challenge);

      const invalidResult = whatsapp.verifyWebhookChallenge(
        'subscribe',
        'wrong_token',
        challenge,
        'mycashflo_whatsapp_verify_token',
      );
      expect(invalidResult).toBeNull();
    });

    it('parses delivery and read receipts from Meta webhook payload', () => {
      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.HBgL12345==',
                      status: 'delivered',
                      timestamp: '1729160000',
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = whatsapp.parseWebhook(metaPayload);
      expect(parsed.length).toBe(1);
      expect(parsed[0].messageId).toBe('wamid.HBgL12345==');
      expect(parsed[0].status).toBe('DELIVERED');
    });
  });

  describe('SipTelephonyAdapter & Safety Policy', () => {
    it('STRICT SAFETY: real outbound calls remain disabled by default, running in safe simulation mode', async () => {
      delete process.env.OUTBOUND_CALLS_ENABLED;

      const call = await telephony.initiateCall({
        to: '+919876543210',
        customerId: 'cust_1',
        customerName: 'Gupta Enterprises',
        callReason: 'Payment Collection',
      });

      expect(call.status).toBe('SIMULATED');
      expect(call.isSimulated).toBe(true);
      expect(call.callSid).toMatch(/^CA_sim_/);
      expect(call.notes).toContain('disabled by policy');
    });

    it('parses carrier status callback correctly', () => {
      const statusCallback = {
        CallSid: 'CA_test_call_123',
        CallStatus: 'completed',
        CallDuration: '45',
      };

      const parsed = telephony.parseStatusCallback(statusCallback);
      expect(parsed.callSid).toBe('CA_test_call_123');
      expect(parsed.status).toBe('completed');
      expect(parsed.duration).toBe(45);
    });
  });

  describe('IntegrationsService & Tenant Isolation', () => {
    it('masks sensitive secrets when returning configuration', async () => {
      mockPrisma.integrationConfig.findMany.mockResolvedValue([
        {
          id: 'cfg_1',
          provider: 'RAZORPAY',
          isActive: true,
          config: {
            keyId: 'rzp_test_1234567890',
            keySecret: 'secret_live_password_abc',
          },
          updatedAt: new Date(),
        },
      ]);

      const configs = await integrationsService.getConfigs(mockUser);
      const rzpConfig = configs.find((c) => c.provider === 'RAZORPAY');

      expect(rzpConfig).toBeDefined();
      expect(rzpConfig?.isConfigured).toBe(true);
      expect(rzpConfig?.config.keySecret).toContain('...');
      expect(rzpConfig?.config.keySecret).not.toBe('secret_live_password_abc');
    });

    it('saves tenant-isolated configuration and creates audit log', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue(null);
      mockPrisma.integrationConfig.upsert.mockResolvedValue({
        id: 'cfg_saved',
        provider: 'STRIPE',
        isActive: true,
        config: { secretKey: 'sk_test_1234567890' },
        updatedAt: new Date(),
      });

      const res = await integrationsService.saveConfig(mockUser, 'STRIPE', {
        config: { secretKey: 'sk_test_1234567890' },
        isActive: true,
      });

      expect(res.id).toBe('cfg_saved');
      expect(mockPrisma.integrationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_tenantId: {
              provider: 'STRIPE',
              tenantId: 'tenant_1',
            },
          },
        }),
      );
      expect(mockAuditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'integration.configured',
          tenantId: 'tenant_1',
        }),
      );
    });

    it('tests connectivity for SMS_GATEWAY in simulation mode', async () => {
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        id: 'cfg_sms',
        provider: 'SMS_GATEWAY',
        config: { senderId: 'MCASHF', testRecipient: '+919876543210' },
      });

      const res = await integrationsService.testConnection(mockUser, 'SMS_GATEWAY');
      expect(res.provider).toBe('SMS_GATEWAY');
      expect(res.status).toBe('SUCCESS');
      expect(res.isSimulated).toBe(true);
      expect(res.message).toContain('simulation mode');
      expect(res.messageId).toMatch(/^sms_/);
    });
  });

  describe('SmsGatewayAdapter', () => {
    it('dispatches simulated SMS with DLT metadata when delivery is disabled', async () => {
      const result = await sms.send(
        {
          to: '+919876543210',
          recipientName: 'Gupta Enterprises',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Please pay overdue invoice INV-001',
        },
        { deliveryEnabled: false, senderId: 'MCASHF', templateId: 'DLT-110716-1234' },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.raw?.senderId).toBe('MCASHF');
      expect(result.raw?.dltTemplateId).toBe('DLT-110716-1234');
    });

    it('blocks real customer phone number in non-production environments', async () => {
      const result = await sms.send(
        {
          to: '+919123456789', // Not in test allowlist
          recipientName: 'Real Customer',
          template: 'OVERDUE_NOTICE',
          message: 'Notice content',
        },
        {
          deliveryEnabled: true,
          testRecipient: '+919876543210',
        },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.raw?.safetyGuard).toBe(true);
    });

    it('parses DLR status callbacks correctly', () => {
      const event = sms.parseWebhook({
        MessageSid: 'SM123456789',
        MessageStatus: 'delivered',
        To: '+919876543210',
      });

      expect(event.length).toBe(1);
      expect(event[0].messageId).toBe('SM123456789');
      expect(event[0].status).toBe('DELIVERED');
      expect(event[0].recipientPhone).toBe('+919876543210');
    });
  });

  describe('WhatsAppCloudAdapter Enhanced Features', () => {
    it('suppresses un-whitelisted recipient outreach in non-production', async () => {
      const result = await whatsapp.send(
        {
          to: '+919123456789',
          recipientName: 'External Customer',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Reminder message',
        },
        {
          phoneNumberId: 'phone_123',
          accessToken: 'live_access_token_abc',
          testRecipient: '+919876543210',
        },
      );

      expect(result.isSimulated).toBe(true);
      expect(result.raw?.safetyGuard).toBe(true);
      expect(result.raw?.reason).toContain('suppressed in non-production');
    });
  });

  describe('SipTelephonyAdapter LiveKit SIP Mode', () => {
    it('generates simulated LiveKit SIP call session and protects outbound calls by policy', async () => {
      const call = await telephony.initiateCall(
        {
          to: '+919876543210',
          customerId: 'cust_001',
          customerName: 'Gupta Enterprises',
          callReason: 'LiveKit SIP Session Bridge',
        },
        {
          provider: 'LIVEKIT_SIP',
          sipTrunkId: 'ST_livekit_trunk_123',
          sipTrunkUri: 'sip:sip.livekit.cloud',
        },
      );

      expect(call.isSimulated).toBe(true);
      expect(call.status).toBe('SIMULATED');
      expect(call.raw?.policy).toBe('OUTBOUND_CALLS_DISABLED_BY_DEFAULT');
      expect(call.raw?.roomName).toMatch(/^mcf-cust_001-/);
      expect(call.callSid).toMatch(/^CA_sim_/);
    });
  });

  describe('Razorpay IntegrationConfig Security & Connectivity Guards', () => {
    it('rejects saving live Razorpay keys (rzp_live_*) outside production', async () => {
      await expect(
        integrationsService.saveConfig(mockUser, 'RAZORPAY', {
          config: {
            keyId: 'rzp_live_1234567890abcdef',
            keySecret: 'secret_live_12345678',
          },
        }),
      ).rejects.toThrow('Live Razorpay credentials (rzp_live_*) cannot be saved outside production');
      expect(mockPrisma.integrationConfig.upsert).not.toHaveBeenCalled();
    });

    it('rejects saving placeholder Razorpay credentials', async () => {
      await expect(
        integrationsService.saveConfig(mockUser, 'RAZORPAY', {
          config: {
            keyId: 'rzp_test_placeholder_key_id',
            keySecret: 'placeholder_razorpay_key_secret',
          },
        }),
      ).rejects.toThrow('placeholder');
    });

    it('returns FAILED status instead of SUCCESS when testing missing Razorpay credentials', async () => {
      delete process.env.PAYMENT_SIMULATION_MODE;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      mockPrisma.integrationConfig.findUnique.mockResolvedValue({
        provider: 'RAZORPAY',
        config: {},
      });

      const res = await integrationsService.testConnection(mockUser, 'RAZORPAY');
      expect(res.status).toBe('FAILED');
      expect(res.message).toContain('Razorpay connectivity error');
    });
  });
});
