import apiClient from './client'

export interface PlatformSummary {
  tenantsCount: number
  activeTenantsCount?: number
  usersCount: number
  totalUsersCount?: number
  customersCount: number
  invoicesCount: number
  totalInvoiced: number
  totalOutstanding: number
  totalCollected: number
  completedPaymentsCount: number
}

export interface PlatformTenant {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
  stats: {
    userCount: number
    activeUserCount?: number
    customerCount: number
    invoiceCount: number
    paymentCount: number
  }
}

export interface PlatformUser {
  id: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT'
  isActive: boolean
  tenantId: string
  tenant: {
    id: string
    name: string
    slug: string
  }
  createdAt: string
  updatedAt: string
}

export interface PlatformAuditLog {
  id: string
  userId: string
  action: string
  entityType?: string
  entityId?: string
  metadata?: any
  ipAddress?: string
  tenantId: string
  createdAt: string
  user?: {
    id: string
    name: string
    email: string
    role: string
  }
  tenant?: {
    id: string
    name: string
    slug: string
  }
}

export interface PlatformAuditLogsResponse {
  data: PlatformAuditLog[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface PlatformSettings {
  environment: string
  version: string
  systemHealth: 'operational' | 'degraded' | string
  securityPolicies: {
    outboundCallsEnabled: boolean
    automatedRemindersEnabled: boolean
    secretMaskingEnforced: boolean
    tenantIsolationEnforced: boolean
    superAdminBootstrapSafeguards: boolean
  }
  providers: {
    database: { status: string; engine: string }
    razorpay: { configured: boolean }
    stripe: { configured: boolean }
    resend: { configured: boolean }
    whatsapp: { configured: boolean }
    livekit: {
      configured: boolean
      agentName?: string
      webhookConfigured?: boolean
      egressConfigured?: boolean
    }
    sipTelephony?: {
      configured: boolean
      outboundTrunkConfigured: boolean
      inboundTrunkConfigured: boolean
      callerIdConfigured: boolean
      policy: string
    }
  }
  timestamp: string
}

export interface PlatformAnalytics {
  tenantsTotal: number
  usersTotal: number
  activeUsersTotal: number
  roleDistribution: Record<string, number>
  financials: {
    totalInvoiced: number
    totalOutstanding: number
    totalCollected: number
    completedPaymentsCount: number
  }
  tenantCreationTimeline: Array<{ id: string; createdAt: string }>
  userCreationTimeline: Array<{ id: string; role: string; createdAt: string }>
}

export async function getPlatformSummary(): Promise<PlatformSummary> {
  const { data } = await apiClient.get<PlatformSummary>('/platform/summary')
  return data
}

export async function getPlatformTenants(): Promise<PlatformTenant[]> {
  const { data } = await apiClient.get<PlatformTenant[]>('/platform/tenants')
  return data
}

export async function createPlatformTenant(payload: { name: string; slug: string }): Promise<PlatformTenant> {
  const { data } = await apiClient.post<PlatformTenant>('/platform/tenants', payload)
  return data
}

export async function updatePlatformTenantStatus(
  tenantId: string,
  isActive: boolean,
): Promise<{ success: boolean; tenantId: string; isActive: boolean; affectedUsers: number }> {
  const { data } = await apiClient.patch<{
    success: boolean
    tenantId: string
    isActive: boolean
    affectedUsers: number
  }>(`/platform/tenants/${tenantId}/status`, { isActive })
  return data
}

export async function getPlatformUsers(params?: { tenantId?: string; role?: string }): Promise<PlatformUser[]> {
  const { data } = await apiClient.get<PlatformUser[]>('/platform/users', { params })
  return data
}

export async function updatePlatformUserRole(
  userId: string,
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT',
): Promise<PlatformUser> {
  const { data } = await apiClient.patch<PlatformUser>(`/platform/users/${userId}/role`, { role })
  return data
}

export async function updatePlatformUserStatus(userId: string, isActive: boolean): Promise<PlatformUser> {
  const { data } = await apiClient.patch<PlatformUser>(`/platform/users/${userId}/status`, { isActive })
  return data
}

export async function getPlatformAuditLogs(params?: {
  page?: number
  limit?: number
  action?: string
  tenantId?: string
}): Promise<PlatformAuditLogsResponse> {
  const { data } = await apiClient.get<PlatformAuditLogsResponse>('/platform/audit-logs', { params })
  return data
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const { data } = await apiClient.get<PlatformSettings>('/platform/settings')
  return data
}

export async function getPlatformAnalytics(): Promise<PlatformAnalytics> {
  const { data } = await apiClient.get<PlatformAnalytics>('/platform/analytics')
  return data
}
