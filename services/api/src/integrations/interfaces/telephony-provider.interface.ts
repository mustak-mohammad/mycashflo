export interface InitiateCallInput {
  to: string;
  customerId: string;
  customerName: string;
  callReason?: string;
  collectionCaseId?: string;
  callbackUrl?: string;
}

export interface TelephonyCallOutput {
  callSid: string;
  provider: string;
  status: 'QUEUED' | 'INITIATED' | 'SIMULATED' | 'RINGING';
  isSimulated: boolean;
  notes: string;
  raw?: Record<string, any>;
}

export interface TelephonyStatusCallback {
  callSid: string;
  status: 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer';
  duration?: number;
  timestamp: Date;
  raw?: Record<string, any>;
}

export interface TelephonyGatewayAdapter {
  initiateCall(input: InitiateCallInput, config?: any): Promise<TelephonyCallOutput>;
  parseStatusCallback(payload: any): TelephonyStatusCallback;
}
