import apiClient from './client'
import type {
  TenantReminderSettings,
  RemindersRunSummary,
  ReminderStatsSummary,
  ReminderHistoryItem,
} from '../types'

export interface UpdateReminderSettingsPayload {
  enabled?: boolean
  dryRun?: boolean
  channelPreference?: 'EMAIL' | 'WHATSAPP' | 'BOTH' | 'DISABLED'
  timezone?: string
  quietHoursStart?: number
  quietHoursEnd?: number
  maxDailyPerCustomer?: number
  minDaysBetweenReminders?: number
  testRecipientEmail?: string
  testRecipientPhone?: string
}

export interface SendTestReminderPayload {
  invoiceId: string
  channel: 'EMAIL' | 'WHATSAPP'
  recipient?: string
}

export const remindersApi = {
  getSettings: () =>
    apiClient.get<TenantReminderSettings>('/reminders/settings').then((r) => r.data),

  updateSettings: (payload: UpdateReminderSettingsPayload) =>
    apiClient.put<TenantReminderSettings>('/reminders/settings', payload).then((r) => r.data),

  getPreview: () =>
    apiClient.get<RemindersRunSummary>('/reminders/preview').then((r) => r.data),

  triggerRun: (dryRun?: boolean) =>
    apiClient.post<RemindersRunSummary>('/reminders/trigger', { dryRun }).then((r) => r.data),

  sendTestReminder: (payload: SendTestReminderPayload) =>
    apiClient.post<{ success: boolean; notification?: any; message: string }>('/reminders/test-send', payload).then((r) => r.data),

  getStats: () =>
    apiClient.get<ReminderStatsSummary>('/reminders/stats').then((r) => r.data),

  getHistory: (params?: { page?: number; limit?: number; invoiceId?: string; status?: string }) =>
    apiClient.get<{ data: ReminderHistoryItem[]; total: number; page: number; limit: number }>('/reminders/history', { params }).then((r) => r.data),
}
