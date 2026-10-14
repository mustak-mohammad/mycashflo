// packages/shared-types/index.ts
// Shared TypeScript interfaces used by both the NestJS API and React web app.
// In a future phase these can be generated automatically from the OpenAPI spec.

export interface UserRole {
  ADMIN: 'ADMIN'
  MANAGER: 'MANAGER'
  AGENT: 'AGENT'
}

export interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'MANAGER' | 'AGENT'
  tenantId: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  user: User
  tokens: AuthTokens
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  company?: string
  outstandingBalance: number
  currency: string
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
  tenantId: string
}

export interface Invoice {
  id: string
  number: string
  customerId: string
  customerName: string
  amount: number
  outstanding: number
  currency: string
  status: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  issueDate: string
  dueDate: string
  tenantId: string
}

export interface DashboardMetrics {
  totalReceivables: number
  overdueAmount: number
  collectedAmount: number
  pendingInvoices: number
  collectionRate: number
  overdueCustomers: number
  upcomingFollowUps: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ApiError {
  message: string
  statusCode: number
  error?: string
}
