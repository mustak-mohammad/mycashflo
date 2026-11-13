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

export interface CreateRazorpayOrderInput {
  amount: number;
  currency: string;
  receipt: string;
  invoiceNumber: string;
  invoiceId: string;
  tenantId: string;
}

export interface RazorpayOrderOutput {
  id: string;
  provider: 'RAZORPAY';
  keyId: string;
  amount: number;
  amountInPaise: number;
  currency: string;
  receipt: string;
  status: string;
  isSimulated: boolean;
  raw?: Record<string, any>;
}

export interface RazorpayPaymentDetails {
  id: string;
  order_id?: string | null;
  amount: number;
  amount_refunded?: number;
  refund_status?: string | null;
  currency: string;
  status: string;
  method?: string;
}

export interface RazorpayRefundDetails {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
}

export function isPlaceholderCredential(value?: unknown): boolean {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('placeholder') ||
    lower.startsWith('your_') ||
    lower.includes('mock') ||
    lower.includes('test_dummy') ||
    lower === 'changeme'
  );
}

/**
 * Resolves a cohesive (keyId, keySecret) pair from either tenant config OR global env.
 * Never mixes one field from tenant config with another field from global env.
 */
export function resolveRazorpayKeyPair(config?: { keyId?: unknown; keySecret?: unknown }): {
  keyId: string;
  keySecret: string;
  source: 'tenant' | 'partial_tenant' | 'env' | 'none';
} {
  const tenantKeyId = typeof config?.keyId === 'string' ? config.keyId.trim() : '';
  const tenantKeySecret = typeof config?.keySecret === 'string' ? config.keySecret.trim() : '';

  if (tenantKeyId || tenantKeySecret) {
    return {
      keyId: tenantKeyId,
      keySecret: tenantKeySecret,
      source: tenantKeyId && tenantKeySecret ? 'tenant' : 'partial_tenant',
    };
  }

  const envKeyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const envKeySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  return {
    keyId: envKeyId,
    keySecret: envKeySecret,
    source: envKeyId || envKeySecret ? 'env' : 'none',
  };
}

@Injectable()
export class RazorpayAdapter implements PaymentProviderAdapter {
  private readonly logger = new Logger(RazorpayAdapter.name);

  isSimulationEnabled(simulateFlag?: boolean): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && (simulateFlag === true || process.env.PAYMENT_SIMULATION_MODE === 'true')) {
      throw new BadRequestException('Payment simulation mode is forbidden in production');
    }
    return !isProd && (simulateFlag === true || process.env.PAYMENT_SIMULATION_MODE === 'true');
  }

  private isExplicitSimulationAllowed(config?: RazorpayAdapterConfig): boolean {
    return this.isSimulationEnabled(config?.simulate);
  }

  validateCredentials(config?: RazorpayAdapterConfig): {
    keyId: string;
    keySecret: string;
    isProd: boolean;
  } {
    return this.resolveValidatedCredentials(config);
  }

  private resolveValidatedCredentials(config?: RazorpayAdapterConfig): {
    keyId: string;
    keySecret: string;
    isProd: boolean;
  } {
    const isProd = process.env.NODE_ENV === 'production';
    const pair = resolveRazorpayKeyPair(config);

    if (pair.source === 'partial_tenant') {
      throw new BadRequestException(
        'Incomplete tenant Razorpay configuration: both Key ID and Key Secret must be provided together.',
      );
    }

    const { keyId, keySecret } = pair;

    if (!isProd && keyId.startsWith('rzp_live_')) {
      this.logger.error(
        'SAFETY GUARD: Blocked attempt to use live Razorpay key in non-production environment.',
      );
      throw new BadRequestException(
        'SAFETY GUARD: Live Razorpay credentials (rzp_live_*) cannot be used in non-production environments. Please use a test key (rzp_test_*).',
      );
    }

    if (isPlaceholderCredential(keyId) || isPlaceholderCredential(keySecret)) {
      throw new BadRequestException(
        'Razorpay credentials (Key ID and Key Secret) are not configured or use placeholder values.',
      );
    }

    if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
      throw new BadRequestException(
        'Invalid Razorpay Key ID format. Expected rzp_test_* or rzp_live_*.',
      );
    }

    return { keyId, keySecret, isProd };
  }

  async createOrder(
    input: CreateRazorpayOrderInput,
    config?: RazorpayAdapterConfig,
  ): Promise<RazorpayOrderOutput> {
    const amountInPaise = Math.round(Number(input.amount) * 100);
    if (!Number.isFinite(amountInPaise) || amountInPaise < 100) {
      throw new BadRequestException('Razorpay order amount must be at least 1.00 unit (100 paise)');
    }

    const currency = (input.currency || 'INR').trim().toUpperCase();
    const receipt = input.receipt.slice(0, 40);

    if (this.isExplicitSimulationAllowed(config)) {
      const pair = resolveRazorpayKeyPair(config);
      if (pair.source === 'partial_tenant') {
        throw new BadRequestException(
          'Incomplete tenant Razorpay configuration: both Key ID and Key Secret must be provided together.',
        );
      }
      const simKeyId = pair.keyId;
      const safeKeyId =
        !isPlaceholderCredential(simKeyId) && simKeyId.startsWith('rzp_test_')
          ? simKeyId
          : 'rzp_test_simulation';
      const orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        id: orderId,
        provider: 'RAZORPAY',
        keyId: safeKeyId,
        amount: Number(input.amount),
        amountInPaise,
        currency,
        receipt,
        status: 'created',
        isSimulated: true,
        raw: { simulated: true, receipt, createdAt: new Date().toISOString() },
      };
    }

    const { keyId, keySecret } = this.resolveValidatedCredentials(config);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency,
          receipt,
          notes: {
            invoiceNumber: input.invoiceNumber,
            invoiceId: input.invoiceId,
            tenantId: input.tenantId,
            source: 'myCashflo',
          },
        }),
      });
    } catch (err: any) {
      this.logger.error(`Razorpay order creation connection error: ${err.message}`);
      throw new BadRequestException(`Razorpay gateway connection failed: ${err.message}`);
    }

    if (!response.ok) {
      let errDetails = response.statusText;
      try {
        const errJson = (await response.json()) as any;
        errDetails = errJson?.error?.description || errJson?.error?.code || JSON.stringify(errJson);
      } catch {}
      this.logger.warn(`Razorpay Orders API error (${response.status}): ${errDetails}`);
      throw new BadRequestException(`Razorpay Orders API error (${response.status}): ${errDetails}`);
    }

    const data = (await response.json()) as any;
    return {
      id: data.id,
      provider: 'RAZORPAY',
      keyId,
      amount: Number(data.amount ? Number(data.amount) / 100 : input.amount),
      amountInPaise: Number(data.amount ?? amountInPaise),
      currency: String(data.currency || currency).toUpperCase(),
      receipt: String(data.receipt || receipt),
      status: String(data.status || 'created'),
      isSimulated: false,
      raw: data,
    };
  }

  verifyCheckoutSignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
    secret?: string;
    allowSimulation?: boolean;
  }): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    const orderId = (params.orderId || '').trim();
    const paymentId = (params.paymentId || '').trim();
    const signature = (params.signature || '').trim();
    const keySecret = (params.secret ?? process.env.RAZORPAY_KEY_SECRET ?? '').trim();

    if (!orderId || !paymentId || !signature) {
      return false;
    }

    const isSimulationSig = signature === 'mock_valid_signature' || signature.startsWith('sim_');
    if (isProd && (isSimulationSig || params.allowSimulation === true)) {
      return false;
    }

    if (
      !isProd &&
      isSimulationSig &&
      orderId.startsWith('order_sim_') &&
      (params.allowSimulation === true ||
        (!params.secret && process.env.PAYMENT_SIMULATION_MODE === 'true'))
    ) {
      return true;
    }

    if (isPlaceholderCredential(keySecret)) {
      return false;
    }

    try {
      const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  private async fetchRazorpayJson<T = any>(
    url: string,
    config?: RazorpayAdapterConfig,
    contextLabel = 'API',
  ): Promise<T> {
    const { keyId, keySecret } = this.resolveValidatedCredentials(config);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });
    } catch (err: any) {
      this.logger.error(`Razorpay ${contextLabel} connection error: ${err.message}`);
      throw new BadRequestException(`Razorpay gateway connection failed: ${err.message}`);
    }

    if (!response.ok) {
      let errDetails = response.statusText;
      try {
        const errJson = (await response.json()) as any;
        errDetails = errJson?.error?.description || errJson?.error?.code || JSON.stringify(errJson);
      } catch {}
      this.logger.warn(`Razorpay ${contextLabel} error (${response.status}): ${errDetails}`);
      throw new BadRequestException(`Razorpay API error (${response.status}): ${errDetails}`);
    }

    return (await response.json()) as T;
  }

  async fetchOrderByReceipt(
    receipt: string,
    config?: RazorpayAdapterConfig,
  ): Promise<RazorpayOrderOutput | null> {
    const cleanReceipt = (receipt || '').trim();
    if (!cleanReceipt) {
      return null;
    }
    const { keyId } = this.resolveValidatedCredentials(config);
    const data = await this.fetchRazorpayJson<any>(
      `https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(cleanReceipt)}&count=5`,
      config,
      'Orders lookup by receipt',
    );
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const matched = items.find((item) => item?.receipt === cleanReceipt);
    if (!matched?.id) {
      return null;
    }
    return {
      id: String(matched.id),
      provider: 'RAZORPAY',
      keyId,
      amount: Number(matched.amount ? Number(matched.amount) / 100 : 0),
      amountInPaise: Number(matched.amount || 0),
      currency: String(matched.currency || 'INR').toUpperCase(),
      receipt: String(matched.receipt || cleanReceipt),
      status: String(matched.status || 'created'),
      isSimulated: false,
      raw: matched,
    };
  }

  async fetchPayment(
    paymentId: string,
    config?: RazorpayAdapterConfig,
  ): Promise<RazorpayPaymentDetails> {
    const cleanPaymentId = (paymentId || '').trim();
    if (!cleanPaymentId) {
      throw new BadRequestException('Razorpay payment ID is required');
    }

    const data = await this.fetchRazorpayJson<any>(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(cleanPaymentId)}`,
      config,
      'Payment fetch',
    );
    return {
      id: String(data.id),
      order_id: data.order_id ? String(data.order_id) : null,
      amount: Number(data.amount),
      amount_refunded:
        data.amount_refunded !== undefined ? Number(data.amount_refunded) : undefined,
      refund_status: data.refund_status ? String(data.refund_status) : null,
      currency: String(data.currency || '').toUpperCase(),
      status: String(data.status || '').toLowerCase(),
      method: data.method ? String(data.method) : undefined,
    };
  }

  async fetchPaymentRefunds(
    paymentId: string,
    config?: RazorpayAdapterConfig,
  ): Promise<RazorpayRefundDetails[]> {
    const cleanPaymentId = (paymentId || '').trim();
    if (!cleanPaymentId) {
      return [];
    }
    const data = await this.fetchRazorpayJson<any>(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(cleanPaymentId)}/refunds`,
      config,
      'Payment refunds fetch',
    );
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    return items.map((item) => ({
      id: String(item.id),
      payment_id: String(item.payment_id || cleanPaymentId),
      amount: Number(item.amount),
      currency: String(item.currency || 'INR').toUpperCase(),
      status: String(item.status || '').toLowerCase(),
    }));
  }

  async createPaymentLink(
    input: CreatePaymentLinkInput,
    config?: RazorpayAdapterConfig,
  ): Promise<PaymentLinkOutput> {
    if (this.isExplicitSimulationAllowed(config)) {
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

    const { keyId, keySecret, isProd } = this.resolveValidatedCredentials(config);

    const amountInPaise = Math.round(Number(input.amount) * 100);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    // Never send Razorpay SMS/email notifications in dev/test or unless explicitly permitted by prod flags
    const allowExternalNotifications =
      isProd &&
      process.env.EMAIL_DELIVERY_ENABLED === 'true' &&
      input.notifyCustomer === true;

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
            sms: allowExternalNotifications && Boolean(input.customerPhone),
            email: allowExternalNotifications && Boolean(input.customerEmail),
          },
          reminder_enable: false,
          notes: {
            invoiceNumber: input.invoiceNumber,
            ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
            ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            source: 'myCashflo',
          },
          callback_url: input.callbackUrl,
          callback_method: 'get',
        }),
      });
    } catch (err: any) {
      this.logger.error(`Razorpay gateway connection error: ${err.message}`);
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
    const webhookSecret = (secret || process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    const hasValidSecret = !isPlaceholderCredential(webhookSecret);

    // Simulation signatures are strictly prohibited in production
    const isSimulationSignature =
      signature === 'mock_valid_signature' || Boolean(signature?.startsWith('sim_'));
    if (isProd && isSimulationSignature) {
      this.logger.warn('Simulation webhook signature rejected in production environment');
      return {
        isValid: false,
        event: 'unknown',
        status: 'FAILED',
      };
    }

    // In production, or whenever no valid secret is configured outside explicit simulation, fail closed
    if (isProd && !hasValidSecret) {
      this.logger.warn('Razorpay webhook secret is missing or placeholder in production environment');
      return {
        isValid: false,
        event: 'unknown',
        status: 'FAILED',
      };
    }

    let isValid = false;
    const bodyToVerify =
      rawBody !== undefined
        ? Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : String(rawBody)
        : typeof payload === 'string'
          ? payload
          : JSON.stringify(payload);

    if (signature && hasValidSecret) {
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

    // Allow simulation signature ONLY in non-production test/simulation contexts when no real secret overrides it
    if (
      !isValid &&
      !isProd &&
      isSimulationSignature &&
      !secret &&
      (process.env.NODE_ENV === 'test' || process.env.PAYMENT_SIMULATION_MODE === 'true')
    ) {
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
    const refundEntity = eventData?.payload?.refund?.entity || eventData?.refund || {};
    const linkEntity = eventData?.payload?.payment_link?.entity || eventData?.payment_link || {};
    const orderEntity = eventData?.payload?.order?.entity || eventData?.order || {};

    const isRefundEvent = typeof event === 'string' && event.startsWith('refund.');

    const amount = isRefundEvent
      ? refundEntity.amount !== undefined
        ? Number(refundEntity.amount) / 100
        : undefined
      : paymentEntity.amount
        ? Number(paymentEntity.amount) / 100
        : linkEntity.amount
          ? Number(linkEntity.amount) / 100
          : orderEntity.amount_paid
            ? Number(orderEntity.amount_paid) / 100
            : orderEntity.amount
              ? Number(orderEntity.amount) / 100
              : undefined;

    const invoiceNumber =
      refundEntity.notes?.invoiceNumber ||
      linkEntity.notes?.invoiceNumber ||
      orderEntity.notes?.invoiceNumber ||
      paymentEntity.notes?.invoiceNumber ||
      eventData?.invoiceNumber;

    let status: WebhookVerificationResult['status'] = 'PENDING';
    if (event === 'payment_link.paid' || event === 'payment.captured' || event === 'order.paid') {
      status = 'COMPLETED';
    } else if (event === 'payment.authorized') {
      status = 'PENDING';
    } else if (event === 'payment.failed') {
      status = 'FAILED';
    } else if (event === 'payment_link.cancelled') {
      status = 'CANCELLED';
    } else if (event === 'payment_link.expired') {
      status = 'EXPIRED';
    } else if (event === 'refund.processed') {
      status = 'REFUND_PROCESSED';
    } else if (event === 'refund.failed') {
      status = 'REFUND_FAILED';
    } else if (event === 'refund.created') {
      status =
        String(refundEntity.status || '').toLowerCase() === 'processed'
          ? 'REFUND_PROCESSED'
          : 'REFUND_PENDING';
    }

    return {
      isValid,
      event,
      providerPaymentId:
        refundEntity.payment_id ||
        paymentEntity.id ||
        (eventData?.paymentId ? String(eventData.paymentId) : undefined),
      providerOrderId:
        paymentEntity.order_id ||
        orderEntity.id ||
        (eventData?.orderId ? String(eventData.orderId) : undefined),
      providerRefundId:
        refundEntity.id || (eventData?.refundId ? String(eventData.refundId) : undefined),
      paymentLinkId: linkEntity.id || eventData?.paymentLinkId,
      invoiceNumber,
      amount,
      currency:
        (isRefundEvent ? refundEntity.currency : undefined) ||
        paymentEntity.currency ||
        linkEntity.currency ||
        orderEntity.currency ||
        'INR',
      status,
      metadata:
        eventData?.notes ||
        refundEntity.notes ||
        linkEntity.notes ||
        orderEntity.notes ||
        paymentEntity.notes ||
        {},
      rawPayload: eventData,
    };
  }
}
