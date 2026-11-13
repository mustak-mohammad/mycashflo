import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';
import { validateEnvironment } from '../common/env.validation.js';

describe('Payment Webhook Hardening Specifications', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalRzpSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const originalStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let razorpay: RazorpayAdapter;
  let stripe: StripeAdapter;

  beforeEach(() => {
    razorpay = new RazorpayAdapter();
    stripe = new StripeAdapter();
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalRzpSecret) process.env.RAZORPAY_WEBHOOK_SECRET = originalRzpSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    if (originalStripeSecret) process.env.STRIPE_WEBHOOK_SECRET = originalStripeSecret;
    else delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  describe('Razorpay Webhook Verification', () => {
    it('should reject webhook in production when secret is missing', async () => {
      process.env.NODE_ENV = 'production';
      const result = await razorpay.verifyWebhook(
        { event: 'payment_link.paid' },
        'any_signature',
      );
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('FAILED');
    });

    it('should strictly reject simulation signatures in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'valid_secret_123';

      const mockResult = await razorpay.verifyWebhook(
        { event: 'payment_link.paid' },
        'mock_valid_signature',
      );
      expect(mockResult.isValid).toBe(false);

      const simResult = await razorpay.verifyWebhook(
        { event: 'payment_link.paid' },
        'sim_test_signature',
      );
      expect(simResult.isValid).toBe(false);
    });

    it('should reject invalid signatures with secret configured', async () => {
      const secret = 'rzp_whsec_test_secret_123';
      const payload = { event: 'payment_link.paid', invoiceNumber: 'INV-101' };
      const rawBody = JSON.stringify(payload);

      const result = await razorpay.verifyWebhook(
        payload,
        'invalid_hex_signature_404',
        secret,
        rawBody,
      );
      expect(result.isValid).toBe(false);
    });

    it('should reject tampered/modified payload despite valid signature on original payload', async () => {
      const secret = 'rzp_whsec_test_secret_123';
      const originalPayload = '{"event":"payment_link.paid","amount":5000}';
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(originalPayload)
        .digest('hex');

      // Attacker tampers body (e.g. changing amount or invoice)
      const tamperedPayload = '{"event":"payment_link.paid","amount":50}';

      const result = await razorpay.verifyWebhook(
        JSON.parse(tamperedPayload),
        validSignature,
        secret,
        tamperedPayload,
      );
      expect(result.isValid).toBe(false);
    });

    it('should accept valid HMAC signature with rawBody Buffer', async () => {
      const secret = 'rzp_whsec_production_strength_key';
      const rawBodyString = JSON.stringify({
        event: 'payment_link.paid',
        payload: {
          payment: { entity: { id: 'pay_rzp_999', amount: 250000, currency: 'INR' } },
          payment_link: { entity: { id: 'plink_999', notes: { invoiceNumber: 'INV-2026-001' } } },
        },
      });
      const rawBodyBuffer = Buffer.from(rawBodyString, 'utf8');
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBodyString)
        .digest('hex');

      const result = await razorpay.verifyWebhook(
        JSON.parse(rawBodyString),
        validSignature,
        secret,
        rawBodyBuffer,
      );

      expect(result.isValid).toBe(true);
      expect(result.invoiceNumber).toBe('INV-2026-001');
      expect(result.amount).toBe(2500);
      expect(result.providerPaymentId).toBe('pay_rzp_999');
    });

    it('should accept simulation signatures in non-production test mode', async () => {
      process.env.NODE_ENV = 'test';
      const result = await razorpay.verifyWebhook(
        { event: 'payment_link.paid', invoiceNumber: 'INV-TEST' },
        'mock_valid_signature',
      );
      expect(result.isValid).toBe(true);
      expect(result.invoiceNumber).toBe('INV-TEST');
    });

    it('should correctly map Razorpay failed, cancelled, and expired webhook events', async () => {
      const secret = 'rzp_whsec_test_map';
      const makePayload = (event: string) => {
        const payloadStr = JSON.stringify({
          event,
          payload: {
            payment: { entity: { id: `pay_${event}`, amount: 10000, currency: 'INR' } },
            payment_link: { entity: { id: `plink_${event}`, notes: { invoiceNumber: 'INV-EVENT-01' } } },
          },
        });
        const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
        return { payload: JSON.parse(payloadStr), sig, raw: payloadStr };
      };

      const failedEvt = makePayload('payment.failed');
      const failedRes = await razorpay.verifyWebhook(failedEvt.payload, failedEvt.sig, secret, failedEvt.raw);
      expect(failedRes.isValid).toBe(true);
      expect(failedRes.status).toBe('FAILED');

      const cancelledEvt = makePayload('payment_link.cancelled');
      const cancelledRes = await razorpay.verifyWebhook(cancelledEvt.payload, cancelledEvt.sig, secret, cancelledEvt.raw);
      expect(cancelledRes.isValid).toBe(true);
      expect(cancelledRes.status).toBe('CANCELLED');

      const expiredEvt = makePayload('payment_link.expired');
      const expiredRes = await razorpay.verifyWebhook(expiredEvt.payload, expiredEvt.sig, secret, expiredEvt.raw);
      expect(expiredRes.isValid).toBe(true);
      expect(expiredRes.status).toBe('EXPIRED');
    });
  });

  describe('Razorpay Link Generation Live vs Simulation Guard', () => {
    it('should reject live payment link generation when API credentials are missing (NEVER mock link)', async () => {
      delete process.env.PAYMENT_SIMULATION_MODE;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      await expect(
        razorpay.createPaymentLink({
          invoiceNumber: 'INV-LIVE-001',
          amount: 500,
          currency: 'INR',
        }),
      ).rejects.toThrow('Razorpay credentials (Key ID and Key Secret) are not configured');
    });

    it('should reject simulation mode in production even if simulate: true', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        razorpay.createPaymentLink(
          { invoiceNumber: 'INV-PROD-001', amount: 500, currency: 'INR' },
          { simulate: true },
        ),
      ).rejects.toThrow('Payment simulation mode is forbidden in production');
    });

    it('should generate simulated link when explicitly requested in non-production', async () => {
      process.env.NODE_ENV = 'development';
      const link = await razorpay.createPaymentLink(
        { invoiceNumber: 'INV-DEV-001', amount: 500, currency: 'INR' },
        { simulate: true },
      );
      expect(link.isSimulated).toBe(true);
      expect(link.id).toMatch(/^plink_sim_/);
      expect(link.url).toContain('rzp.io/i/mock_');
    });

    it('should reject live Razorpay key (rzp_live_*) in non-production environments (fail-closed guard)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.PAYMENT_SIMULATION_MODE;

      await expect(
        razorpay.createPaymentLink(
          { invoiceNumber: 'INV-FAIL-CLOSED', amount: 500, currency: 'INR' },
          { keyId: 'rzp_live_dangerousSecretKey123', keySecret: 'someSecretKey123' },
        ),
      ).rejects.toThrow('SAFETY GUARD: Live Razorpay credentials (rzp_live_*) cannot be used in non-production environments');
    });

    it('should reject placeholder Razorpay credentials including values containing "placeholder"', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.PAYMENT_SIMULATION_MODE;

      await expect(
        razorpay.createPaymentLink(
          {
            invoiceNumber: 'INV-PLACEHOLDER',
            amount: 500,
            currency: 'INR',
            customerName: 'Test Customer',
            customerEmail: 'test@example.com',
          },
          {
            keyId: 'rzp_test_placeholder_key_id',
            keySecret: 'placeholder_razorpay_key_secret',
          },
        ),
      ).rejects.toThrow('placeholder');
    });

    it('should reject placeholder webhook secret when verifying Razorpay webhook signature', async () => {
      process.env.NODE_ENV = 'development';
      const placeholderSecret = 'placeholder_razorpay_webhook_secret';
      const rawBody = JSON.stringify({ event: 'payment_link.paid' });
      const sig = crypto.createHmac('sha256', placeholderSecret).update(rawBody).digest('hex');

      const result = await razorpay.verifyWebhook(
        JSON.parse(rawBody),
        sig,
        placeholderSecret,
        rawBody,
      );
      expect(result.isValid).toBe(false);
    });

    it('should disable SMS and email notification flags on Razorpay payment link requests by default', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.PAYMENT_SIMULATION_MODE;
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'plink_test_notif_check',
          short_url: 'https://rzp.io/i/test123',
        }),
      });
      globalThis.fetch = fetchSpy as any;

      try {
        const res = await razorpay.createPaymentLink(
          {
            invoiceNumber: 'INV-TEST-NOTIFY',
            amount: 1500,
            currency: 'INR',
            customerName: 'Acme Buyer',
            customerEmail: 'buyer@acme.in',
            customerPhone: '+919876543210',
            tenantId: 'tenant_01',
            invoiceId: 'inv_01',
          },
          {
            keyId: 'rzp_test_1234567890abcdef',
            keySecret: 'valid_test_secret_123456',
          },
        );

        expect(res.id).toBe('plink_test_notif_check');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [, reqInit] = fetchSpy.mock.calls[0];
        const sentBody = JSON.parse(reqInit.body as string);
        expect(sentBody.notify).toEqual({ sms: false, email: false });
        expect(sentBody.reminder_enable).toBe(false);
        expect(sentBody.notes).toMatchObject({
          invoiceNumber: 'INV-TEST-NOTIFY',
          tenantId: 'tenant_01',
          invoiceId: 'inv_01',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should validate Razorpay and PAYMENT_SIMULATION_MODE env config safely without printing secrets', () => {
      const baseEnv = {
        DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/mycashflo',
        JWT_ACCESS_SECRET: '0123456789abcdef0123456789abcdef',
        JWT_REFRESH_SECRET: 'fedcba9876543210fedcba9876543210',
      };

      expect(() =>
        validateEnvironment({
          ...baseEnv,
          NODE_ENV: 'development',
          RAZORPAY_KEY_ID: 'rzp_live_sensitiveKeyValue12345',
          RAZORPAY_KEY_SECRET: 'sensitiveSecretValue',
        }),
      ).toThrow(/RAZORPAY_KEY_ID cannot use Live Mode credentials/);

      try {
        validateEnvironment({
          ...baseEnv,
          NODE_ENV: 'production',
          PAYMENT_SIMULATION_MODE: 'true',
          RAZORPAY_KEY_ID: 'rzp_live_sensitiveKeyValue12345',
          RAZORPAY_KEY_SECRET: 'sensitiveSecretValue',
          RAZORPAY_WEBHOOK_SECRET: 'sensitiveWebhookSecret',
        });
      } catch (err: any) {
        expect(err.message).toContain('PAYMENT_SIMULATION_MODE cannot be "true" in production');
        expect(err.message).not.toContain('sensitiveKeyValue12345');
        expect(err.message).not.toContain('sensitiveSecretValue');
      }
    });
  });

  describe('Stripe Webhook Verification', () => {
    it('should reject webhook in production when secret is missing', async () => {
      process.env.NODE_ENV = 'production';
      const result = await stripe.verifyWebhook(
        { type: 'checkout.session.completed' },
        't=123,v1=abc',
      );
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('FAILED');
    });

    it('should strictly reject simulation signatures in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_prod_key';

      const mockResult = await stripe.verifyWebhook(
        { type: 'checkout.session.completed' },
        'mock_valid_signature',
      );
      expect(mockResult.isValid).toBe(false);

      const simResult = await stripe.verifyWebhook(
        { type: 'checkout.session.completed' },
        'sim_stripe_sig',
      );
      expect(simResult.isValid).toBe(false);
    });

    it('should reject invalid signatures with secret configured', async () => {
      const secret = 'whsec_test_secret_999';
      const rawPayload = JSON.stringify({ type: 'checkout.session.completed' });

      const result = await stripe.verifyWebhook(
        JSON.parse(rawPayload),
        't=1700000000,v1=deadbeefdeadbeef',
        secret,
        rawPayload,
      );
      expect(result.isValid).toBe(false);
    });

    it('should reject tampered payload when raw request body bytes differ', async () => {
      const secret = 'whsec_test_secret_999';
      const timestamp = '1700000000';
      const originalRawBody = '{"id":"evt_1","data":{"object":{"amount_total":10000}}}';
      const validV1 = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${originalRawBody}`)
        .digest('hex');

      const signatureHeader = `t=${timestamp},v1=${validV1}`;

      // Modified payload (attacker tampered payload before verification)
      const tamperedRawBody = '{"id":"evt_1","data":{"object":{"amount_total":100}}}';

      const result = await stripe.verifyWebhook(
        JSON.parse(tamperedRawBody),
        signatureHeader,
        secret,
        tamperedRawBody,
      );

      expect(result.isValid).toBe(false);
    });

    it('should verify exact raw request bytes with Stripe header format (t=...,v1=...)', async () => {
      const secret = 'whsec_live_raw_bytes_secret';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const rawBody = Buffer.from(
        JSON.stringify({
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_123',
              payment_intent: 'pi_test_456',
              amount_total: 800000,
              currency: 'inr',
              metadata: { invoiceNumber: 'INV-STRIPE-001' },
            },
          },
        }),
        'utf8',
      );

      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody.toString('utf8')}`)
        .digest('hex');

      const signatureHeader = `t=${timestamp},v1=${expectedSig}`;

      const result = await stripe.verifyWebhook(
        JSON.parse(rawBody.toString('utf8')),
        signatureHeader,
        secret,
        rawBody,
      );

      expect(result.isValid).toBe(true);
      expect(result.invoiceNumber).toBe('INV-STRIPE-001');
      expect(result.amount).toBe(8000);
      expect(result.providerPaymentId).toBe('pi_test_456');
    });

    it('should verify multiple v1 signatures in Stripe header format', async () => {
      const secret = 'whsec_multi_secret';
      const timestamp = '1700000500';
      const rawBody = '{"type":"checkout.session.completed"}';
      const validSig = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      // Stripe supports key rolling, sending both old and new signatures
      const signatureHeader = `t=${timestamp},v1=old_invalid_signature,v1=${validSig}`;

      const result = await stripe.verifyWebhook(
        JSON.parse(rawBody),
        signatureHeader,
        secret,
        rawBody,
      );

      expect(result.isValid).toBe(true);
    });

    it('should accept simulation signatures in non-production test mode', async () => {
      process.env.NODE_ENV = 'test';
      const result = await stripe.verifyWebhook(
        { type: 'checkout.session.completed', invoiceNumber: 'INV-STRIPE-SIM' },
        'mock_valid_signature',
      );
      expect(result.isValid).toBe(true);
    });

    it('should correctly map Stripe failed and expired webhook events', async () => {
      const secret = 'whsec_test_map_stripe';
      const makePayload = (type: string) => {
        const payloadStr = JSON.stringify({
          type,
          data: {
            object: {
              id: `evt_${type}`,
              payment_intent: `pi_${type}`,
              amount_total: 50000,
              currency: 'usd',
              metadata: { invoiceNumber: 'INV-STRIPE-02' },
            },
          },
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${payloadStr}`).digest('hex');
        return { payload: JSON.parse(payloadStr), sigHeader: `t=${timestamp},v1=${sig}`, raw: payloadStr };
      };

      const failedEvt = makePayload('payment_intent.payment_failed');
      const failedRes = await stripe.verifyWebhook(failedEvt.payload, failedEvt.sigHeader, secret, failedEvt.raw);
      expect(failedRes.isValid).toBe(true);
      expect(failedRes.status).toBe('FAILED');

      const expiredEvt = makePayload('checkout.session.expired');
      const expiredRes = await stripe.verifyWebhook(expiredEvt.payload, expiredEvt.sigHeader, secret, expiredEvt.raw);
      expect(expiredRes.isValid).toBe(true);
      expect(expiredRes.status).toBe('EXPIRED');
    });
  });

  describe('Stripe Link Generation Live vs Simulation Guard', () => {
    it('should reject live checkout link generation when secret key is missing (NEVER mock link)', async () => {
      delete process.env.PAYMENT_SIMULATION_MODE;
      delete process.env.STRIPE_SECRET_KEY;

      await expect(
        stripe.createPaymentLink({
          invoiceNumber: 'INV-STRIPE-LIVE',
          amount: 500,
          currency: 'USD',
        }),
      ).rejects.toThrow('Stripe credentials (Secret Key) are not configured');
    });

    it('should reject simulation mode in production even if simulate: true', async () => {
      process.env.NODE_ENV = 'production';
      await expect(
        stripe.createPaymentLink(
          { invoiceNumber: 'INV-STRIPE-PROD', amount: 500, currency: 'USD' },
          { simulate: true },
        ),
      ).rejects.toThrow('Payment simulation mode is forbidden in production');
    });

    it('should generate simulated link when explicitly requested in non-production', async () => {
      process.env.NODE_ENV = 'development';
      const link = await stripe.createPaymentLink(
        { invoiceNumber: 'INV-STRIPE-DEV', amount: 500, currency: 'USD' },
        { simulate: true },
      );
      expect(link.isSimulated).toBe(true);
      expect(link.id).toMatch(/^cs_sim_/);
      expect(link.url).toContain('checkout.stripe.com/c/pay/cs_sim_');
    });
  });

  describe('Razorpay Orders API, Checkout Signature & Event Mapping', () => {
    const originalRzpKeyId = process.env.RAZORPAY_KEY_ID;
    const originalRzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const originalPaymentSim = process.env.PAYMENT_SIMULATION_MODE;

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalRzpKeyId !== undefined) process.env.RAZORPAY_KEY_ID = originalRzpKeyId;
      else delete process.env.RAZORPAY_KEY_ID;
      if (originalRzpKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = originalRzpKeySecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
      if (originalPaymentSim !== undefined) process.env.PAYMENT_SIMULATION_MODE = originalPaymentSim;
      else delete process.env.PAYMENT_SIMULATION_MODE;
    });

    it('should create a Razorpay Order via Orders API with paise conversion and never expose keySecret', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.PAYMENT_SIMULATION_MODE;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order_Test123456',
          amount: 250050,
          currency: 'INR',
          receipt: 'INV-2026-01',
          status: 'created',
        }),
      } as any);

      const order = await razorpay.createOrder(
        {
          amount: 2500.5,
          currency: 'INR',
          receipt: 'INV-2026-01',
          invoiceNumber: 'INV-2026-01',
          invoiceId: 'inv_1',
          tenantId: 'tenant_1',
        },
        {
          keyId: 'rzp_test_unit_key',
          keySecret: 'rzp_test_unit_secret_xyz',
          webhookSecret: 'rzp_whsec_unit_xyz',
        },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.razorpay.com/v1/orders');
      expect((init as any).method).toBe('POST');
      const sentBody = JSON.parse((init as any).body);
      expect(sentBody.amount).toBe(250050);
      expect(sentBody.currency).toBe('INR');
      expect(sentBody.notes?.invoiceNumber).toBe('INV-2026-01');

      expect(order.id).toBe('order_Test123456');
      expect(order.keyId).toBe('rzp_test_unit_key');
      expect(order.amountInPaise).toBe(250050);
      expect(order.isSimulated).toBe(false);
      expect(JSON.stringify(order)).not.toContain('rzp_test_unit_secret_xyz');
      expect(JSON.stringify(order)).not.toContain('rzp_whsec_unit_xyz');
    });

    it('should reject createOrder when credentials are missing/placeholder or using rzp_live_ in non-prod', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.PAYMENT_SIMULATION_MODE;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      await expect(
        razorpay.createOrder({
          amount: 500,
          currency: 'INR',
          receipt: 'INV-1',
          invoiceNumber: 'INV-1',
          invoiceId: 'inv_1',
          tenantId: 'tenant_1',
        }),
      ).rejects.toThrow('Razorpay credentials (Key ID and Key Secret) are not configured');

      await expect(
        razorpay.createOrder(
          {
            amount: 500,
            currency: 'INR',
            receipt: 'INV-1',
            invoiceNumber: 'INV-1',
            invoiceId: 'inv_1',
            tenantId: 'tenant_1',
          },
          { keyId: 'rzp_live_blocked', keySecret: 'secret_live_123' },
        ),
      ).rejects.toThrow('Live Razorpay credentials (rzp_live_*) cannot be used in non-production environments');
    });

    it('should allow explicit simulated order only in non-production and reject simulation in production', async () => {
      process.env.NODE_ENV = 'development';
      const simOrder = await razorpay.createOrder(
        {
          amount: 1200,
          currency: 'INR',
          receipt: 'INV-SIM-01',
          invoiceNumber: 'INV-SIM-01',
          invoiceId: 'inv_sim',
          tenantId: 'tenant_1',
        },
        { simulate: true },
      );
      expect(simOrder.isSimulated).toBe(true);
      expect(simOrder.id).toMatch(/^order_sim_/);
      expect(simOrder.amountInPaise).toBe(120000);

      process.env.NODE_ENV = 'production';
      await expect(
        razorpay.createOrder(
          {
            amount: 1200,
            currency: 'INR',
            receipt: 'INV-SIM-01',
            invoiceNumber: 'INV-SIM-01',
            invoiceId: 'inv_sim',
            tenantId: 'tenant_1',
          },
          { simulate: true },
        ),
      ).rejects.toThrow('Payment simulation mode is forbidden in production');
    });

    it('should verify Checkout HMAC-SHA256 signatures strictly and reject tampered or wrong-secret signatures', () => {
      process.env.NODE_ENV = 'test';
      const secret = 'rzp_test_checkout_secret_999';
      const orderId = 'order_ABC123';
      const paymentId = 'pay_XYZ789';
      const validSig = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      expect(
        razorpay.verifyCheckoutSignature({
          orderId,
          paymentId,
          signature: validSig,
          secret,
        }),
      ).toBe(true);

      expect(
        razorpay.verifyCheckoutSignature({
          orderId,
          paymentId,
          signature: 'tampered_sig',
          secret,
        }),
      ).toBe(false);

      expect(
        razorpay.verifyCheckoutSignature({
          orderId,
          paymentId,
          signature: validSig,
          secret: 'wrong_secret_000',
        }),
      ).toBe(false);

      expect(
        razorpay.verifyCheckoutSignature({
          orderId,
          paymentId,
          signature: 'mock_valid_signature',
          secret,
        }),
      ).toBe(false);
    });

    it('should fetch payment details from Razorpay /v1/payments/:id', async () => {
      process.env.NODE_ENV = 'test';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pay_RzpFetch1',
          order_id: 'order_Test123456',
          amount: 100000,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        }),
      } as any);

      const details = await razorpay.fetchPayment('pay_RzpFetch1', {
        keyId: 'rzp_test_unit_key',
        keySecret: 'rzp_test_unit_secret_xyz',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.razorpay.com/v1/payments/pay_RzpFetch1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(details.order_id).toBe('order_Test123456');
      expect(details.status).toBe('captured');
      expect(details.amount).toBe(100000);
    });

    it('should extract providerOrderId and map order.paid, payment.authorized, and payment.failed webhooks', async () => {
      const secret = 'rzp_whsec_orders_map';

      const signEvt = (body: Record<string, any>) => {
        const raw = JSON.stringify(body);
        const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        return { body, sig, raw };
      };

      const orderPaid = signEvt({
        event: 'order.paid',
        payload: {
          order: { entity: { id: 'order_Paid1', amount: 500000, currency: 'INR', receipt: 'INV-1' } },
          payment: { entity: { id: 'pay_OrderPaid1', order_id: 'order_Paid1', amount: 500000, currency: 'INR' } },
        },
      });
      const paidRes = await razorpay.verifyWebhook(orderPaid.body, orderPaid.sig, secret, orderPaid.raw);
      expect(paidRes.isValid).toBe(true);
      expect(paidRes.status).toBe('COMPLETED');
      expect(paidRes.providerOrderId).toBe('order_Paid1');
      expect(paidRes.providerPaymentId).toBe('pay_OrderPaid1');
      expect(paidRes.amount).toBe(5000);

      const authEvt = signEvt({
        event: 'payment.authorized',
        payload: {
          payment: { entity: { id: 'pay_Auth1', order_id: 'order_Auth1', amount: 300000, currency: 'INR' } },
        },
      });
      const authRes = await razorpay.verifyWebhook(authEvt.body, authEvt.sig, secret, authEvt.raw);
      expect(authRes.isValid).toBe(true);
      expect(authRes.status).toBe('PENDING');
      expect(authRes.providerOrderId).toBe('order_Auth1');
    });

    it('should reject partial tenant key configuration (never mix tenant keyId with global env secret)', async () => {
      process.env.NODE_ENV = 'test';
      process.env.RAZORPAY_KEY_ID = 'rzp_test_global_id';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_test_global_secret';

      await expect(
        razorpay.createOrder(
          {
            amount: 500,
            currency: 'INR',
            receipt: 'INV-MIX-1',
            invoiceNumber: 'INV-MIX-1',
            invoiceId: 'inv_mix',
            tenantId: 'tenant_mix',
          },
          { keyId: 'rzp_test_only_tenant_id' },
        ),
      ).rejects.toThrow('Incomplete tenant Razorpay configuration');
    });

    it('should map refund.created, refund.processed, and refund.failed using refund amount', async () => {
      const secret = 'rzp_whsec_refunds_map';
      const signEvt = (body: Record<string, any>) => {
        const raw = JSON.stringify(body);
        const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        return { body, sig, raw };
      };

      const createdEvt = signEvt({
        event: 'refund.created',
        payload: {
          refund: { entity: { id: 'rfnd_Cr1', payment_id: 'pay_Orig1', amount: 350000, currency: 'INR', status: 'pending' } },
          payment: { entity: { id: 'pay_Orig1', amount: 1000000, currency: 'INR' } },
        },
      });
      const createdRes = await razorpay.verifyWebhook(createdEvt.body, createdEvt.sig, secret, createdEvt.raw);
      expect(createdRes.status).toBe('REFUND_PENDING');
      expect(createdRes.providerRefundId).toBe('rfnd_Cr1');
      expect(createdRes.providerPaymentId).toBe('pay_Orig1');
      expect(createdRes.amount).toBe(3500);

      const procEvt = signEvt({
        event: 'refund.processed',
        payload: {
          refund: { entity: { id: 'rfnd_Pr1', payment_id: 'pay_Orig1', amount: 400000, currency: 'INR', status: 'processed' } },
        },
      });
      const procRes = await razorpay.verifyWebhook(procEvt.body, procEvt.sig, secret, procEvt.raw);
      expect(procRes.status).toBe('REFUND_PROCESSED');
      expect(procRes.providerRefundId).toBe('rfnd_Pr1');
      expect(procRes.amount).toBe(4000);

      const failEvt = signEvt({
        event: 'refund.failed',
        payload: {
          refund: { entity: { id: 'rfnd_Fl1', payment_id: 'pay_Orig1', amount: 400000, currency: 'INR', status: 'failed' } },
        },
      });
      const failRes = await razorpay.verifyWebhook(failEvt.body, failEvt.sig, secret, failEvt.raw);
      expect(failRes.status).toBe('REFUND_FAILED');
      expect(failRes.providerRefundId).toBe('rfnd_Fl1');
    });

    it('should surface HTTP non-2xx and network failures cleanly and support fetchOrderByReceipt & fetchPaymentRefunds', async () => {
      process.env.NODE_ENV = 'test';
      const creds = { keyId: 'rzp_test_http', keySecret: 'rzp_test_http_secret' };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { description: 'Currency not supported' } }),
      } as any);
      await expect(
        razorpay.createOrder(
          {
            amount: 500,
            currency: 'INR',
            receipt: 'rcpt_err_400',
            invoiceNumber: 'INV-ERR',
            invoiceId: 'inv_err',
            tenantId: 't_err',
          },
          creds,
        ),
      ).rejects.toThrow('Razorpay Orders API error (400): Currency not supported');

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(razorpay.fetchPayment('pay_net_err', creds)).rejects.toThrow(
        'Razorpay gateway connection failed: ECONNRESET',
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: 'order_Rec1', amount: 50000, currency: 'INR', receipt: 'rcpt_match', status: 'created' }],
        }),
      } as any);
      const foundOrder = await razorpay.fetchOrderByReceipt('rcpt_match', creds);
      expect(foundOrder?.id).toBe('order_Rec1');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: 'rfnd_List1', payment_id: 'pay_1', amount: 50000, currency: 'INR', status: 'processed' }],
        }),
      } as any);
      const refunds = await razorpay.fetchPaymentRefunds('pay_1', creds);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].id).toBe('rfnd_List1');
      expect(refunds[0].status).toBe('processed');
    });
  });
});

