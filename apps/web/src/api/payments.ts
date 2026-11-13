import apiClient from './client'
import type {
  Paginated,
  Payment,
  PaymentStats,
  PaymentLinkResponse,
  CreateRazorpayOrderDto,
  RazorpayOrderResponse,
  VerifyRazorpayPaymentDto,
  VerifyRazorpayPaymentResponse,
} from '../types'

export const paymentsApi = {
  list: (params?: { page?: number; limit?: number; status?: string; method?: string }) =>
    apiClient.get<Paginated<Payment>>('/payments', { params }).then((r) => r.data),

  getStats: () =>
    apiClient.get<PaymentStats>('/payments/stats').then((r) => r.data),

  createPaymentLink: (data: { invoiceId: string; provider?: 'RAZORPAY' | 'STRIPE'; description?: string }) =>
    apiClient.post<PaymentLinkResponse>('/payments/link', data).then((r) => r.data),

  createRazorpayOrder: (data: CreateRazorpayOrderDto) =>
    apiClient.post<RazorpayOrderResponse>('/payments/razorpay/order', data).then((r) => r.data),

  verifyRazorpayPayment: (data: VerifyRazorpayPaymentDto) =>
    apiClient.post<VerifyRazorpayPaymentResponse>('/payments/razorpay/verify', data).then((r) => r.data),

  recordPayment: (data: {
    invoiceId: string
    amount: number
    paymentDate: string
    reference: string
    method?: string
    notes?: string
  }) => apiClient.post('/payments/record', data).then((r) => r.data),

  recordPaymentClaim: (data: {
    invoiceId: string
    amount: number
    paymentDate: string
    reference: string
    method?: string
    notes?: string
    evidenceUrl?: string
  }) => apiClient.post('/payments/claim', data).then((r) => r.data),

  verifyPaymentClaim: (id: string) =>
    apiClient.post(`/payments/${id}/verify`).then((r) => r.data),
}
