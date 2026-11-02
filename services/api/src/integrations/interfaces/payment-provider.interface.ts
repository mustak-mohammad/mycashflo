export interface CreatePaymentLinkInput {
  invoiceNumber: string;
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  description?: string;
  callbackUrl?: string;
}

export interface PaymentLinkOutput {
  id: string;
  provider: 'RAZORPAY' | 'STRIPE';
  url: string;
  amount: number;
  currency: string;
  status: 'CREATED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  isSimulated: boolean;
  raw?: Record<string, any>;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  event: string;
  providerPaymentId?: string;
  paymentLinkId?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  status?: 'COMPLETED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED';
  metadata?: Record<string, any>;
  rawPayload?: any;
}

export interface PaymentProviderAdapter {
  createPaymentLink(input: CreatePaymentLinkInput, config?: any): Promise<PaymentLinkOutput>;
  verifyWebhook(
    payload: any,
    signature: string,
    secret?: string,
    rawBody?: Buffer | string,
  ): Promise<WebhookVerificationResult>;
}
