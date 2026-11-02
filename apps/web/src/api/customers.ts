import apiClient from './client'
import type { Paginated, Customer } from '../types'

export const customersApi = {
  list: (params?: { page?: number; limit?: number; search?: string; status?: string }) =>
    apiClient.get<Paginated<Customer>>('/customers', { params }).then((r) => r.data),

  getOne: (id: string) =>
    apiClient.get<Customer>(`/customers/${id}`).then((r) => r.data),

  create: (data: {
    name: string
    email?: string
    phone: string
    company?: string
    customerReference?: string
    gstNumber?: string
    billingAddress?: string
  }) => apiClient.post<Customer>('/customers', data).then((r) => r.data),

  update: (
    id: string,
    data: Partial<Customer> & { gstNumber?: string; billingAddress?: string; customerReference?: string },
  ) => apiClient.patch<Customer>(`/customers/${id}`, data).then((r) => r.data),
}
