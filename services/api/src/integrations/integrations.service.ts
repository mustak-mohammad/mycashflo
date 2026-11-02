import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import { RazorpayAdapter } from './adapters/razorpay.adapter.js';
import { StripeAdapter } from './adapters/stripe.adapter.js';
import { WhatsAppCloudAdapter } from './adapters/whatsapp-cloud.adapter.js';
import { SipTelephonyAdapter } from './adapters/sip-telephony.adapter.js';
import { ResendEmailAdapter } from './adapters/resend-email.adapter.js';
import { SmsGatewayAdapter } from './adapters/sms-gateway.adapter.js';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    public readonly razorpay: RazorpayAdapter,
    public readonly stripe: StripeAdapter,
    public readonly whatsapp: WhatsAppCloudAdapter,
    public readonly telephony: SipTelephonyAdapter,
    public readonly email: ResendEmailAdapter,
    public readonly sms: SmsGatewayAdapter,
  ) {}

  private maskSecret(val: string | undefined): string {
    if (!val || typeof val !== 'string') return '';
    if (val.length <= 8) return '********';
    return `${val.substring(0, 4)}...${val.substring(val.length - 4)}`;
  }

  private maskConfig(config: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = { ...config };
    const secretKeys = ['keySecret', 'secretKey', 'authToken', 'accessToken', 'webhookSecret', 'appSecret', 'apiKey', 'sipPassword'];
    for (const key of secretKeys) {
      if (masked[key]) {
        masked[key] = this.maskSecret(masked[key]);
      }
    }
    return masked;
  }

  async getConfigs(user: AuthUser) {
    const { tenantId } = user;
    const configs = await this.prisma.integrationConfig.findMany({
      where: { tenantId },
      orderBy: { provider: 'asc' },
    });

    const defaultProviders = ['RAZORPAY', 'STRIPE', 'WHATSAPP_CLOUD', 'SIP_TELEPHONY', 'RESEND', 'SMS_GATEWAY'];
    const existingMap = new Map(configs.map((c) => [c.provider.toUpperCase(), c]));

    return defaultProviders.map((prov) => {
      const existing = existingMap.get(prov);
      if (existing) {
        return {
          id: existing.id,
          provider: existing.provider,
          isActive: existing.isActive,
          config: this.maskConfig(existing.config as Record<string, any>),
          updatedAt: existing.updatedAt,
          isConfigured: true,
        };
      }
      return {
        id: `mock-${prov.toLowerCase()}`,
        provider: prov,
        isActive: false,
        config: {},
        updatedAt: new Date(),
        isConfigured: false,
      };
    });
  }

  async saveConfig(
    user: AuthUser,
    provider: string,
    dto: { config: Record<string, any>; isActive?: boolean },
  ) {
    const { tenantId, userId } = user;
    const normalizedProvider = provider.toUpperCase();

    // Check if there is an existing config to preserve masked secrets if not changed
    const existing = await this.prisma.integrationConfig.findUnique({
      where: {
        provider_tenantId: {
          provider: normalizedProvider,
          tenantId,
        },
      },
    });

    const mergedConfig: Record<string, any> = { ...(existing?.config as any || {}) };
    for (const [key, val] of Object.entries(dto.config || {})) {
      if (typeof val === 'string' && val.includes('...')) {
        // User submitted the masked string back, preserve original value
        continue;
      }
      mergedConfig[key] = val;
    }

    const saved = await this.prisma.integrationConfig.upsert({
      where: {
        provider_tenantId: {
          provider: normalizedProvider,
          tenantId,
        },
      },
      update: {
        config: mergedConfig,
        isActive: dto.isActive !== undefined ? dto.isActive : existing?.isActive ?? true,
      },
      create: {
        provider: normalizedProvider,
        config: mergedConfig,
        isActive: dto.isActive ?? true,
        tenantId,
      },
    });

    await this.auditLogs.log({
      tenantId,
      userId,
      action: 'integration.configured',
      entityType: 'IntegrationConfig',
      entityId: saved.id,
      metadata: {
        provider: normalizedProvider,
        isActive: saved.isActive,
      },
    });

    return {
      ...saved,
      config: this.maskConfig(saved.config as Record<string, any>),
    };
  }

  async testConnection(user: AuthUser, provider: string) {
    const { tenantId } = user;
    const normalizedProvider = provider.toUpperCase();

    const existing = await this.prisma.integrationConfig.findUnique({
      where: {
        provider_tenantId: {
          provider: normalizedProvider,
          tenantId,
        },
      },
    });

    const config = (existing?.config as Record<string, any>) || {};

    switch (normalizedProvider) {
      case 'RAZORPAY': {
        try {
          const link = await this.razorpay.createPaymentLink(
            {
              invoiceNumber: 'INV-TEST-001',
              amount: 100,
              currency: 'INR',
              customerName: 'Test Connectivity Customer',
              customerEmail: 'test@mycashflo.internal',
            },
            config,
          );
          return {
            provider: 'RAZORPAY',
            status: 'SUCCESS',
            isSimulated: link.isSimulated,
            message: link.isSimulated
              ? 'Razorpay operating in simulation mode. Ready for test link generation.'
              : 'Razorpay API credentials verified successfully.',
            sampleUrl: link.url,
          };
        } catch (err: any) {
          return {
            provider: 'RAZORPAY',
            status: 'FAILED',
            message: `Razorpay connectivity error: ${err.message || 'Verification failed'}`,
          };
        }
      }

      case 'STRIPE': {
        try {
          const link = await this.stripe.createPaymentLink(
            {
              invoiceNumber: 'INV-TEST-001',
              amount: 100,
              currency: 'INR',
              customerName: 'Test Connectivity Customer',
              customerEmail: 'test@mycashflo.internal',
            },
            config,
          );
          return {
            provider: 'STRIPE',
            status: 'SUCCESS',
            isSimulated: link.isSimulated,
            message: link.isSimulated
              ? 'Stripe operating in simulation mode. Ready for checkout generation.'
              : 'Stripe API credentials verified successfully.',
            sampleUrl: link.url,
          };
        } catch (err: any) {
          return {
            provider: 'STRIPE',
            status: 'FAILED',
            message: `Stripe connectivity error: ${err.message || 'Verification failed'}`,
          };
        }
      }

      case 'WHATSAPP_CLOUD': {
        const msg = await this.whatsapp.send(
          {
            to: '+919876543210',
            recipientName: 'Test Customer',
            template: 'TEST_CONNECTION',
            message: 'myCashflo connectivity test message.',
          },
          config,
        );
        return {
          provider: 'WHATSAPP_CLOUD',
          status: 'SUCCESS',
          isSimulated: msg.isSimulated,
          message: msg.isSimulated
            ? 'WhatsApp Cloud API operating in simulation mode. Payload verified.'
            : 'WhatsApp Cloud API live connection verified.',
          messageId: msg.messageId,
        };
      }

      case 'SIP_TELEPHONY': {
        const call = await this.telephony.initiateCall(
          {
            to: '+919876543210',
            customerId: 'test-cust',
            customerName: 'Test Customer',
            callReason: 'Connectivity Check',
          },
          config,
        );
        return {
          provider: 'SIP_TELEPHONY',
          status: 'SUCCESS',
          isSimulated: call.isSimulated,
          message: 'SIP Telephony Gateway policy checked: outbound calls disabled by policy (simulation active).',
          callSid: call.callSid,
        };
      }

      case 'RESEND': {
        const testTarget = config.testRecipient || process.env.EMAIL_TEST_RECIPIENT || 'delivered@resend.dev';
        const sendResult = await this.email.send(
          {
            to: testTarget,
            recipientName: 'Test Recipient',
            subject: 'myCashflo — Resend Integration Connectivity Test',
            text: 'This is a safe connectivity test email from myCashflo.',
            html: '<p>This is a safe connectivity test email from <strong>myCashflo</strong>.</p>',
          },
          config,
        );
        return {
          provider: 'RESEND',
          status: sendResult.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
          isSimulated: sendResult.isSimulated,
          message: sendResult.isSimulated
            ? 'Resend operating in simulation mode. Ready for safe test dispatch.'
            : (sendResult.status === 'FAILED'
                ? `Resend connectivity error: ${sendResult.error}`
                : 'Resend API credentials verified successfully. Test message dispatched.'),
          messageId: sendResult.messageId,
          error: sendResult.error,
        };
      }

      case 'SMS_GATEWAY': {
        const testTarget = config.testRecipient || process.env.SMS_TEST_RECIPIENT || '+919876543210';
        const sendResult = await this.sms.send(
          {
            to: testTarget,
            recipientName: 'Test Recipient',
            template: 'TEST_CONNECTION',
            message: 'myCashflo SMS connectivity test message.',
          },
          config,
        );
        return {
          provider: 'SMS_GATEWAY',
          status: sendResult.status === 'FAILED' ? 'FAILED' : 'SUCCESS',
          isSimulated: sendResult.isSimulated,
          message: sendResult.isSimulated
            ? 'SMS Gateway operating in simulation mode. Ready for test dispatch.'
            : (sendResult.status === 'FAILED'
                ? `SMS connectivity error: ${sendResult.raw?.error || 'dispatch failed'}`
                : 'SMS Gateway credentials verified successfully. Test message dispatched.'),
          messageId: sendResult.messageId,
        };
      }

      default:
        throw new NotFoundException(`Unknown provider ${provider}`);
    }
  }

  async getRawConfig(tenantId: string, provider: string): Promise<Record<string, any>> {
    const existing = await this.prisma.integrationConfig.findUnique({
      where: {
        provider_tenantId: {
          provider: provider.toUpperCase(),
          tenantId,
        },
      },
    });
    return (existing?.config as Record<string, any>) || {};
  }
}
