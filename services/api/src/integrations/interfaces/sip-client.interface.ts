import type { SipCallRequest } from '../builders/sip-request.builder.js';

export type SipSimulatedStatus = 'SUCCESS' | 'BUSY' | 'TIMEOUT' | 'AUTH_FAILED' | 'REJECTED';

export interface SipParticipantResult {
  participantId: string;
  callSid: string;
  status: 'SIMULATED';
  isSimulated: true;
  simulationReason: string;
  providerStatus: SipSimulatedStatus;
  roomName: string;
  destination: string;
  callerId: string;
  trunkId: string;
  timestamp: string;
  raw: {
    simulated: true;
    policy: 'OUTBOUND_CALLS_DISABLED_BY_DEFAULT';
    behavior: SipSimulatedStatus;
    [key: string]: unknown;
  };
}

/**
 * Narrow interface abstraction for LiveKit SIP Outbound dialing.
 * In production, this can be implemented by an adapter wrapping livekit-server-sdk SipClient.
 * In local/staging, it is strictly implemented by MockSipClient with zero network I/O.
 */
export interface SipClientInterface {
  createSipParticipant(request: SipCallRequest): Promise<SipParticipantResult>;
}
