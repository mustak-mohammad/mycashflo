import apiClient from './client'
import type { AgeingReport, ReportSummary } from '../types'

export const reportsApi = {
  getAgeing: () =>
    apiClient.get<AgeingReport>('/reports/ageing').then((r) => r.data),

  getSummary: () =>
    apiClient.get<ReportSummary>('/reports/summary').then((r) => r.data),
}
