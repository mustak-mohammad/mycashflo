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

// ── Phase 6: Collections Intelligence, Notifications & Audit ──────────────────

export type NotificationChannel = 'WHATSAPP' | 'EMAIL' | 'SMS'
export type NotifStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED'

export interface Notification {
  id: string
  customerId: string
  customer?: {
    id: string
    name: string
    email?: string
    phone?: string
  }
  channel: NotificationChannel
  template: string
  payload?: any
  status: NotifStatus
  sentAt?: string
  failReason?: string
  tenantId: string
  createdAt: string
}

export interface DispatchNotificationRequest {
  customerId: string
  channel: NotificationChannel
  template: string
  payload?: Record<string, any>
}

export interface AuditLog {
  id: string
  userId: string
  user?: {
    id: string
    name: string
    email: string
  }
  action: string
  entityType?: string
  entityId?: string
  metadata?: any
  ipAddress?: string
  tenantId: string
  createdAt: string
}

export type ActionRisk = 'LOW' | 'MEDIUM' | 'HIGH'
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'

export interface ActionProposal {
  id: string
  actionType: string
  toolName: string
  parameters: any
  summary: string
  riskLevel: ActionRisk
  status: ProposalStatus
  rejectionReason?: string
  result?: any
  expiresAt?: string
  executedAt?: string
  proposedBy: string
  reviewedBy?: string
  tenantId: string
  createdAt: string
  updatedAt: string
}

export interface AiToolParameter {
  type: string
  description: string
  required?: boolean
  enum?: string[]
}

export interface AiToolDefinition {
  name: string
  description: string
  isConsequential: boolean
  riskLevel: ActionRisk
  parameters: {
    type: string
    properties: Record<string, AiToolParameter>
    required: string[]
  }
}

export interface ExecuteToolRequest {
  toolName: string
  parameters: Record<string, any>
  confirmed?: boolean
  proposalId?: string
}

export interface ExecuteToolResponse {
  status: 'SUCCESS' | 'REQUIRES_CONFIRMATION' | 'ERROR'
  toolName: string
  result?: any
  proposal?: ActionProposal
  message: string
}

// ── Voice Prompts Management ──────────────────────────────────────────────────

export interface VoicePrompt {
  id: string
  name: string
  description?: string | null
  promptText: string
  category: string
  language: string
  isActive: boolean
  tenantId: string
  createdBy?: string | null
  creator?: {
    id: string
    name: string
    email: string
  }
  createdAt: string
  updatedAt: string
}

export interface CreateVoicePromptRequest {
  name: string
  description?: string
  promptText: string
  category?: string
  language?: string
  isActive?: boolean
}

export interface UpdateVoicePromptRequest {
  name?: string
  description?: string
  promptText?: string
  category?: string
  language?: string
  isActive?: boolean
}

// ── Ledger Export & Financial Reporting ───────────────────────────────────────

export interface LedgerEntry {
  id: string
  date: string
  ref: string
  type: 'INVOICE' | 'PAYMENT'
  customerId: string
  customerName: string
  invoiceNumber?: string
  description: string
  debit: number
  credit: number
  runningBalance: number
  status: string
  currency: string
}

export interface LedgerSummary {
  totalDebits: number
  totalCredits: number
  netBalance: number
  entryCount: number
  currency: string
}

export interface LedgerResponse {
  data: LedgerEntry[]
  summary: LedgerSummary
}

// ── Structured 10-Stage Chotu AI Conversation Flow ───────────────────────────

export type ConversationStage =
  | 'GREETING_AND_VERIFICATION'
  | 'CONFIRM_BALANCE'
  | 'ASK_FULL_PAYMENT'
  | 'NEGOTIATE_AMOUNT'
  | 'ASK_PAYMENT_DATE'
  | 'ASK_DELAY_REASON'
  | 'PAYMENT_METHOD'
  | 'ASSISTANCE_CHECK'
  | 'SUMMARIZE_COMMITMENT'
  | 'CLOSING'
  | 'CALLBACK_SCHEDULED'
  | 'DISPUTE_LOGGED'
  | 'TRANSFERRED_TO_AGENT'
  | 'CALL_ENDED'

export interface ConversationTurnRequest {
  userSpeech: string
  currentStage: ConversationStage
  customerId?: string
  invoiceId?: string
  promptId?: string
  extractedData?: Record<string, any>
  turnCount?: number
}

export interface ConversationTurnResponse {
  reply: string
  nextStage: ConversationStage
  shouldEnd: boolean
  outcome?: string
  extractedData: Record<string, any>
  actionExecuted?: string
}

