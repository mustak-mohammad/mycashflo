/**
 * Shared TypeScript types between frontend and backend.
 */

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

export interface LoginResponse {
  user: User
  tokens: AuthTokens
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
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
  customer?: { name: string }
  amount: number
  outstanding: number
  currency: string
  status: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  issueDate: string
  dueDate: string
  tenantId: string
}

export interface CollectionCase {
  id: string
  customerId: string
  customer?: { id: string; name: string; outstandingBalance: number }
  invoiceId?: string
  invoice?: { id: string; number: string; outstanding: number }
  assignedTo?: string
  assignedAgent?: { id: string; name: string }
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  notes?: string
  resolvedAt?: string
  tenantId: string
  createdAt: string
  followUpTasks?: FollowUpTask[]
}

export interface FollowUpTask {
  id: string
  title: string
  description?: string
  dueDate: string
  done: boolean
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  customerId?: string
  collectionCaseId?: string
  collectionCase?: {
    customer?: { id: string; name: string; phone?: string; company?: string }
  }
  assignedAgent?: { id: string; name: string }
  createdAt?: string
}

export interface CallSession {
  id: string
  customerId?: string
  customer?: { id: string; name: string; phone?: string }
  agent?: { id: string; name: string; email: string }
  duration?: number
  outcome?: 'PROMISE_TO_PAY' | 'DISPUTE' | 'NO_CONTACT' | 'CALLBACK_REQUESTED' | 'RESOLVED' | 'OTHER'
  transcript?: string
  summary?: string
  startedAt: string
  endedAt?: string
  recordingStatus?: 'RECORDING' | 'PROCESSING' | 'AVAILABLE' | 'FAILED'
  recordingUrl?: string
  recordingEgressId?: string
}

export interface VoiceSessionToken {
  token: string
  roomName: string
  url: string
  identity: string
  name: string
  isMock: boolean
  expiresIn: number
}


export interface Payment {
  id: string
  ref: string
  customerId: string
  customer?: { id: string; name: string }
  invoiceId: string
  invoice?: { id: string; number: string }
  amount: number
  currency: string
  method: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'CARD' | 'PAYMENT_LINK' | 'OTHER'
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'
  paidAt?: string
  notes?: string
  tenantId: string
  createdAt: string
}

export interface PaymentStats {
  totalCollected: number
  totalPayments: number
  byMethod: Array<{ method: string; amount: number; count: number }>
}

export interface DashboardStats {
  totalReceivables: number
  overdueAmount: number
  collectedThisMonth: number
  openInvoiceCount: number
  overdueCustomerCount: number
  openCaseCount: number
  collectionRate: number
  recentOverdueInvoices: Array<{
    id: string
    number: string
    customerName: string
    outstanding: number
    dueDate: string
    daysOverdue: number
  }>
}

export interface AgeingReport {
  d0_30: number
  d31_60: number
  d61_90: number
  d90plus: number
  total: number
}

export interface ReportSummary {
  totalBilled: number
  totalCollected: number
  totalOverdue: number
  openInvoices: number
  overdueCustomers: number
  promiseToPay: number
  collectionRate: number
  collectedThisMonth: number
}

export interface ApiError {
  message: string
  statusCode: number
  error?: string
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

// ── Customer Ledger & Reports ─────────────────────────────────────────────────
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
  openingBalance: number
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
  sessionId?: string
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

