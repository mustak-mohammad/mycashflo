import apiClient from './client'
import type { Paginated, CollectionCase } from '../types'

export const collectionsApi = {
  list: (params?: { page?: number; limit?: number; status?: string; priority?: string }) =>
    apiClient.get<Paginated<CollectionCase> & { summary: { openCount: number; highCount: number } }>(
      '/collections',
      { params },
    ).then((r) => r.data),
}
