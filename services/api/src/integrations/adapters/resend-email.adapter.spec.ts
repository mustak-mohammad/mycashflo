import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResendEmailAdapter } from './resend-email.adapter.js';
import { BadRequestException } from '@nestjs/common';

describe('ResendEmailAdapter', () => {
  let adapter: ResendEmailAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    adapter = new ResendEmailAdapter();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Simulation Mode & Safety Guard', () => {
    it('1. should report FAILED (not DELIVERED) when delivery is disabled by safety policy', async () => {
      const result = await adapter.send(
        {
          to: 'customer@democorp.in',
          subject: 'Payment Reminder',
          text: 'Please pay invoice INV-001',
        },
        { deliveryEnabled: false },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.provider).toBe('RESEND');
      expect(result.error).toContain('disabled by safety policy');
      expect(result.messageId).toMatch(/^msg_disabled_/);
    });

    it('2. should block real customer address when not matching test allowlist in non-production', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'qa-engineer@internal.test';

      const fetchSpy = vi.spyOn(global, 'fetch');

      const result = await adapter.send({
        to: 'real-client@production-client.com',
        subject: 'Overdue Notice',
        text: 'Invoice is overdue',
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.error).toContain('Safety Guard');
      expect(result.error).toContain('real-client@production-client.com');
      // Must NEVER call external API for un-allowlisted real customer in non-production
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('3. should allow delivery to explicitly configured EMAIL_TEST_RECIPIENT', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'qa-engineer@internal.test';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 're_live_msg_999' }),
      } as any);

      const result = await adapter.send({
        to: 'qa-engineer@internal.test',
        subject: 'Overdue Notice',
        text: 'Invoice is overdue',
      });

      expect(result.status).toBe('SENT');
      expect(result.isSimulated).toBe(false);
      expect(result.messageId).toBe('re_live_msg_999');
    });

    it('4. should allow provider test address (*@resend.dev) in test mode', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 're_delivered_123' }),
      } as any);

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Test delivery',
        text: 'Test message',
      });

      expect(result.status).toBe('SENT');
      expect(result.isSimulated).toBe(false);
      expect(result.messageId).toBe('re_delivered_123');
    });

    it('4b. should permit live delivery for scoped test sends when REMINDERS_TEST_EMAIL_DELIVERY_ENABLED is true even if EMAIL_DELIVERY_ENABLED is false', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'false'; // Global delivery disabled!
      process.env.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED = 'true'; // Scoped test enabled
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'qa-engineer@internal.test';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 're_isolated_test_001' }),
      } as any);

      // Explicitly scoped test send
      const result = await adapter.send({
        to: 'qa-engineer@internal.test',
        subject: '[TEST REMINDER] Overdue Notice',
        text: 'Test reminder',
        isTest: true,
      });

      expect(result.status).toBe('SENT');
      expect(result.isSimulated).toBe(false);
      expect(result.messageId).toBe('re_isolated_test_001');
    });

    it('4c. should report FAILED when REMINDERS_TEST_EMAIL_DELIVERY_ENABLED is true but dispatch is not an authorized test send', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'false'; // Global delivery disabled
      process.env.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED = 'true'; // Scoped test enabled
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'qa-engineer@internal.test';

      const fetchSpy = vi.spyOn(global, 'fetch');

      // Unrelated workflow (e.g. bulk reminder or collections notification) where isTest is not set
      const result = await adapter.send({
        to: 'qa-engineer@internal.test',
        subject: 'Regular Notification',
        text: 'Non-test message',
        // isTest is undefined / false
      });

      // Must report FAILED with safety policy reason, never false DELIVERED
      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.provider).toBe('RESEND');
      expect(result.error).toContain('disabled by safety policy');
      expect(result.messageId).toMatch(/^msg_disabled_/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('4d. should strictly block real customer address even during scoped live test mode', async () => {
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_DELIVERY_ENABLED = 'false';
      process.env.REMINDERS_TEST_EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'qa-engineer@internal.test';

      const fetchSpy = vi.spyOn(global, 'fetch');

      // Even if isTest: true is set, if recipient is a real customer, safety guard must block it
      const result = await adapter.send({
        to: 'real-customer@external.com',
        subject: 'Notice',
        text: 'Invoice due',
        isTest: true,
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(true);
      expect(result.error).toContain('Safety Guard');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Configuration & Error Handling', () => {
    it('5. should return FAILED when delivery is enabled but API key is missing', async () => {
      delete process.env.RESEND_API_KEY;

      const result = await adapter.send(
        {
          to: 'delivered@resend.dev',
          subject: 'Test',
          text: 'Test',
        },
        { deliveryEnabled: true, apiKey: '' },
      );

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('RESEND_API_KEY is not configured');
      expect(result.messageId).toMatch(/^msg_no_key_/);
    });

    it('6. should reject invalid recipient email syntax safely without calling API', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const result = await adapter.send({
        to: 'not-an-email',
        subject: 'Test',
        text: 'Test',
      });

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Invalid recipient email address syntax');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('7. should handle provider 422 validation errors gracefully', async () => {
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'delivered@resend.dev';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          statusCode: 422,
          message: 'The from domain is unverified.',
          name: 'validation_error',
        }),
      } as any);

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Invoice Notice',
        text: 'Please pay',
      });

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('The from domain is unverified.');
      expect(result.isSimulated).toBe(false);
    });

    it('7b. should handle HTTP 401 Unauthorized and sanitize leaked API keys', async () => {
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_secret_live_key_99999';
      process.env.EMAIL_TEST_RECIPIENT = 'delivered@resend.dev';

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          statusCode: 401,
          message: 'Invalid API key re_secret_live_key_99999 provided',
        }),
      } as any);

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Invoice Notice',
        text: 'Please pay',
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).not.toContain('re_secret_live_key_99999');
      expect(result.error).toContain('[REDACTED_API_KEY]');
    });

    it('8. should retry on transient 5xx server errors and return FAILED if retries fail', async () => {
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'delivered@resend.dev';

      let callCount = 0;
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Temporarily Unavailable' }),
        } as any;
      });

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Test Retry',
        text: 'Retry test',
      });

      expect(callCount).toBe(3); // 1 initial + 2 retries
      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Service Temporarily Unavailable');
    });

    it('8b. should return FAILED on network connection errors (e.g. DNS failure)', async () => {
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'delivered@resend.dev';

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.resend.com'));

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Test Network Error',
        text: 'Network error test',
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('ENOTFOUND');
      expect(result.messageId).toMatch(/^msg_err_/);
    });

    it('8c. should return FAILED on request timeout (AbortError)', async () => {
      process.env.EMAIL_DELIVERY_ENABLED = 'true';
      process.env.RESEND_API_KEY = 're_test_key_123456';
      process.env.EMAIL_TEST_RECIPIENT = 'delivered@resend.dev';

      const abortError = new Error('The operation was aborted due to timeout');
      abortError.name = 'TimeoutError';
      vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

      const result = await adapter.send({
        to: 'delivered@resend.dev',
        subject: 'Test Timeout',
        text: 'Timeout test',
      });

      expect(result.status).toBe('FAILED');
      expect(result.isSimulated).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.messageId).toMatch(/^msg_err_/);
    });

    it('8d. guarantees that disabled or failed email is NEVER reported as DELIVERED', async () => {
      const disabledRes = await adapter.send(
        { to: 'cust@democorp.in', subject: 'Notice', text: 'Text' },
        { deliveryEnabled: false },
      );
      expect(disabledRes.status).not.toBe('DELIVERED');
      expect(disabledRes.status).toBe('FAILED');

      const noKeyRes = await adapter.send(
        { to: 'delivered@resend.dev', subject: 'Notice', text: 'Text' },
        { deliveryEnabled: true, apiKey: '' },
      );
      expect(noKeyRes.status).not.toBe('DELIVERED');
      expect(noKeyRes.status).toBe('FAILED');
    });
  });

  describe('Webhook Verification & Parsing', () => {
    it('9. should verify valid webhook signatures and reject invalid ones', () => {
      expect(adapter.verifyWebhookSignature({ test: 1 }, 'mock_valid_signature')).toBe(true);
      expect(adapter.verifyWebhookSignature({ test: 1 }, 'sim_signature_123')).toBe(true);
      expect(adapter.verifyWebhookSignature({ test: 1 }, '')).toBe(false);
      expect(adapter.verifyWebhookSignature({ test: 1 }, 'forged_signature', 'test_secret')).toBe(false);
    });

    it('10. should parse delivery and failure events from webhook payload', () => {
      const deliveredPayload = {
        type: 'email.delivered',
        created_at: '2026-10-19T12:00:00Z',
        data: {
          email_id: 're_msg_101',
          to: ['client@corp.in'],
        },
      };

      const events = adapter.parseWebhook(deliveredPayload);
      expect(events.length).toBe(1);
      expect(events[0].messageId).toBe('re_msg_101');
      expect(events[0].status).toBe('DELIVERED');
      expect(events[0].event).toBe('delivered');
      expect(events[0].recipient).toBe('client@corp.in');

      const bouncedPayload = {
        type: 'email.bounced',
        created_at: '2026-10-19T12:05:00Z',
        data: {
          email_id: 're_msg_102',
          to: ['bad-inbox@corp.in'],
          rejection_reason: 'Mailbox does not exist',
        },
      };

      const bounceEvents = adapter.parseWebhook(bouncedPayload);
      expect(bounceEvents.length).toBe(1);
      expect(bounceEvents[0].status).toBe('FAILED');
      expect(bounceEvents[0].event).toBe('bounced');
      expect(bounceEvents[0].error).toBe('Mailbox does not exist');
    });
  });
});
