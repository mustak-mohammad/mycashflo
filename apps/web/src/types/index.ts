/**
 * Shared TypeScript types between frontend and backend.
 */

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

export type ConsentState = 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT';

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  company?: string
  outstandingBalance: number
  currency: string
  status: 'ACTIVE' | 'INACTIVE'
  notes?: string
  createdAt: string
  tenantId: string
  emailConsent?: ConsentState
  emailConsentAt?: string
  emailConsentSource?: string
  whatsappConsent?: ConsentState
  whatsappConsentAt?: string
  whatsappConsentSource?: string
  smsConsent?: ConsentState
  smsConsentAt?: string
  smsConsentSource?: string
  voiceConsent?: ConsentState
  voiceConsentAt?: string
  voiceConsentSource?: string
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

import type {
  CallType,
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
  DeliveryAttempt,
  DocumentDeliveryRequest,
  CreateDocumentDeliveryDto,
  DocumentDeliveryResponse,
  SignedInvoicePayload,
} from '../../../../packages/shared-types'

export type {
  CallType,
  DocumentRequestType,
  DeliveryChannelPreference,
  DocumentDeliveryStatus,
  DeliveryAttemptChannel,
  DeliveryAttemptStatus,
  DeliveryAttempt,
  DocumentDeliveryRequest,
  CreateDocumentDeliveryDto,
  DocumentDeliveryResponse,
  SignedInvoicePayload,
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

export interface CallSession {
  id: string
  customerId?: string
  customer?: { id: string; name: string; phone?: string }
  agent?: { id: string; name: string; email: string }
  duration?: number
  outcome?: CallOutcome
  transcript?: string
  summary?: string
  stage?: string
  metadata?: Record<string, any>
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
  totalBilled?: number
  totalCollected?: number
  overdueAmount: number
  collectedThisMonth: number
  openInvoiceCount: number
  overdueInvoiceCount?: number
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
  agingBreakdown?: {
    d0_30: number
    d31_60: number
    d61_90: number
    d90plus: number
    thresholdOverdueAmount: number
    thresholdDays: number
  }
  recentPayments?: Array<{
    id: string
    amount: number
    currency: string
    paymentDate: string
    reference: string
    method: string
    customerName: string
    invoiceNumber: string
  }>
  collectionPriorities?: Array<{
    customerId: string
    customerName: string
    overdueAmount: number
    daysOverdue: number
    priority: string
    riskScore: number
  }>
  promisesToPay?: Array<{
    id: string
    promisedAmount: number
    promisedDate: string
    invoiceNumber: string
    customerName: string
    status: string
  }>
  pendingCallbacks?: Array<{
    id: string
    title: string
    dueDate: string
    priority: string
    customerName: string
  }>
  appliedFilters?: {
    dateRange: string
    agingThreshold: number
  }
}

export interface AgeingReport {
  d0_30: number
  d31_60: number
  d61_90: number
  d90plus: number
  total: number
}

export interface ReportSummary {
  totalReceivables?: number
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

// ── Phase 7: Integrations ────────────────────────────────────────────────────
export type IntegrationProvider = 'RAZORPAY' | 'STRIPE' | 'WHATSAPP_CLOUD' | 'SIP_TELEPHONY'

export interface IntegrationItem {
  id: string
  provider: string
  isActive: boolean
  config: Record<string, any>
  updatedAt: string
  isConfigured: boolean
}

export interface PaymentLinkResponse {
  paymentLinkId: string
  paymentId: string
  provider: 'RAZORPAY' | 'STRIPE'
  shortUrl: string
  amount: number
  currency: string
  status: string
  invoiceId: string
  invoiceNumber: string
  isSimulated: boolean
}

// ── Razorpay Orders API & Standard Checkout (Test Mode Only) ──────────────────
export interface CreateRazorpayOrderDto {
  invoiceId: string
  amount?: number
  currency?: string
  simulate?: boolean
  idempotencyKey?: string
}

export interface RazorpayOrderResponse {
  orderId: string
  paymentId: string
  provider: 'RAZORPAY'
  keyId: string
  amount: number
  amountInPaise: number
  currency: string
  receipt?: string
  invoiceId: string
  invoiceNumber: string
  customerName: string
  customerEmail: string
  customerPhone: string
  status: 'CREATED'
  reusedExistingOrder: boolean
  recovered?: boolean
  isSimulated: boolean
}

export interface VerifyRazorpayPaymentDto {
  invoiceId: string
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export interface VerifyRazorpayPaymentResponse {
  verified: boolean
  idempotent: boolean
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED'
  orderId: string
  providerPaymentId?: string
  paymentId?: string
  invoiceId: string
  invoiceNumber: string
  paidAmount?: number
  remainingOutstanding?: number
  overpaymentDetected?: boolean
  overpaymentAmount?: number
  invoiceStatus?: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | string
  message?: string
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export interface RazorpayFailureResponse {
  error: {
    code: string
    description: string
    source?: string
    step?: string
    reason?: string
    metadata?: {
      order_id?: string
      payment_id?: string
    }
  }
}

export interface RazorpayCheckoutOptions {
  key: string
  amount: number
  currency: string
  name: string
  description?: string
  image?: string
  order_id: string
  prefill?: {
    name?: string
    email?: string
    contact?: string
  }
  notes?: Record<string, string>
  theme?: {
    color?: string
    backdrop_color?: string
  }
  modal?: {
    ondismiss?: () => void
    escape?: boolean
    backdropclose?: boolean
    animation?: boolean
  }
  handler: (response: RazorpaySuccessResponse) => void
}

export interface RazorpayInstance {
  open: () => void
  close?: () => void
  on: (event: 'payment.failed', handler: (response: RazorpayFailureResponse) => void) => void
}

export interface RazorpayConstructor {
  new (options: RazorpayCheckoutOptions): RazorpayInstance
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

export interface TelephonyCallResponse {
  callSid: string
  provider: string
  status: string
  isSimulated: boolean
  notes: string
  sessionId: string
}

// ── Automated Reminders (Chotu AI) ──────────────────────────────────────────
export type ReminderStage =
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE_STAGE_1'
  | 'OVERDUE_STAGE_2'
  | 'OVERDUE_STAGE_3'

export type ReminderChannelPreference = 'EMAIL' | 'WHATSAPP' | 'BOTH' | 'DISABLED'

export interface TenantReminderSettings {
  enabled: boolean
  dryRun: boolean
  channels: ('EMAIL' | 'WHATSAPP')[]
  channelPreference: ReminderChannelPreference
  scheduleCron: string
  timezone: string
  quietHours: {
    startHour: number
    endHour: number
  }
  maxDailyPerCustomer: number
  minDaysBetweenReminders: number
  testRecipientEmail?: string
  testRecipientPhone?: string
  globalEnabled: boolean
}

export interface ReminderEvaluationItem {
  invoiceId: string
  invoiceNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  outstandingAmount: number
  dueDate: string
  daysOverdue: number
  stage: ReminderStage
  channel: 'EMAIL' | 'WHATSAPP' | 'BOTH'
  idempotencyKey: string
  isEligible: boolean
  suppressionReason?: string
  messagePreview?: {
    subject?: string
    message: string
    template: string
  }
  dispatchedNotificationId?: string
  dispatchStatus?: string
}

export interface RemindersRunSummary {
  tenantId: string
  evaluatedCount: number
  eligibleCount: number
  dispatchedCount: number
  suppressedCount: number
  failedCount: number
  isDryRun: boolean
  globalEnabled: boolean
  timestamp: string
  items: ReminderEvaluationItem[]
  totalTenantInvoices?: number
  settledInvoicesCount?: number
}

export interface ReminderStatsSummary {
  totalEvaluated: number
  sentCount: number
  deliveredCount: number
  failedCount: number
  suppressedCount: number
  pendingCount: number
  lastRunAt?: string
  isGloballyEnabled: boolean
  isTenantEnabled: boolean
  isDryRun: boolean
}

export interface ReminderHistoryItem {
  id: string
  customerId: string
  channel: string
  template: string
  status: string
  sentAt: string | null
  failReason: string | null
  createdAt: string
  customer: {
    id: string
    name: string
    email: string
    phone: string
  }
  payload?: Record<string, any>
}


