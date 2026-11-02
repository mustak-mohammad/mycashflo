import { Injectable, Logger } from '@nestjs/common';
import type { SipCallRequest } from '../builders/sip-request.builder.js';
import type {
  SipClientInterface,
  SipParticipantResult,
  SipSimulatedStatus,
} from '../interfaces/sip-client.interface.js';

/**
 * Mock-only SIP client implementation.
 *
 * CRITICAL SAFETY PROPERTIES:
 * 1. ZERO network I/O: Makes no HTTP requests, opens no TCP/UDP sockets, and invokes no LiveKit SDK methods.
 * 2. Never returns a misleading 'QUEUED' or 'LIVE' state; always returns explicit 'SIMULATED'.
 * 3. Supports simulating carrier behaviors: SUCCESS, BUSY, TIMEOUT, AUTH_FAILED, REJECTED.
 * 4. Masks all credentials in metadata.
 */
@Injectable()
export class MockSipClient implements SipClientInterface {
  private readonly logger = new Logger(MockSipClient.name);
  private simulatedBehavior: SipSimulatedStatus = 'SUCCESS';

  setSimulatedBehavior(behavior: SipSimulatedStatus): void {
    this.simulatedBehavior = behavior;
  }

  getSimulatedBehavior(): SipSimulatedStatus {
    return this.simulatedBehavior;
  }

  async createSipParticipant(request: SipCallRequest): Promise<SipParticipantResult> {
    const timestamp = new Date().toISOString();
    const sidSuffix = Math.random().toString(36).substring(2, 8);
    const callSid = `CA_sim_${Date.now()}_${sidSuffix}`;
    const participantId = `PA_sim_${Date.now()}_${sidSuffix}`;

    this.logger.log(
      `[MOCK SIP CLIENT] createSipParticipant called (SIMULATED ONLY): to=${request.destination}, trunk=${request.trunkId}, room=${request.roomName}, behavior=${this.simulatedBehavior}`,
    );

    let reason = 'Safe local development simulation; outbound calling is disabled by policy.';
    if (this.simulatedBehavior === 'BUSY') {
      reason = 'Simulated carrier response: Callee line is currently busy.';
    } else if (this.simulatedBehavior === 'TIMEOUT') {
      reason = 'Simulated carrier response: Call ringing timed out without answer.';
    } else if (this.simulatedBehavior === 'AUTH_FAILED') {
      reason = 'Simulated carrier response: SIP Trunk Digest authentication rejected.';
    } else if (this.simulatedBehavior === 'REJECTED') {
      reason = 'Simulated carrier response: Destination unreachable or rejected by carrier.';
    }

    return {
      participantId,
      callSid,
      status: 'SIMULATED',
      isSimulated: true,
      simulationReason: reason,
      providerStatus: this.simulatedBehavior,
      roomName: request.roomName,
      destination: request.destination,
      callerId: request.callerId,
      trunkId: request.trunkId,
      timestamp,
      raw: {
        simulated: true,
        policy: 'OUTBOUND_CALLS_DISABLED_BY_DEFAULT',
        behavior: this.simulatedBehavior,
        recipient: request.destination,
        callerId: request.callerId,
        trunkId: request.trunkId,
        participantIdentity: request.participantIdentity,
      },
    };
  }
}
