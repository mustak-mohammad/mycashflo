import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';
import { WhatsAppCloudAdapter } from './adapters/whatsapp-cloud.adapter.js';
import { SipTelephonyAdapter } from './adapters/sip-telephony.adapter.js';
import { ResendEmailAdapter } from './adapters/resend-email.adapter.js';
import { SmsGatewayAdapter } from './adapters/sms-gateway.adapter.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';

import { MockSipClient } from './adapters/mock-sip.client.js';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    RazorpayAdapter,
    StripeAdapter,
    WhatsAppCloudAdapter,
    SipTelephonyAdapter,
    MockSipClient,
    ResendEmailAdapter,
    SmsGatewayAdapter,
  ],
  exports: [
    IntegrationsService,
    RazorpayAdapter,
    StripeAdapter,
    WhatsAppCloudAdapter,
    SipTelephonyAdapter,
    MockSipClient,
    ResendEmailAdapter,
    SmsGatewayAdapter,
  ],
})
export class IntegrationsModule {}
