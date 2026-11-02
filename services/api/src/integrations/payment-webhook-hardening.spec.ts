import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';

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
});

