// packages/shared-types/index.ts
// Shared TypeScript interfaces used by both the NestJS API and React web app.
// In a future phase these can be generated automatically from the OpenAPI spec.

export interface UserRole {
  SUPER_ADMIN: 'SUPER_ADMIN'
  ADMIN: 'ADMIN'
  MANAGER: 'MANAGER'
  AGENT: 'AGENT'
}

export interface User {
  id: string
  email: string
  name: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT'
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
  customerName?: string
  customer?: { id?: string; name: string }
  amount: number
  outstanding: number
  currency: string
  status: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  description?: string | null
  issueDate: string
  dueDate: string
  tenantId: string
  createdAt?: string
  updatedAt?: string
}

export type PaymentMethod =
  | 'BANK_TRANSFER'
  | 'UPI'
  | 'CHEQUE'
  | 'CASH'
  | 'CARD'
  | 'PAYMENT_LINK'
  | 'OTHER'

export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'

export interface Payment {
  id: string
  ref: string
  customerId: string
  customer?: { id: string; name: string }
  invoiceId: string
  invoice?: { id: string; number: string }
  amount: number
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  providerRef?: string | null
  paidAt?: string | null
  notes?: string | null
  tenantId: string
  createdAt: string
  updatedAt?: string
}

export interface PaymentStats {
  totalCollected: number
  totalPayments: number
  byMethod: Array<{ method: string; amount: number; count: number }>
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
export type NotifStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED'

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

// ── Phase 7: Integrations (Payment Links, WhatsApp, SIP Telephony) ───────────

export type IntegrationProvider = 'RAZORPAY' | 'STRIPE' | 'WHATSAPP_CLOUD' | 'SIP_TELEPHONY'

export interface IntegrationConfigItem {
  id: string
  provider: string
  isActive: boolean
  config: Record<string, any>
  tenantId: string
  createdAt: string
  updatedAt: string
}

export interface PaymentLinkRequest {
  invoiceId: string
  provider?: 'RAZORPAY' | 'STRIPE'
  description?: string
}

export interface PaymentLinkResponse {
  paymentLinkId: string
  paymentId?: string
  provider: 'RAZORPAY' | 'STRIPE'
  shortUrl: string
  amount: number
  currency: string
  status: string
  invoiceId: string
  invoiceNumber?: string
  isSimulated: boolean
}

// ── Document Delivery & Verification ──────────────────────────────────────────

export type CallType = 'COLLECTIONS' | 'DISPUTE' | 'CALLBACK'

export type DocumentRequestType = 'INVOICE' | 'PAYMENT_LINK' | 'BOTH'
export type DeliveryChannelPreference = 'WHATSAPP' | 'EMAIL' | 'WHATSAPP_AND_EMAIL'
export type DocumentDeliveryStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
export type DeliveryAttemptChannel = 'WHATSAPP' | 'EMAIL'
export type DeliveryAttemptStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'SIMULATED'
  | 'SKIPPED'

export interface DeliveryAttempt {
  id: string
  tenantId: string
  requestId: string
  channel: DeliveryAttemptChannel
  destinationMasked: string
  status: DeliveryAttemptStatus
  provider: string
  providerMessageId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  sentAt?: string | null
  deliveredAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface DocumentDeliveryRequest {
  id: string
  tenantId: string
  customerId: string
  invoiceId: string
  callSessionId?: string | null
  requestType: DocumentRequestType
  deliveryChannel: DeliveryChannelPreference
  status: DocumentDeliveryStatus
  requestedBy: string
  idempotencyKey?: string | null
  metadata?: Record<string, any> | null
  requestedAt: string
  createdAt: string
  updatedAt: string
  customer?: { id: string; name: string; phone?: string; email?: string }
  invoice?: { id: string; number: string; amount: number; outstanding: number; status: string }
  attempts?: DeliveryAttempt[]
}

export interface CreateDocumentDeliveryDto {
  customerId: string
  invoiceId?: string
  callSessionId?: string
  requestType?: DocumentRequestType
  deliveryChannel?: DeliveryChannelPreference
  requestedBy?: string
  resend?: boolean
  idempotencyKey?: string
  notes?: string
}

export interface DocumentDeliveryResponse {
  request: DocumentDeliveryRequest
  isDuplicate: boolean
  message?: string
}

export interface SignedInvoicePayload {
  tenantId: string
  invoiceId: string
  customerId: string
  exp: number
}

export interface StructuredCallSummary {
  customerName: string
  customerId?: string
  invoiceNumber?: string
  callDateTime: string
  durationSeconds: number
  formattedDuration: string
  callType: CallType
  reasonForCall: string
  customerMainResponse: string
  outcomeCategory: string
  paymentCommitment: 'NONE' | 'TENTATIVE' | 'CONFIRMED'
  commitmentAmount?: string | null
  commitmentDate?: string | null
  paymentMethod?: string | null
  customerReportedPayment?: {
    claimedAmount?: string | null
    claimedDate?: string | null
    utrOrReference?: string | null
  } | null
  disputeDetails?: {
    reason?: string | null
    disputedAmount?: string | null
  } | null
  callbackRequest?: {
    requestedTime?: string | null
    preferredContact?: string | null
  } | null
  humanHandoffRequested: boolean
  noContactStatus?: {
    isNoContact: boolean
    reason?: string | null
  } | null
  nextAction: string
  shortSummary: string
  documentDelivery?: {
    requestType: string
    invoiceNumber: string
    deliveryChannel: string
    status: string
    requestedAt?: string
    paymentLinkUrl?: string | null
    attempts?: Array<{
      channel: string
      destinationMasked: string
      status: string
      errorMessage?: string | null
      provider?: string
      sentAt?: string | null
      deliveredAt?: string | null
    }>
  } | null
}

export interface TelephonyCallRequest {
  customerId: string
  phone?: string
  collectionCaseId?: string
  reason?: string
}

export interface TelephonyCallResponse {
  callId: string
  provider: string
  status: string
  isSimulated: boolean
  message: string
  sessionId?: string
}
export type CallOutcome =
  | 'PROMISE_TO_PAY'
  | 'DISPUTE'
  | 'NO_CONTACT'
  | 'CALLBACK_REQUESTED'
  | 'RESOLVED'
  | 'OTHER'
  | 'WILL_PAY_LATER'
  | 'UNABLE_TO_PAY'
  | 'PAYMENT_CLAIMED'

// ── Application-Wide Chotu AI Chatbot ─────────────────────────────────────────

export interface ChotuChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: string
  suggestedQuestions?: string[]
  suggestedRoute?: string
}

export interface ChotuChatRequest {
  message: string
  conversationId?: string
  currentPage?: string
  selectedRecordId?: string
}

export interface ChotuChatResponse {
  reply: string
  suggestedQuestions: string[]
  conversationId: string
  dataUnavailable?: boolean
  suggestedRoute?: string
}

