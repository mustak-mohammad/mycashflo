import apiClient from './client'
import type { Paginated, Payment, PaymentStats } from '../types'

export const paymentsApi = {
  list: (params?: { page?: number; limit?: number; status?: string; method?: string }) =>
    apiClient.get<Paginated<Payment>>('/payments', { params }).then((r) => r.data),

  getStats: () =>
    apiClient.get<PaymentStats>('/payments/stats').then((r) => r.data),
}
