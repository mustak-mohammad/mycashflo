import apiClient from './client'

export interface CompanyProfile {
  legalName?: string
  gstin?: string
  pan?: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  phone?: string
  contactEmail?: string
  currency?: string
  defaultPaymentTermsDays?: number
  contactPreferences?: {
    allowSms?: boolean
    allowWhatsapp?: boolean
    allowEmail?: boolean
    allowCalls?: boolean
    autoOutreachEnabled?: boolean
  }
}

export interface OnboardingStatus {
  tenantId?: string
  currentStep: 'COMPANY_DETAILS' | 'CUSTOMERS' | 'INVOICES' | 'PAYMENTS' | 'COMPLETE'
  nextStepTitle?: string
  completedSteps: string[]
  missingSteps: string[]
  completionPercentage: number
  progressPercentage?: number
  isComplete: boolean
  isReadyForCollections?: boolean
  companyProfile?: CompanyProfile
  counts: {
    customers: number
    invoices: number
    payments: number
  }
  metrics?: {
    customerCount: number
    invoiceCount: number
    paymentCount: number
    totalOutstandingReceivables: number
  }
  checklist?: Array<{
    id: string
    key?: string
    title: string
    description: string
    required?: boolean
    completed: boolean
    count?: number
  }>
}

export interface ImportPreviewRow {
  rowNumber: number
  error?: string
  isValid: boolean
  [key: string]: any
}

export interface ImportPreviewResult {
  summary: {
    totalRows: number
    validRows: number
    invalidRows: number
    totalCustomers: number
    totalInvoices: number
    totalPayments: number
    totalReceivables: number
    totalCollected: number
    netOutstandingBalance: number
    hasErrors: boolean
  }
  customers: Array<{
    rowNumber: number
    name: string
    phone: string
    email?: string
    customerReference?: string
    gstNumber?: string
    billingAddress?: string
    openingBalance?: number
    calculatedBalance: number
    error?: string
    isValid: boolean
  }>
  invoices: Array<{
    rowNumber: number
    number: string
    customerReference?: string
    customerName?: string
    amount: number
    issueDate: string
    dueDate: string
    description?: string
    error?: string
    isValid: boolean
  }>
  payments: Array<{
    rowNumber: number
    invoiceNumber?: string
    customerReference?: string
    amount: number
    paymentDate: string
    reference?: string
    method?: string
    error?: string
    isValid: boolean
  }>
  validationErrors: Array<{
    rowNumber: number
    entity: 'CUSTOMER' | 'INVOICE' | 'PAYMENT'
    reference?: string
    field?: string
    error: string
  }>
}

export interface ImportExecutionResult {
  success: boolean
  summary: any
  importedCount: number
  errors: Array<{ rowNumber: number; entity: string; error: string }>
  customersCreated: number
  invoicesCreated: number
  paymentsRecorded: number
}

export const onboardingApi = {
  getCompanyProfile: () =>
    apiClient.get<any>('/onboarding/company').then((r) => r.data),

  saveCompanyProfile: (data: CompanyProfile) =>
    apiClient.post<any>('/onboarding/company', data).then((r) => r.data),

  getStatus: () =>
    apiClient.get<OnboardingStatus>('/onboarding/status').then((r) => r.data),

  previewFinancialData: (data: {
    customers?: any[]
    invoices?: any[]
    payments?: any[]
  }) => apiClient.post<ImportPreviewResult>('/onboarding/preview', data).then((r) => r.data),

  previewCsv: (csvText: string) =>
    apiClient.post<ImportPreviewResult>('/onboarding/preview/csv', { csvText }).then((r) => r.data),

  importFinancialData: (data: {
    customers?: any[]
    invoices?: any[]
    payments?: any[]
  }) => apiClient.post<ImportExecutionResult>('/onboarding/import', data).then((r) => r.data),

  importCsv: (csvText: string) =>
    apiClient.post<ImportExecutionResult>('/onboarding/import/csv', { csvText }).then((r) => r.data),
}
