import client from './client'
import type { VoiceSessionToken } from '../types'

export const voiceApi = {
  getToken: (data?: { customerId?: string; collectionCaseId?: string }) =>
    client.post<VoiceSessionToken>('/voice/token', data ?? {}).then((r) => r.data),
}
