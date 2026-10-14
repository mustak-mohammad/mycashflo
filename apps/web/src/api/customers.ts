import apiClient from './client'
import type { Paginated, Customer } from '../types'

export const customersApi = {
  list: (params?: { page?: number; limit?: number; search?: string; status?: string }) =>
    apiClient.get<Paginated<Customer>>('/customers', { params }).then((r) => r.data),

  getOne: (id: string) =>
    apiClient.get<Customer>(`/customers/${id}`).then((r) => r.data),
}
