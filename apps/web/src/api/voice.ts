import client from './client'
import type {
  VoiceSessionToken,
  ConversationTurnRequest,
  ConversationTurnResponse,
} from '../types'

export const voiceApi = {
  getToken: (data?: { customerId?: string; collectionCaseId?: string }) =>
    client.post<VoiceSessionToken>('/voice/token', data ?? {}).then((r) => r.data),

  processTurn: (data: ConversationTurnRequest) =>
    client.post<ConversationTurnResponse>('/voice/conversation/turn', data).then((r) => r.data),

  startRecording: (data: { roomName: string; callSessionId?: string }) =>
    client.post<{ egressId: string; status: string }>('/voice/recording/start', data).then((r) => r.data),

  stopRecording: (data: { egressId: string; callSessionId?: string }) =>
    client.post<{ egressId: string; status: string }>('/voice/recording/stop', data).then((r) => r.data),
}

