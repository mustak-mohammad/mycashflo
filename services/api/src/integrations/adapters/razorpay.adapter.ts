import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  PaymentProviderAdapter,
  CreatePaymentLinkInput,
  PaymentLinkOutput,
  WebhookVerificationResult,
} from '../interfaces/payment-provider.interface.js';

export interface RazorpayAdapterConfig {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  isLive?: boolean;
  simulate?: boolean;
}

@Injectable()
export class RazorpayAdapter implements PaymentProviderAdapter {
  private readonly logger = new Logger(RazorpayAdapter.name);

  async createPaymentLink(
    input: CreatePaymentLinkInput,
    config?: RazorpayAdapterConfig,
  ): Promise<PaymentLinkOutput> {
    const isProd = process.env.NODE_ENV === 'production';
    const keyId = config?.keyId || process.env.RAZORPAY_KEY_ID;
    const keySecret = config?.keySecret || process.env.RAZORPAY_KEY_SECRET;

    // Simulation is strictly prohibited in production, and allowed in non-production
    // ONLY when explicitly enabled via config.simulate === true or process.env.PAYMENT_SIMULATION_MODE === 'true'.
    if (isProd && config?.simulate === true) {
      throw new BadRequestException('Payment simulation mode is forbidden in production');
    }

    const explicitSimulationRequested =
      !isProd && (config?.simulate === true || process.env.PAYMENT_SIMULATION_MODE === 'true');

    if (explicitSimulationRequested) {
      const linkId = `plink_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const simulatedUrl = `https://rzp.io/i/mock_${linkId}`;
      return {
        id: linkId,
        provider: 'RAZORPAY',
        url: simulatedUrl,
        amount: Number(input.amount),
        currency: input.currency || 'INR',
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

    // Live mode (or default non-simulated mode): strictly require valid credentials
    if (!keyId || !keySecret || keyId.includes('mock') || keyId.includes('test_dummy')) {
      throw new BadRequestException(
        'Razorpay credentials (Key ID and Key Secret) are not configured. Cannot generate live payment link.',
      );
    }

    const amountInPaise = Math.round(Number(input.amount) * 100);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: input.currency || 'INR',
          accept_partial: false,
          description: input.description || `Payment for Invoice ${input.invoiceNumber}`,
          customer: {
            name: input.customerName,
            email: input.customerEmail,
            contact: input.customerPhone,
          },
          notify: {
            sms: Boolean(input.customerPhone),
            email: Boolean(input.customerEmail),
          },
          reminder_enable: true,
          notes: {
            invoiceNumber: input.invoiceNumber,
            source: 'myCashflo',
          },
          callback_url: input.callbackUrl,
          callback_method: 'get',
        }),
      });
    } catch (err: any) {
      this.logger.error(`Razorpay live connection error: ${err.message}`);
      throw new BadRequestException(`Razorpay gateway connection failed: ${err.message}`);
    }

    if (!response.ok) {
      let errDetails = response.statusText;
      try {
        const errJson = (await response.json()) as any;
        errDetails = errJson?.error?.description || errJson?.error?.code || JSON.stringify(errJson);
      } catch {}
      this.logger.warn(`Razorpay API error (${response.status}): ${errDetails}`);
      throw new BadRequestException(`Razorpay API error (${response.status}): ${errDetails}`);
    }

    const data = (await response.json()) as any;
    return {
      id: data.id,
      provider: 'RAZORPAY',
      url: data.short_url,
      amount: Number(input.amount),
      currency: input.currency || 'INR',
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
    const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET;

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
      this.logger.warn('Razorpay webhook secret is not configured in production environment');
      return {
        isValid: false,
        event: 'unknown',
        status: 'FAILED',
      };
    }

    let isValid = false;
    const bodyToVerify =
      rawBody !== undefined
        ? (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody))
        : (typeof payload === 'string' ? payload : JSON.stringify(payload));

    if (signature && webhookSecret) {
      try {
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(bodyToVerify)
          .digest('hex');

        const sigBuf = Buffer.from(signature, 'utf8');
        const expBuf = Buffer.from(expectedSignature, 'utf8');

        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          isValid = true;
        }
      } catch (err) {
        this.logger.debug(`Razorpay HMAC calculation error: ${(err as Error).message}`);
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

    const event = eventData?.event || 'payment_link.paid';
    const paymentEntity = eventData?.payload?.payment?.entity || eventData?.payment || {};
    const linkEntity = eventData?.payload?.payment_link?.entity || eventData?.payment_link || {};

    const amount = paymentEntity.amount
      ? Number(paymentEntity.amount) / 100
      : (linkEntity.amount ? Number(linkEntity.amount) / 100 : undefined);
    const invoiceNumber =
      linkEntity.notes?.invoiceNumber ||
      paymentEntity.notes?.invoiceNumber ||
      eventData?.invoiceNumber;

    let status: 'COMPLETED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED' = 'PENDING';
    if (event === 'payment_link.paid' || event === 'payment.captured') {
      status = 'COMPLETED';
    } else if (event === 'payment.failed') {
      status = 'FAILED';
    } else if (event === 'payment_link.cancelled') {
      status = 'CANCELLED';
    } else if (event === 'payment_link.expired') {
      status = 'EXPIRED';
    }

    return {
      isValid,
      event,
      providerPaymentId: paymentEntity.id || (eventData?.paymentId ? String(eventData.paymentId) : undefined),
      paymentLinkId: linkEntity.id || eventData?.paymentLinkId,
      invoiceNumber,
      amount,
      currency: paymentEntity.currency || linkEntity.currency || 'INR',
      status,
      metadata: eventData?.notes || linkEntity.notes || paymentEntity.notes || {},
      rawPayload: eventData,
    };
  }
}
