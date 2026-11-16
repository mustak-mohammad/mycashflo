import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmsGatewayAdapter } from './sms-gateway.adapter.js';

describe('SmsGatewayAdapter', () => {
  let adapter: SmsGatewayAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new SmsGatewayAdapter();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Simulation Mode & Delivery Disabled Policy', () => {
    it('1. reports FAILED (not DELIVERED) when SMS delivery is disabled', async () => {
      const result = await adapter.send(
        {
          to: '+919876543210',
          recipientName: 'Sharma Traders',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Please pay invoice INV-001',
        },
        { deliveryEnabled: false },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.error).toContain('SMS delivery is disabled by safety policy');
      expect(result.messageId).toMatch(/^sms_disabled_/);
      expect(result.raw?.deliveryDisabled).toBe(true);
    });

    it('2. blocks real customer phone outreach in non-production environments', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SMS_DELIVERY_ENABLED = 'true';
      process.env.SMS_TEST_RECIPIENT = '919618954429';

      const result = await adapter.send(
        {
          to: '+919999911111', // Real customer number not matching test recipient
          recipientName: 'Real Customer',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Overdue invoice notice',
        },
        {
          deliveryEnabled: true,
          testRecipient: '919618954429',
        },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.error).toContain('Safety Guard');
      expect(result.messageId).toMatch(/^sms_blocked_/);
      expect(result.raw?.safetyGuard).toBe(true);
    });

    it('3. reports FAILED when delivery is enabled but credentials are missing', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SMS_DELIVERY_ENABLED = 'true';
      process.env.SMS_TEST_RECIPIENT = '919618954429';

      const result = await adapter.send(
        {
          to: '919618954429',
          recipientName: 'Allowlisted Test Recipient',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Test message',
        },
        {
          deliveryEnabled: true,
          testRecipient: '919618954429',
          // accountSid and authToken intentionally missing
        },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('credentials are missing');
      expect(result.messageId).toMatch(/^sms_no_creds_/);
      expect(result.raw?.missingCredentials).toBe(true);
    });
  });

  describe('Live Provider Dispatch & Error Handling', () => {
    it('4. returns SENT with live message ID when credentials are valid and recipient is allowlisted', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SMS_DELIVERY_ENABLED = 'true';
      process.env.SMS_TEST_RECIPIENT = '919618954429';

      const result = await adapter.send(
        {
          to: '919618954429',
          recipientName: 'Test Recipient',
          template: 'PAYMENT_REMINDER_OVERDUE',
          message: 'Invoice overdue reminder',
        },
        {
          deliveryEnabled: true,
          testRecipient: '919618954429',
          accountSid: 'AC_test_account_sid_123',
          authToken: 'auth_token_secret_xyz',
          provider: 'TWILIO',
          senderId: 'MCASHF',
          templateId: 'DLT-110716-DEMO',
        },
      );

      expect(result.status).toBe('SENT');
      expect(result.isSimulated).toBe(false);
      expect(result.messageId).toMatch(/^sms_live_/);
      expect(result.provider).toBe('TWILIO');
      expect(result.error).toBeUndefined();
    });

    it('5. sanitizes secrets in logged and returned error messages', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SMS_DELIVERY_ENABLED = 'true';
      process.env.SMS_TEST_RECIPIENT = '919618954429';

      // Simulate a provider throw with an authToken in error message
      const spy = vi.spyOn(adapter as any, 'sanitizeSecretString');

      const sanitized = (adapter as any).sanitizeSecretString(
        'Authentication failed with authToken=super_secret_token_12345',
      );
      expect(sanitized).not.toContain('super_secret_token_12345');
      expect(sanitized).toContain('authToken=[REDACTED]');
    });

    it('6. guarantees that disabled or unconfigured SMS is NEVER reported as DELIVERED', async () => {
      // Disabled
      const resDisabled = await adapter.send(
        { to: '+919876543210', recipientName: 'Cust', template: 'T', message: 'M' },
        { deliveryEnabled: false },
      );
      expect(resDisabled.status).not.toBe('DELIVERED');
      expect(resDisabled.status).toBe('FAILED');

      // Missing credentials
      const resMissing = await adapter.send(
        { to: '919876543210', recipientName: 'Cust', template: 'T', message: 'M' },
        { deliveryEnabled: true },
      );
      expect(resMissing.status).not.toBe('DELIVERED');
      expect(resMissing.status).toBe('FAILED');
    });
  });

  describe('Webhook Signature & Status Parsing', () => {
    it('7. verifies webhook signature correctly', () => {
      expect(adapter.verifyWebhookSignature({ msg: 1 }, 'mock_sms_valid_signature')).toBe(true);
      expect(adapter.verifyWebhookSignature({ msg: 1 }, 'sim_sig_123')).toBe(true);
      expect(adapter.verifyWebhookSignature({ msg: 1 }, '')).toBe(false);
      expect(adapter.verifyWebhookSignature({ msg: 1 }, 'forged_sig', 'secret_abc')).toBe(false);
    });

    it('8. parses delivery status events accurately', () => {
      const deliveredEvent = adapter.parseWebhook({
        MessageSid: 'SM123456789',
        MessageStatus: 'delivered',
        To: '+919876543210',
      });
      expect(deliveredEvent.length).toBe(1);
      expect(deliveredEvent[0].messageId).toBe('SM123456789');
      expect(deliveredEvent[0].status).toBe('DELIVERED');

      const failedEvent = adapter.parseWebhook({
        MessageSid: 'SM987654321',
        MessageStatus: 'undelivered',
        ErrorMessage: 'Carrier network rejected delivery',
      });
      expect(failedEvent.length).toBe(1);
      expect(failedEvent[0].status).toBe('FAILED');
      expect(failedEvent[0].error).toBe('Carrier network rejected delivery');
    });
  });
});
