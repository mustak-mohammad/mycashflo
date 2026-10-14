import client from './client'
import type { CallSession, Paginated } from '../types'

export interface CallListParams {
  page?: number
  limit?: number
  outcome?: string
  customerId?: string
}

export const callsApi = {
  list: (params?: CallListParams) =>
    client.get<Paginated<CallSession>>('/calls', { params }).then((r) => r.data),

  get: (id: string) =>
    client.get<CallSession>(`/calls/${id}`).then((r) => r.data),

  create: (data: {
    customerId?: string
    collectionCaseId?: string
    duration?: number
    outcome?: string
    transcript?: string
    summary?: string
    livekitRoom?: string
  }) => client.post<CallSession>('/calls', data).then((r) => r.data),
}
