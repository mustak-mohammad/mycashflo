import apiClient from './client'
import type { IntegrationItem } from '../types'

export interface TestIntegrationResponse {
  provider: string
  status: 'SUCCESS' | 'ERROR'
  isSimulated: boolean
  message: string
  sampleUrl?: string
  messageId?: string
  callSid?: string
}

export const integrationsApi = {
  list: () => apiClient.get<IntegrationItem[]>('/integrations').then((r) => r.data),

  save: (provider: string, config: Record<string, any>, isActive = true) =>
    apiClient.put<IntegrationItem>(`/integrations/${provider}`, { config, isActive }).then((r) => r.data),

  test: (provider: string) =>
    apiClient.post<TestIntegrationResponse>(`/integrations/${provider}/test`).then((r) => r.data),
}
