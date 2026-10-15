import apiClient from './client'
import type { AgeingReport, ReportSummary, LedgerResponse } from '../types'

export const reportsApi = {
  getAgeing: () =>
    apiClient.get<AgeingReport>('/reports/ageing').then((r) => r.data),

  getSummary: () =>
    apiClient.get<ReportSummary>('/reports/summary').then((r) => r.data),

  getLedger: (params?: { customerId?: string; startDate?: string; endDate?: string }) =>
    apiClient.get<LedgerResponse>('/reports/ledger', { params }).then((r) => r.data),

  getLedgerExportUrl: (params?: { customerId?: string; startDate?: string; endDate?: string; format?: 'csv' | 'xlsx' }) => {
    const q = new URLSearchParams()
    if (params?.customerId) q.set('customerId', params.customerId)
    if (params?.startDate) q.set('startDate', params.startDate)
    if (params?.endDate) q.set('endDate', params.endDate)
    if (params?.format) q.set('format', params.format)
    const base = import.meta.env.VITE_API_URL || '/api'
    return `${base}/reports/ledger/export?${q.toString()}`
  },

  downloadLedger: async (params?: { customerId?: string; startDate?: string; endDate?: string; format?: 'csv' | 'xlsx' }) => {
    const format = params?.format || 'csv'
    const response = await apiClient.get('/reports/ledger/export', {
      params,
      responseType: 'blob',
    })
    const blob = new Blob([response.data], {
      type: format === 'xlsx' ? 'application/vnd.ms-excel' : 'text/csv;charset=utf-8;',
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `customer-ledger-${new Date().toISOString().slice(0, 10)}.${format === 'xlsx' ? 'xls' : 'csv'}`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
}

