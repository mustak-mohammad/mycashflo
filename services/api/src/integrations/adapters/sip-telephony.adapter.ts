import { Injectable, Logger, Optional, BadRequestException } from '@nestjs/common';
import type {
  TelephonyGatewayAdapter,
  InitiateCallInput,
  TelephonyCallOutput,
  TelephonyStatusCallback,
} from '../interfaces/telephony-provider.interface.js';
import { SipRequestBuilder } from '../builders/sip-request.builder.js';
import { MockSipClient } from './mock-sip.client.js';
import type { SipSimulatedStatus } from '../interfaces/sip-client.interface.js';

export interface SipTelephonyConfig {
  provider?: 'LIVEKIT_SIP' | 'TWILIO' | 'EXOTEL' | 'SIP_TRUNK';
  sipTrunkId?: string; // LiveKit Outbound Trunk ID (e.g. 'ST_xxx')
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

  /**
   * Masks secret configuration values before logging or serializing
   */
  maskSecrets(config: Record<string, any>): Record<string, any> {
    return SipRequestBuilder.maskConfig(config);
  }
}
