import client from './client'
import type {
  Notification,
  DispatchNotificationRequest,
  PaginatedResponse,
  NotificationChannel,
  NotifStatus,
} from '../../../../packages/shared-types'

export interface NotificationFilterParams {
  page?: number
  limit?: number
  channel?: NotificationChannel
  status?: NotifStatus
  customerId?: string
}

export interface NotificationTemplate {
  id: string
  name: string
  channels: NotificationChannel[]
  description: string
  variables: string[]
}

export interface TriggerRemindersResult {
  evaluatedInvoices: number
  dispatchedCount: number
  failedCount: number
  suppressedCount?: number
  details: Array<{
    invoiceNumber: string
    customerName: string
    channel?: NotificationChannel
    status?: NotifStatus
    daysOverdue?: number
    error?: string
    skipped?: boolean
    suppressed?: boolean
    reason?: string
  }>
}

export async function getNotificationTemplates(): Promise<NotificationTemplate[]> {
  const res = await client.get<NotificationTemplate[]>('/notifications/templates')
  return res.data
}

export async function getNotifications(params?: NotificationFilterParams): Promise<PaginatedResponse<Notification>> {
  const res = await client.get<PaginatedResponse<Notification>>('/notifications', { params })
  return res.data
}

export async function dispatchNotification(dto: DispatchNotificationRequest): Promise<Notification> {
  const res = await client.post<Notification>('/notifications/dispatch', dto)
  return res.data
}

export async function triggerAutomatedReminders(): Promise<TriggerRemindersResult> {
  const res = await client.post<TriggerRemindersResult>('/notifications/trigger-reminders')
  return res.data
}
