import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  PaymentProviderAdapter,
  CreatePaymentLinkInput,
  PaymentLinkOutput,
  WebhookVerificationResult,
} from '../interfaces/payment-provider.interface.js';

export interface StripeAdapterConfig {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  isLive?: boolean;
  simulate?: boolean;
}

@Injectable()
export class StripeAdapter implements PaymentProviderAdapter {
  private readonly logger = new Logger(StripeAdapter.name);

  async createPaymentLink(
    input: CreatePaymentLinkInput,
    config?: StripeAdapterConfig,
  ): Promise<PaymentLinkOutput> {
    const isProd = process.env.NODE_ENV === 'production';
    const secretKey = config?.secretKey || process.env.STRIPE_SECRET_KEY;

    // Simulation is strictly prohibited in production, and allowed in non-production
    // ONLY when explicitly enabled via config.simulate === true or process.env.PAYMENT_SIMULATION_MODE === 'true'.
    if (isProd && config?.simulate === true) {
      throw new BadRequestException('Payment simulation mode is forbidden in production');
    }

    const explicitSimulationRequested =
      !isProd && (config?.simulate === true || process.env.PAYMENT_SIMULATION_MODE === 'true');

    if (explicitSimulationRequested) {
      const sessionId = `cs_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const simulatedUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
      return {
        id: sessionId,
        provider: 'STRIPE',
        url: simulatedUrl,
        amount: Number(input.amount),
        currency: (input.currency || 'INR').toUpperCase(),
        status: 'CREATED',
        isSimulated: true,
        raw: {
          simulated: true,
          referenceId: input.invoiceNumber,
          customerName: input.customerName,
          createdAt: new Date().toISOString(),
        },
      };
    }

    // Live mode (or default non-simulated mode): require valid credentials
    if (!secretKey || secretKey.includes('mock') || secretKey.includes('test_dummy')) {
      throw new BadRequestException(
        'Stripe credentials (Secret Key) are not configured. Cannot generate live payment link.',
      );
    }

    const unitAmount = Math.round(Number(input.amount) * 100);

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price_data][currency]', (input.currency || 'INR').toLowerCase());
    params.append('line_items[0][price_data][product_data][name]', `Invoice ${input.invoiceNumber}`);
    params.append('line_items[0][price_data][product_data][description]', input.description || `Payment for Invoice ${input.invoiceNumber}`);
    params.append('line_items[0][price_data][unit_amount]', String(unitAmount));
    params.append('line_items[0][quantity]', '1');
    params.append('mode', 'payment');
    params.append('customer_email', input.customerEmail);
    params.append('client_reference_id', input.invoiceNumber);
    params.append('metadata[invoiceNumber]', input.invoiceNumber);
    params.append('metadata[source]', 'myCashflo');
    params.append('success_url', input.callbackUrl || 'https://mycashflo.internal/payments/success');
    params.append('cancel_url', input.callbackUrl || 'https://mycashflo.internal/payments/cancelled');

    let response: Response;
    try {
      response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${secretKey}`,
        },
        body: params.toString(),
      });
    } catch (err: any) {
      this.logger.error(`Stripe live connection error: ${err.message}`);
      throw new BadRequestException(`Stripe gateway connection failed: ${err.message}`);
    }

    if (!response.ok) {
      let errDetails = response.statusText;
      try {
        const errJson = (await response.json()) as any;
        errDetails = errJson?.error?.message || errJson?.error?.type || JSON.stringify(errJson);
      } catch {}
      this.logger.warn(`Stripe API error (${response.status}): ${errDetails}`);
      throw new BadRequestException(`Stripe API error (${response.status}): ${errDetails}`);
    }

    const data = (await response.json()) as any;
    return {
      id: data.id,
      provider: 'STRIPE',
      url: data.url,
      amount: Number(input.amount),
      currency: (input.currency || 'INR').toUpperCase(),
      status: 'CREATED',
      isSimulated: false,
      raw: data,
    };
  }

  async verifyWebhook(
    payload: any,
    signature: string,
    secret?: string,
    rawBody?: Buffer | string,
  ): Promise<WebhookVerificationResult> {
    const isProd = process.env.NODE_ENV === 'production';
    const webhookSecret = secret || process.env.STRIPE_WEBHOOK_SECRET;

    // Simulation signatures are strictly prohibited in production
    const isSimulationSignature = signature === 'mock_valid_signature' || signature?.startsWith('sim_');
    if (isProd && isSimulationSignature) {
      this.logger.warn('Simulation webhook signature rejected in production environment');
      return {
        isValid: false,
        event: 'unknown',
        status: 'FAILED',
      };
    }

    // In production, reject immediately if webhook secret is not configured
    if (isProd && !webhookSecret) {
      this.logger.warn('Stripe webhook secret is not configured in production environment');
      return {
        isValid: false,
        event: 'unknown',
        status: 'FAILED',
      };
    }

    let isValid = false;

    if (signature && webhookSecret) {
      try {
        // Stripe uses timestamped HMAC signatures: t=timestamp,v1=signature
        const parts = signature.split(',').reduce(
          (acc, part) => {
            const [k, v] = part.split('=');
            if (k && v) acc[k.trim()] = v.trim();
            return acc;
          },
          {} as Record<string, string>,
        );

        const timestamp = parts['t'];
        const v1Signature = parts['v1'] || signature;

        // Use exact raw body payload to guarantee cryptographic match
        const payloadString =
          rawBody !== undefined
            ? (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody))
            : (typeof payload === 'string' ? payload : JSON.stringify(payload));

        const signedPayload = timestamp ? `${timestamp}.${payloadString}` : payloadString;

        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(signedPayload)
          .digest('hex');

        const sigBuf = Buffer.from(v1Signature, 'utf8');
        const expBuf = Buffer.from(expectedSignature, 'utf8');

        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          isValid = true;
        }
      } catch (err) {
        this.logger.debug(`Stripe HMAC calculation error: ${(err as Error).message}`);
      }
    }

    // Allow mock/simulation signature only in explicit non-production/test environments
    if (!isValid && !isProd && isSimulationSignature) {
      isValid = true;
    }

    let eventData: any = payload;
    if (typeof payload === 'string') {
      try {
        eventData = JSON.parse(payload);
      } catch {
        eventData = {};
      }
    }

    const event = eventData?.type || 'checkout.session.completed';
    const sessionObj = eventData?.data?.object || eventData?.session || {};

    const amount = sessionObj.amount_total ? Number(sessionObj.amount_total) / 100 : undefined;
    const invoiceNumber =
      sessionObj.metadata?.invoiceNumber ||
      sessionObj.client_reference_id ||
      eventData?.invoiceNumber;

    let status: 'COMPLETED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED' = 'PENDING';
    if (event === 'checkout.session.completed' || event === 'payment_intent.succeeded') {
      status = 'COMPLETED';
    } else if (event === 'payment_intent.payment_failed') {
      status = 'FAILED';
    } else if (event === 'checkout.session.expired') {
      status = 'EXPIRED';
    }

    return {
      isValid,
      event,
      providerPaymentId: sessionObj.payment_intent || sessionObj.id || `pi_${Date.now()}`,
      paymentLinkId: sessionObj.id || eventData?.paymentLinkId,
      invoiceNumber,
      amount,
      currency: (sessionObj.currency || 'INR').toUpperCase(),
      status,
      metadata: sessionObj.metadata || {},
      rawPayload: eventData,
    };
  }
}
