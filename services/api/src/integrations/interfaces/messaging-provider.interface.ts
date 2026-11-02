export interface SendMessageInput {
  to: string;
  recipientName: string;
  template: string;
  message: string;
  payload?: Record<string, any>;
}

export interface SendMessageOutput {
  messageId: string;
  provider: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  isSimulated: boolean;
  raw?: Record<string, any>;
}

export interface WebhookStatusEvent {
  messageId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  timestamp: Date;
  recipientPhone?: string;
  error?: string;
  errorCode?: number | string;
}

export interface InboundMessageEvent {
  messageId: string;
  senderPhone: string;
  senderNumber?: string;
  type: string;
  timestamp: Date;
  text?: string;
}

export interface MessagingAdapter {
  send(input: SendMessageInput, config?: any): Promise<SendMessageOutput>;
  verifyWebhookChallenge?(mode: string, token: string, challenge: string, configuredToken: string): string | null;
  verifyWebhookSignature(payload: any, signature: string, secret?: string): boolean;
  parseWebhook(payload: any): WebhookStatusEvent[];
  parseInboundMessages?(payload: any): InboundMessageEvent[];
}

