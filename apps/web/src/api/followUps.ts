import client from './client'
import type { FollowUpTask, Paginated } from '../types'

export interface FollowUpListParams {
  page?: number
  limit?: number
  priority?: string
  done?: boolean
}

export interface FollowUpSummaryResponse extends Paginated<FollowUpTask> {
  summary: {
    pendingCount: number
    completedCount: number
  }
}

export const followUpsApi = {
  list: (params?: FollowUpListParams) =>
    client.get<FollowUpSummaryResponse>('/follow-ups', { params }).then((r) => r.data),

  get: (id: string) =>
    client.get<FollowUpTask>(`/follow-ups/${id}`).then((r) => r.data),

  create: (data: {
    title: string
    description?: string
    dueDate: string
    priority?: string
    customerId?: string
    collectionCaseId?: string
    assignedTo?: string
  }) => client.post<FollowUpTask>('/follow-ups', data).then((r) => r.data),

  update: (id: string, data: Partial<FollowUpTask>) =>
    client.patch<FollowUpTask>(`/follow-ups/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    client.delete(`/follow-ups/${id}`).then((r) => r.data),
}
