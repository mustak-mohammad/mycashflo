import client from './client'
import type { AuditLog, PaginatedResponse } from '../../../../packages/shared-types'

export interface AuditLogFilterParams {
  page?: number
  limit?: number
  action?: string
  entityType?: string
  entityId?: string
  userId?: string
}

export async function getAuditLogs(params?: AuditLogFilterParams): Promise<PaginatedResponse<AuditLog>> {
  const res = await client.get<PaginatedResponse<AuditLog>>('/audit-logs', { params })
  return res.data
}
