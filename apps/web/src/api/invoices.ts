import apiClient from './client'
import type { Paginated, Invoice } from '../types'

function triggerCsvDownload(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export const invoicesApi = {
  list: (params?: { page?: number; limit?: number; status?: string; customerId?: string }) =>
    apiClient.get<Paginated<Invoice>>('/invoices', { params }).then((r) => r.data),

  getOne: (id: string) =>
    apiClient.get<Invoice>(`/invoices/${id}`).then((r) => r.data),

  create: (data: {
    number: string
    customerId: string
    amount: number
    issueDate: string
    dueDate: string
    description?: string
  }) => apiClient.post<Invoice>('/invoices', data).then((r) => r.data),

  update: (
    id: string,
    data: { status?: Invoice['status']; description?: string; dueDate?: string },
  ) => apiClient.patch<Invoice>(`/invoices/${id}`, data).then((r) => r.data),

  downloadCsv: async (params?: { status?: string; customerId?: string }) => {
    const response = await apiClient.get('/invoices/export', { params, responseType: 'blob' })
    triggerCsvDownload(response.data, `invoices-${new Date().toISOString().slice(0, 10)}.csv`)
  },

  downloadPdf: async (id: string, number: string) => {
    const response = await apiClient.get(`/invoices/${id}/pdf`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `invoice-${number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    }, 100)
  },
}
