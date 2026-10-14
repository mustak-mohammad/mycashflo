import apiClient from './client'
import type { Paginated, Invoice } from '../types'

export const invoicesApi = {
  list: (params?: { page?: number; limit?: number; status?: string; customerId?: string }) =>
    apiClient.get<Paginated<Invoice>>('/invoices', { params }).then((r) => r.data),

  getOne: (id: string) =>
    apiClient.get<Invoice>(`/invoices/${id}`).then((r) => r.data),
}
