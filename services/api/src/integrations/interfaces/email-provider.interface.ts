export interface SendEmailInput {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text: string;
  recipientName?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
  invoiceNumber?: string;
  idempotencyKey?: string;
  isTest?: boolean;
  testScope?: string;
}

export interface SendEmailOutput {
  messageId: string;
  provider: 'RESEND' | 'SIMULATED';
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  isSimulated: boolean;
  error?: string;
  raw?: Record<string, any>;
}

export interface EmailWebhookEvent {
  messageId: string;
  event: 'sent' | 'delivered' | 'delivery_delayed' | 'complained' | 'bounced' | 'opened' | 'clicked';
  status: 'DELIVERED' | 'FAILED' | 'SENT';
  timestamp: Date;
  recipient: string;
  error?: string;
}

export interface EmailProviderAdapter {
  send(input: SendEmailInput, config?: any): Promise<SendEmailOutput>;
  verifyWebhookSignature(payload: any, signature: string, secret?: string): boolean;
  parseWebhook(payload: any): EmailWebhookEvent[];
}
