import {
  Injectable,
  Logger,
  Optional,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { WebhookReceiver } from 'livekit-server-sdk';
import type {
  TelephonyGatewayAdapter,
  InitiateCallInput,
  TelephonyCallOutput,
  TelephonyStatusCallback,
} from '../interfaces/telephony-provider.interface.js';
import { SipRequestBuilder } from '../builders/sip-request.builder.js';
import { MockSipClient } from './mock-sip.client.js';
import type { SipSimulatedStatus } from '../interfaces/sip-client.interface.js';

export type CanonicalTelephonyProvider = 'TWILIO' | 'LIVEKIT_SIP' | 'EXOTEL' | 'SIP_TRUNK';

export interface TelephonyWebhookContext {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  rawBody?: Buffer | string;
  requestUrl?: string;
  secrets?: {
    twilioAuthToken?: string;
    livekitApiKey?: string;
    livekitWebhookSecret?: string;
    exotelToken?: string;
    webhookSecret?: string;
  };
}

export interface VerifiedTelephonyWebhook {
  provider: CanonicalTelephonyProvider;
  idempotencyKey?: string;
  timestampMs?: number;
  signatureFingerprint: string;
  verifiedPayload?: any;
}

export interface SipTelephonyConfig {
  provider?: 'LIVEKIT_SIP' | 'TWILIO' | 'EXOTEL' | 'SIP_TRUNK';
  sipTrunkId?: string; // LiveKit Outbound Trunk ID (e.g. 'ST_xxx')
  sipInboundTrunkId?: string; // LiveKit Inbound Trunk ID (e.g. 'ST_in_xxx')
  sipDispatchRuleId?: string; // LiveKit Inbound Dispatch Rule ID
  direction?: 'OUTBOUND' | 'INBOUND';
  sipTrunkUri?: string; // SIP Trunk domain / URI (e.g. 'sip:carrier.pstn.com')
  sipUsername?: string;
  sipPassword?: string;
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  outboundCallerId?: string;
  livekitRoomPrefix?: string;
  simulatedBehavior?: SipSimulatedStatus;
}

@Injectable()
export class SipTelephonyAdapter implements TelephonyGatewayAdapter {
  private readonly logger = new Logger(SipTelephonyAdapter.name);
  private readonly mockClient: MockSipClient;

  constructor(@Optional() mockSipClient?: MockSipClient) {
    this.mockClient = mockSipClient || new MockSipClient();
  }

  /**
   * Initiate outbound phone call bridging PSTN/SIP customer phone to LiveKit WebRTC room.
   *
   * STRICT SAFETY CONSTRAINTS:
   * 1. Default-Deny: Outbound calling is strictly disabled unless ENABLE_OUTBOUND_CALLS === 'true'
   *    AND OUTBOUND_CALLS_ENABLED is NOT 'false'.
   *    ENABLE_OUTBOUND_CALLS=false CANNOT be overridden by OUTBOUND_CALLS_ENABLED.
   * 2. Pre-Dispatch Validation: Destination must be a valid Indian mobile number (+91[6-9]xxxxxxxxx).
   *    Landlines, foreign numbers, and malformed strings are rejected before any dispatch evaluation.
   * 3. Network Unreachability: When outbound calling is disabled, real network dispatch is completely
   *    unreachable. The call is routed exclusively to the local MockSipClient with zero network I/O.
   * 4. Secrets Masking: Credentials (passwords, auth tokens) are masked and never logged.
   */
  async initiateCall(
    input: InitiateCallInput,
    config?: SipTelephonyConfig,
  ): Promise<TelephonyCallOutput> {
    // ── 1. Destination Pre-Dispatch Validation ────────────────────────────────
    const destValidation = SipRequestBuilder.validateIndianMobileNumber(input.to);
    if (!destValidation.isValid) {
      this.logger.warn(`Outbound call rejected: ${destValidation.error}`);
      throw new BadRequestException(destValidation.error);
    }
    const normalizedDestination = destValidation.value!;

    // ── 2. Strict Safety Guard Evaluation ─────────────────────────────────────
    // Both variables are evaluated. If either is explicitly 'false', or if ENABLE_OUTBOUND_CALLS
    // is false, outbound calling is unconditionally disabled.
    const isExplicitlyDisabled =
      process.env.ENABLE_OUTBOUND_CALLS === 'false' ||
      process.env.OUTBOUND_CALLS_ENABLED === 'false';

    const isExplicitlyEnabled =
      process.env.ENABLE_OUTBOUND_CALLS === 'true' &&
      process.env.OUTBOUND_CALLS_ENABLED !== 'false';

    const outboundEnabled = !isExplicitlyDisabled && isExplicitlyEnabled;
    const providerName = config?.provider || 'LIVEKIT_SIP';

    // ── 3. Safe Simulation / Default-Deny Path ─────────────────────────────────
    if (!outboundEnabled) {
      if (config?.simulatedBehavior) {
        this.mockClient.setSimulatedBehavior(config.simulatedBehavior);
      }

      const callerId = config?.outboundCallerId || config?.fromNumber || '+918000000000';
      const trunkId = config?.sipTrunkId || 'ST_simulation_trunk';
      const roomName = `mcf-${input.customerId || 'general'}-${Date.now().toString(36)}`;

      const simResult = await this.mockClient.createSipParticipant({
        destination: normalizedDestination,
        callerId,
        trunkId,
        roomName,
        participantIdentity: `sip-${normalizedDestination.replace(/[^\d]/g, '')}`,
        callReason: input.callReason,
        customerName: input.customerName,
      });

      this.logger.log(
        `[SAFETY GUARD] Real outbound call suppressed for ${normalizedDestination} (${input.customerName}). OUTBOUND_CALLS_ENABLED is false. Simulating SIP session.`,
      );

      return {
        callSid: simResult.callSid,
        provider: providerName,
        status: 'SIMULATED',
        isSimulated: true,
        notes:
          'Outbound PSTN telephony is disabled by policy. Safe simulation session initiated.',
        raw: {
          simulated: true,
          recipient: normalizedDestination,
          customerName: input.customerName,
          roomName: simResult.roomName,
          sipTrunkUri: config?.sipTrunkUri || 'sip:carrier.livekit.cloud',
          provider: providerName,
          timestamp: simResult.timestamp,
          policy: 'OUTBOUND_CALLS_DISABLED_BY_DEFAULT',
          behavior: simResult.providerStatus,
        },
      };
    }

    // ── 4. Future Outbound Calling Path (Strictly Unreachable Locally) ─────────
    // When enabled in production under explicit supervisor approval:
    // Requires verified LiveKit SIP Outbound Trunk credentials and E.164 caller ID
    const hasLiveKitCredentials = Boolean(config?.sipTrunkId);
    if (!hasLiveKitCredentials) {
      this.logger.warn('LiveKit SIP trunk credentials missing. Reverting to safe simulation mode.');
      return {
        callSid: `CA_sim_${Date.now()}`,
        provider: providerName,
        status: 'SIMULATED',
        isSimulated: true,
        notes: 'Missing trunk credentials. Operating in simulation mode.',
      };
    }

    // Never return misleading 'QUEUED' suggesting a real carrier call was made unless real provider responds
    return {
      callSid: `CA_sim_${Date.now()}`,
      provider: providerName,
      status: 'SIMULATED',
      isSimulated: true,
      notes: 'Live provider dispatch not activated in this environment.',
    };
  }

  parseStatusCallback(payload: any): TelephonyStatusCallback {
    const callSid = payload?.CallSid || payload?.callSid || payload?.id || `CA_unknown_${Date.now()}`;
    const rawStatus = (payload?.CallStatus || payload?.status || 'completed').toLowerCase();

    let status: TelephonyStatusCallback['status'] = 'completed';
    if (['initiated', 'queued'].includes(rawStatus)) status = 'initiated';
    else if (['ringing'].includes(rawStatus)) status = 'ringing';
    else if (['in-progress', 'in_progress', 'active'].includes(rawStatus)) status = 'in-progress';
    else if (['busy'].includes(rawStatus)) status = 'busy';
    else if (['failed'].includes(rawStatus)) status = 'failed';
    else if (['no-answer', 'no_answer'].includes(rawStatus)) status = 'no-answer';

    const duration = payload?.CallDuration
      ? Number(payload.CallDuration)
      : payload?.duration
      ? Number(payload.duration)
      : undefined;

    return {
      callSid,
      status,
      duration,
      timestamp: new Date(),
      raw: payload,
    };
  }

  private isPlaceholderSecret(val?: string): boolean {
    if (!val || typeof val !== 'string') return true;
    const trimmed = val.trim();
    return (
      trimmed === '' ||
      trimmed === 'placeholder' ||
      trimmed.startsWith('your_') ||
      trimmed.includes('placeholder_')
    );
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): string | undefined {
    if (!headers) return undefined;
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === target) {
        return Array.isArray(v) ? v[0] : v;
      }
    }
    return undefined;
  }

  private constantTimeEqualStrings(a: string, b: string): boolean {
    const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
    const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }

  normalizeWebhookProvider(provider: string): CanonicalTelephonyProvider {
    const normalized = (provider || '').trim().toLowerCase();
    switch (normalized) {
      case 'twilio':
        return 'TWILIO';
      case 'livekit':
      case 'livekit_sip':
      case 'livekit-sip':
        return 'LIVEKIT_SIP';
      case 'exotel':
        return 'EXOTEL';
      case 'sip_trunk':
      case 'sip-trunk':
      case 'sip_telephony':
      case 'sip-telephony':
      case 'sip_gateway':
      case 'sip-gateway':
        return 'SIP_TRUNK';
      default:
        throw new BadRequestException(`Unsupported telephony webhook provider: ${provider}`);
    }
  }

  private parseAndValidateTimestamp(
    payload: any,
    headers?: Record<string, string | string[] | undefined>,
    maxSkewMs = 300_000,
  ): number | undefined {
    const rawTs =
      this.getHeader(headers, 'x-twilio-timestamp') ??
      this.getHeader(headers, 'x-webhook-timestamp') ??
      this.getHeader(headers, 'x-exotel-timestamp') ??
      payload?.Timestamp ??
      payload?.timestamp ??
      payload?.createdAt ??
      payload?.created_at;

    if (rawTs === undefined || rawTs === null || String(rawTs).trim() === '') {
      return undefined;
    }

    let tsMs: number;
    if (typeof rawTs === 'number') {
      tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
    } else {
      const str = String(rawTs).trim();
      if (/^\d+(\.\d+)?$/.test(str)) {
        const num = Number(str);
        tsMs = num < 1e12 ? num * 1000 : num;
      } else {
        tsMs = Date.parse(str);
      }
    }

    if (!Number.isFinite(tsMs) || tsMs <= 0) {
      throw new UnauthorizedException('Malformed webhook timestamp');
    }

    if (Math.abs(Date.now() - tsMs) > maxSkewMs) {
      throw new UnauthorizedException('Expired or invalid webhook timestamp');
    }

    return tsMs;
  }

  /**
   * Verifies incoming telephony provider webhooks using each provider's documented
   * signature or shared-secret verification mechanism. Fails closed if secrets or auth are missing.
   */
  async verifyWebhookRequest(
    provider: string,
    payload: any,
    context?: TelephonyWebhookContext,
  ): Promise<VerifiedTelephonyWebhook> {
    const canonicalProvider = this.normalizeWebhookProvider(provider);
    const headers = context?.headers;
    const rawBodyString =
      context?.rawBody !== undefined
        ? Buffer.isBuffer(context.rawBody)
          ? context.rawBody.toString('utf8')
          : String(context.rawBody)
        : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload ?? {});

    // Validate optional timestamp header/field before authenticating payload
    const timestampMs = this.parseAndValidateTimestamp(payload, headers);
    const idempotencyHeader =
      this.getHeader(headers, 'i-twilio-idempotency-token') ||
      this.getHeader(headers, 'x-webhook-id');

    if (canonicalProvider === 'TWILIO') {
      const twilioSig = this.getHeader(headers, 'x-twilio-signature')?.trim();
      if (!twilioSig) {
        throw new UnauthorizedException('Missing X-Twilio-Signature header');
      }

      const authToken =
        context?.secrets?.twilioAuthToken ||
        process.env.TWILIO_AUTH_TOKEN ||
        process.env.TELEPHONY_WEBHOOK_SECRET;
      if (this.isPlaceholderSecret(authToken)) {
        throw new UnauthorizedException('Twilio webhook verification secret is not configured');
      }

      const requestUrl = context?.requestUrl?.trim();
      if (!requestUrl) {
        throw new UnauthorizedException('Request URL is required for Twilio signature verification');
      }

      let bodySha256Param: string | undefined;
      try {
        const parsedUrl = new URL(requestUrl);
        bodySha256Param = parsedUrl.searchParams.get('bodySHA256') || undefined;
      } catch {
        throw new UnauthorizedException('Malformed webhook request URL');
      }

      let signedData = requestUrl;
      if (bodySha256Param) {
        const actualBodyHash = crypto
          .createHash('sha256')
          .update(rawBodyString, 'utf8')
          .digest('hex');
        if (!this.constantTimeEqualStrings(actualBodyHash.toLowerCase(), bodySha256Param.toLowerCase())) {
          throw new UnauthorizedException('Twilio bodySHA256 mismatch');
        }
      } else if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
        const sortedKeys = Object.keys(payload).sort();
        for (const key of sortedKeys) {
          const val = payload[key];
          if (Array.isArray(val)) {
            for (const item of val) {
              signedData += key + String(item ?? '');
            }
          } else if (val !== undefined && val !== null) {
            signedData += key + String(val);
          }
        }
      }

      const expectedSig = crypto
        .createHmac('sha1', authToken!)
        .update(signedData, 'utf8')
        .digest('base64');

      const sigBuf = Buffer.from(twilioSig, 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new UnauthorizedException('Invalid Twilio webhook signature');
      }

      return {
        provider: canonicalProvider,
        idempotencyKey: idempotencyHeader || undefined,
        timestampMs,
        signatureFingerprint: crypto
          .createHash('sha256')
          .update(`${twilioSig}|${rawBodyString}`)
          .digest('hex'),
      };
    }

    if (canonicalProvider === 'LIVEKIT_SIP') {
      const authHeader = this.getHeader(headers, 'authorization')?.trim();
      if (!authHeader) {
        throw new UnauthorizedException('Missing Authorization header on LiveKit webhook request');
      }

      const apiKey = context?.secrets?.livekitApiKey || process.env.LIVEKIT_API_KEY;
      const webhookSecret =
        context?.secrets?.livekitWebhookSecret ||
        process.env.LIVEKIT_WEBHOOK_SECRET ||
        process.env.LIVEKIT_API_SECRET;

      if (this.isPlaceholderSecret(apiKey) || this.isPlaceholderSecret(webhookSecret)) {
        throw new UnauthorizedException('LiveKit webhook credentials are not configured');
      }

      let verifiedEvent: any;
      try {
        const receiver = new WebhookReceiver(apiKey!, webhookSecret!);
        verifiedEvent = await receiver.receive(rawBodyString, authHeader);
      } catch {
        throw new UnauthorizedException('Invalid or expired LiveKit webhook signature');
      }

      return {
        provider: canonicalProvider,
        idempotencyKey: idempotencyHeader || verifiedEvent?.id || payload?.id,
        timestampMs,
        signatureFingerprint: crypto
          .createHash('sha256')
          .update(`${authHeader}|${rawBodyString}`)
          .digest('hex'),
        verifiedPayload: verifiedEvent,
      };
    }

    // EXOTEL & SIP_TRUNK shared-secret verification
    const authHeader = this.getHeader(headers, 'authorization')?.trim();
    const bearerToken =
      authHeader && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const rawQueryToken = context?.query?.token;
    const queryToken = Array.isArray(rawQueryToken) ? rawQueryToken[0] : rawQueryToken;

    const suppliedToken = (
      bearerToken ||
      this.getHeader(headers, 'x-exotel-token') ||
      this.getHeader(headers, 'x-telephony-token') ||
      this.getHeader(headers, 'x-webhook-secret') ||
      queryToken ||
      ''
    ).trim();

    if (!suppliedToken) {
      throw new UnauthorizedException('Missing telephony webhook authentication token');
    }

    const expectedSecret =
      canonicalProvider === 'EXOTEL'
        ? context?.secrets?.exotelToken ||
          context?.secrets?.webhookSecret ||
          process.env.EXOTEL_WEBHOOK_TOKEN ||
          process.env.TELEPHONY_WEBHOOK_SECRET
        : context?.secrets?.webhookSecret ||
          process.env.TELEPHONY_WEBHOOK_SECRET ||
          process.env.SIP_WEBHOOK_SECRET;

    if (this.isPlaceholderSecret(expectedSecret)) {
      throw new UnauthorizedException('Telephony webhook verification secret is not configured');
    }

    if (!this.constantTimeEqualStrings(suppliedToken, expectedSecret!)) {
      throw new UnauthorizedException('Invalid telephony webhook authentication token');
    }

    return {
      provider: canonicalProvider,
      idempotencyKey: idempotencyHeader || payload?.id || payload?.eventId,
      timestampMs,
      signatureFingerprint: crypto
        .createHash('sha256')
        .update(`${canonicalProvider}|${rawBodyString}`)
        .digest('hex'),
    };
  }

  /**
   * Masks secret configuration values before logging or serializing
   */
  maskSecrets(config: Record<string, any>): Record<string, any> {
    return SipRequestBuilder.maskConfig(config);
  }

  /**
   * Safe diagnostics report for SIP carrier & LiveKit trunking posture
   */
  getDiagnostics(config?: SipTelephonyConfig) {
    const isOutboundEnabled =
      process.env.ENABLE_OUTBOUND_CALLS === 'true' &&
      process.env.OUTBOUND_CALLS_ENABLED !== 'false';

    const outboundTrunkId = config?.sipTrunkId || process.env.SIP_OUTBOUND_TRUNK_ID;
    const inboundTrunkId = config?.sipInboundTrunkId || process.env.SIP_INBOUND_TRUNK_ID;
    const callerId = config?.outboundCallerId || process.env.SIP_OUTBOUND_CALLER_ID;
    const carrierHost =
      config?.sipTrunkUri || process.env.SIP_CARRIER_HOST || 'sip.carrier.pstn.example.com';
    const provider = config?.provider || process.env.SIP_PROVIDER_NAME || 'LIVEKIT_SIP';

    const isPlaceholder = (v?: string) =>
      !v || v.startsWith('your_') || v.includes('placeholder') || v.trim() === '';

    const hasOutboundTrunk = Boolean(outboundTrunkId && !isPlaceholder(outboundTrunkId));
    const hasInboundTrunk = Boolean(inboundTrunkId && !isPlaceholder(inboundTrunkId));
    const hasCallerId = Boolean(callerId && !isPlaceholder(callerId) && callerId.startsWith('+'));

    let maskedCallerId = 'Not set';
    if (callerId && !isPlaceholder(callerId)) {
      maskedCallerId = `${callerId.slice(0, 3)}****${callerId.slice(-4)}`;
    }

    return {
      provider,
      outboundCallsEnabled: isOutboundEnabled,
      outboundTrunkConfigured: hasOutboundTrunk,
      inboundTrunkConfigured: hasInboundTrunk,
      callerIdConfigured: hasCallerId,
      callerId: maskedCallerId,
      carrierHost,
      transport: 'TLS/SRTP (Encrypted SIP)',
      safetyStatus: isOutboundEnabled
        ? 'LIVE_DISPATCH_GATED'
        : 'OUTBOUND_DISPATCH_DISABLED_BY_POLICY',
    };
  }
}
