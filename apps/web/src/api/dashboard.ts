import apiClient from './client'
import type { DashboardStats } from '../types'

export interface DashboardPreferences {
  visibleWidgets: {
    totalReceivables?: boolean
    overdueAmount?: boolean
    agingBreakdown?: boolean
    overdueInvoiceCount?: boolean
    recentPayments?: boolean
    collectionPriorities?: boolean
    promisesToPay?: boolean
    pendingCallbacks?: boolean
    collectionRate?: boolean
    recentOverdueInvoices?: boolean
  }
  dateRange: string
  agingThreshold: number
}

export const dashboardApi = {
  getStats: (params?: { dateRange?: string; agingThreshold?: number }) =>
    apiClient.get<DashboardStats>('/dashboard', { params }).then((r) => r.data),

  getPreferences: () =>
    apiClient.get<DashboardPreferences>('/dashboard/preferences').then((r) => r.data),

  savePreferences: (prefs: Partial<DashboardPreferences>) =>
    apiClient.put<{ success: boolean; preferences: DashboardPreferences }>('/dashboard/preferences', prefs).then((r) => r.data),
}
