import { useState, useEffect } from 'react'
import {
  onboardingApi,
  type CompanyProfile,
  type OnboardingStatus,
  type ImportPreviewResult,
} from '../../api/onboarding'
import { customersApi } from '../../api/customers'
import { invoicesApi } from '../../api/invoices'
import { paymentsApi } from '../../api/payments'

interface OnboardingWizardModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete?: () => void
}

type TabType = 'PROFILE' | 'MANUAL_ENTRY' | 'CSV_IMPORT' | 'PREVIEW' | 'CHECKLIST'

export function OnboardingWizardModal({
  isOpen,
  onClose,
  onComplete,
}: OnboardingWizardModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('PROFILE')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Step 1: Company Profile Form State
  const [profile, setProfile] = useState<CompanyProfile>({
    legalName: '',
    gstin: '',
    pan: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    phone: '',
    contactEmail: '',
    currency: 'INR',
    defaultPaymentTermsDays: 30,
    contactPreferences: {
      allowSms: true,
      allowWhatsapp: true,
      allowEmail: true,
      allowCalls: false,
      autoOutreachEnabled: false,
    },
  })

  // Step 2: Manual Customer Form
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    customerReference: '',
    gstNumber: '',
    billingAddress: '',
  })
  const [customerSavedList, setCustomerSavedList] = useState<any[]>([])

  // Step 3: Manual Invoice Form
  const [invoiceForm, setInvoiceForm] = useState(() => ({
    customerId: '',
    number: '',
    amount: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    description: '',
  }))
  const [invoiceSavedList, setInvoiceSavedList] = useState<any[]>([])

  // Step 4: Manual Payment Form
  const [paymentForm, setPaymentForm] = useState(() => ({
    invoiceId: '',
    amount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    reference: '',
    method: 'BANK_TRANSFER',
    notes: '',
  }))
  const [paymentSavedList, setPaymentSavedList] = useState<any[]>([])

  // Step 5: CSV / Excel Import State
  const [csvText, setCsvText] = useState('')
  const [previewData, setPreviewData] = useState<ImportPreviewResult | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  async function loadInitialData() {
    setLoading(true)
    setErrorMsg(null)
    try {
      const [statusRes, profileRes, custListRes] = await Promise.all([
        onboardingApi.getStatus().catch(() => null),
        onboardingApi.getCompanyProfile().catch(() => null),
        customersApi.list({ limit: 100 }).catch(() => ({ data: [] })),
      ])

      if (statusRes) setStatus(statusRes)
      if (profileRes?.companyDetails) {
        setProfile((prev) => ({
          ...prev,
          ...profileRes.companyDetails,
        }))
      } else if (profileRes?.name) {
        setProfile((prev) => ({
          ...prev,
          legalName: profileRes.name,
        }))
      }
      if (custListRes?.data) {
        setCustomerSavedList(custListRes.data)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load onboarding status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadInitialData()
    }
  }, [isOpen])

  function getErrorMessage(err: any, fallback: string): string {
    const errData = err.response?.data
    if (errData?.message) {
      if (Array.isArray(errData.message)) {
        return errData.message.join(' • ')
      }
      return String(errData.message)
    }
    return err.message || fallback
  }

  // Handle Save Profile
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    try {
      const payload: any = {
        companyName: profile.legalName?.trim() || 'My Company',
        legalName: profile.legalName?.trim() || '',
        gstin: profile.gstin?.trim() || undefined,
        pan: profile.pan?.trim() || undefined,
        phone: profile.phone?.trim() || undefined,
        email: profile.contactEmail?.trim() || undefined,
        contactEmail: profile.contactEmail?.trim() || undefined,
        address: profile.address?.trim() || undefined,
        billingAddress: profile.address?.trim() || undefined,
        city: profile.city?.trim() || undefined,
        state: profile.state?.trim() || undefined,
        postalCode: profile.postalCode?.trim() || undefined,
        currency: profile.currency || 'INR',
        defaultPaymentTerms: profile.defaultPaymentTermsDays || 30,
        defaultPaymentTermsDays: profile.defaultPaymentTermsDays || 30,
        defaultCreditDays: profile.defaultPaymentTermsDays || 30,
        contactPreferences: profile.contactPreferences,
      }
      await onboardingApi.saveCompanyProfile(payload)
      setSuccessMsg('Company details saved successfully.')
      const updatedStatus = await onboardingApi.getStatus()
      setStatus(updatedStatus)
      setActiveTab('MANUAL_ENTRY')
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to save company profile'))
    } finally {
      setLoading(false)
    }
  }

  // Handle Create Customer
  async function handleAddCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!customerForm.name || !customerForm.phone) {
      setErrorMsg('Customer name and phone number are required.')
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const created = await customersApi.create(customerForm)
      setCustomerSavedList((prev) => [created, ...prev])
      setCustomerForm({
        name: '',
        phone: '',
        email: '',
        company: '',
        customerReference: '',
        gstNumber: '',
        billingAddress: '',
      })
      setSuccessMsg(`Customer "${created.name}" created.`)
      const updatedStatus = await onboardingApi.getStatus()
      setStatus(updatedStatus)
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to create customer'))
    } finally {
      setLoading(false)
    }
  }

  // Handle Create Invoice
  async function handleAddInvoice(e: React.FormEvent) {
    e.preventDefault()
    const amountNum = parseFloat(invoiceForm.amount)
    if (!invoiceForm.number || !invoiceForm.customerId || isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg('Please specify a valid invoice number, customer, and positive amount.')
      return
    }
    if (new Date(invoiceForm.dueDate) < new Date(invoiceForm.issueDate)) {
      setErrorMsg('Due date cannot be earlier than issue date.')
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const created = await invoicesApi.create({
        number: invoiceForm.number,
        customerId: invoiceForm.customerId,
        amount: amountNum,
        issueDate: invoiceForm.issueDate,
        dueDate: invoiceForm.dueDate,
        description: invoiceForm.description,
      })
      setInvoiceSavedList((prev) => [created, ...prev])
      setInvoiceForm({
        customerId: invoiceForm.customerId,
        number: '',
        amount: '',
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        description: '',
      })
      setSuccessMsg(`Invoice "${created.number}" created.`)
      const updatedStatus = await onboardingApi.getStatus()
      setStatus(updatedStatus)
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to create invoice'))
    } finally {
      setLoading(false)
    }
  }

  // Handle Record Payment
  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault()
    const amountNum = parseFloat(paymentForm.amount)
    if (!paymentForm.invoiceId || !paymentForm.reference || isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg('Please specify invoice, reference number, and a positive payment amount.')
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const recorded = await paymentsApi.recordPayment({
        invoiceId: paymentForm.invoiceId,
        amount: amountNum,
        paymentDate: paymentForm.paymentDate,
        reference: paymentForm.reference,
        method: paymentForm.method,
        notes: paymentForm.notes,
      })
      setPaymentSavedList((prev) => [recorded, ...prev])
      setPaymentForm({
        invoiceId: '',
        amount: '',
        paymentDate: new Date().toISOString().slice(0, 10),
        reference: '',
        method: 'BANK_TRANSFER',
        notes: '',
      })
      setSuccessMsg('Payment settlement recorded.')
      const updatedStatus = await onboardingApi.getStatus()
      setStatus(updatedStatus)
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to record payment'))
    } finally {
      setLoading(false)
    }
  }

  // Handle File Upload or Paste for Preview
  async function handlePreviewCsv() {
    if (!csvText.trim()) {
      setErrorMsg('Please paste or upload CSV or Excel spreadsheet content.')
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await onboardingApi.previewCsv(csvText)
      setPreviewData(res)
      setActiveTab('PREVIEW')
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to preview CSV/Excel data'))
    } finally {
      setLoading(false)
    }
  }

  // Handle File Drag & Drop / Selection
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setCsvText(content)
      setSuccessMsg(`File "${file.name}" loaded (${Math.round(file.size / 1024)} KB). Click 'Preview Import' to validate.`)
    }
    reader.readAsText(file)
  }

  // Execute Financial Import after preview verification
  async function handleExecuteImport() {
    if (!previewData || previewData.summary.invalidRows > 0) {
      setErrorMsg('Please resolve all validation errors before executing import.')
      return
    }
    setIsImporting(true)
    setErrorMsg(null)
    try {
      const res = await onboardingApi.importCsv(csvText)
      setSuccessMsg(
        `Import completed! Created ${res.customersCreated} customer(s), ${res.invoicesCreated} invoice(s), and ${res.paymentsRecorded} payment(s).`,
      )
      const updatedStatus = await onboardingApi.getStatus()
      setStatus(updatedStatus)
      setActiveTab('CHECKLIST')
      if (onComplete) onComplete()
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Financial import failed'))
    } finally {
      setIsImporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div
        className="w-full max-w-5xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
        style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 text-lg">🚀</span>
            <div>
              <h2 className="text-base font-semibold text-white">Company Setup & Financial Onboarding</h2>
              <p className="text-xs text-white/50">
                Setup your business profile, register customers, and import invoice/payment ledgers safely.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress Bar & Status Pill */}
        <div className="px-6 py-3 bg-white/[0.01] border-b border-white/5 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-white/60 font-medium">Onboarding Readiness</span>
              <span className="text-indigo-400 font-semibold">{status?.completionPercentage ?? status?.progressPercentage ?? 0}% Complete</span>
            </div>
            <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${status?.completionPercentage ?? status?.progressPercentage ?? 0}%` }}
              />
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-xs text-white/60">
            <span>👥 {status?.counts?.customers ?? status?.metrics?.customerCount ?? customerSavedList.length} Customers</span>
            <span>•</span>
            <span>🧾 {status?.counts?.invoices ?? status?.metrics?.invoiceCount ?? invoiceSavedList.length} Invoices</span>
            <span>•</span>
            <span>💳 {status?.counts?.payments ?? status?.metrics?.paymentCount ?? paymentSavedList.length} Payments</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-white/10 flex gap-1 bg-white/[0.01] overflow-x-auto text-xs">
          {[
            { id: 'PROFILE', label: '1. Company Profile' },
            { id: 'MANUAL_ENTRY', label: '2. Manual Entry (Customers & Invoices)' },
            { id: 'CSV_IMPORT', label: '3. CSV / Excel File Import' },
            { id: 'PREVIEW', label: '4. Reconciliation & Preview' },
            { id: 'CHECKLIST', label: '5. Missing Steps & Checklist' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-3 font-medium transition-colors border-b-2 whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-white/50 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Alerts Banner */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-200">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
            <span>✅ {successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200">✕</button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 text-xs">
          {/* TAB 1: Company Profile */}
          {activeTab === 'PROFILE' && (
            <form onSubmit={handleSaveProfile} className="space-y-5 max-w-3xl">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 text-xs">
                🛡️ <strong>Safety Policy Guard:</strong> Automatic customer communication is strictly suppressed during onboarding and financial import.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-white/70 mb-1">Company Legal Name *</label>
                  <input
                    type="text"
                    required
                    value={profile.legalName || ''}
                    onChange={(e) => setProfile({ ...profile, legalName: e.target.value })}
                    placeholder="e.g. Acme Innovations Pvt Ltd"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">GSTIN / Tax ID</label>
                  <input
                    type="text"
                    value={profile.gstin || ''}
                    onChange={(e) => setProfile({ ...profile, gstin: e.target.value.toUpperCase() })}
                    placeholder="27AABCU9603R1ZM (or Tax ID)"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-white/40 mt-1">15-char Indian GSTIN or 8–20 char Tax ID (optional)</p>
                </div>

                <div>
                  <label className="block text-white/70 mb-1">PAN Number</label>
                  <input
                    type="text"
                    value={profile.pan || ''}
                    onChange={(e) => setProfile({ ...profile, pan: e.target.value.toUpperCase() })}
                    placeholder="ABCDE1234F"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-white/40 mt-1">10-character PAN or business tax code (optional)</p>
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Primary Business Phone *</label>
                  <input
                    type="text"
                    required
                    value={profile.phone || ''}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Billing & Contact Email</label>
                  <input
                    type="email"
                    value={profile.contactEmail || ''}
                    onChange={(e) => setProfile({ ...profile, contactEmail: e.target.value })}
                    placeholder="finance@acme.com"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Default Payment Terms (Days)</label>
                  <input
                    type="number"
                    min="0"
                    value={profile.defaultPaymentTermsDays || 30}
                    onChange={(e) => setProfile({ ...profile, defaultPaymentTermsDays: parseInt(e.target.value) || 30 })}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-white/70 mb-1">Registered Business Address</label>
                  <textarea
                    rows={2}
                    value={profile.address || ''}
                    onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                    placeholder="Floor 4, Tower B, Cyber City..."
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">City</label>
                  <input
                    type="text"
                    value={profile.city || ''}
                    onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                    placeholder="Mumbai"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">State / Province</label>
                  <input
                    type="text"
                    value={profile.state || ''}
                    onChange={(e) => setProfile({ ...profile, state: e.target.value })}
                    placeholder="Maharashtra"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-900/30 cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save & Continue to Data Entry →'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: Manual Data Entry */}
          {activeTab === 'MANUAL_ENTRY' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Add Customer */}
                <div className="p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Customer</h3>
                    <span className="text-[10px] text-indigo-400 font-mono">1. Customers</span>
                  </div>
                  <form onSubmit={handleAddCustomer} className="space-y-2.5">
                    <div>
                      <label className="text-white/60 text-[10px]">Customer Name *</label>
                      <input
                        type="text"
                        required
                        value={customerForm.name}
                        onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                        placeholder="Rajesh Kumar"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Phone Number *</label>
                      <input
                        type="text"
                        required
                        value={customerForm.phone}
                        onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                        placeholder="+91 98765 00000"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Email</label>
                      <input
                        type="email"
                        value={customerForm.email}
                        onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                        placeholder="rajesh@example.com"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Customer Reference / Code</label>
                      <input
                        type="text"
                        value={customerForm.customerReference}
                        onChange={(e) => setCustomerForm({ ...customerForm, customerReference: e.target.value })}
                        placeholder="CUST-001"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">GSTIN</label>
                      <input
                        type="text"
                        value={customerForm.gstNumber}
                        onChange={(e) => setCustomerForm({ ...customerForm, gstNumber: e.target.value.toUpperCase() })}
                        placeholder="27AABCU9603R1ZM"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      + Save Customer
                    </button>
                  </form>
                </div>

                {/* 2. Add Invoice */}
                <div className="p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Create Invoice</h3>
                    <span className="text-[10px] text-indigo-400 font-mono">2. Invoices</span>
                  </div>
                  <form onSubmit={handleAddInvoice} className="space-y-2.5">
                    <div>
                      <label className="text-white/60 text-[10px]">Customer *</label>
                      <select
                        required
                        value={invoiceForm.customerId}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, customerId: e.target.value })}
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      >
                        <option value="">Select customer...</option>
                        {customerSavedList.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.phone})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Invoice Number *</label>
                      <input
                        type="text"
                        required
                        value={invoiceForm.number}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, number: e.target.value.toUpperCase() })}
                        placeholder="INV-2026-001"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Invoice Amount (₹) *</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={invoiceForm.amount}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                        placeholder="50000"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-white/60 text-[10px]">Issue Date *</label>
                        <input
                          type="date"
                          required
                          value={invoiceForm.issueDate}
                          onChange={(e) => setInvoiceForm({ ...invoiceForm, issueDate: e.target.value })}
                          className="w-full p-1.5 rounded bg-black/40 border border-white/10 text-white"
                        />
                      </div>
                      <div>
                        <label className="text-white/60 text-[10px]">Due Date *</label>
                        <input
                          type="date"
                          required
                          value={invoiceForm.dueDate}
                          onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
                          className="w-full p-1.5 rounded bg-black/40 border border-white/10 text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Description</label>
                      <input
                        type="text"
                        value={invoiceForm.description}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                        placeholder="Consulting Services"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading || customerSavedList.length === 0}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      + Save Invoice
                    </button>
                  </form>
                </div>

                {/* 3. Record Payment */}
                <div className="p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Record Payment</h3>
                    <span className="text-[10px] text-indigo-400 font-mono">3. Payments</span>
                  </div>
                  <form onSubmit={handleRecordPayment} className="space-y-2.5">
                    <div>
                      <label className="text-white/60 text-[10px]">Target Invoice *</label>
                      <select
                        required
                        value={paymentForm.invoiceId}
                        onChange={(e) => setPaymentForm({ ...paymentForm, invoiceId: e.target.value })}
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      >
                        <option value="">Select invoice...</option>
                        {invoiceSavedList.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.number} (₹{inv.outstanding || inv.amount})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Settlement Amount (₹) *</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                        placeholder="25000"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Payment Reference *</label>
                      <input
                        type="text"
                        required
                        value={paymentForm.reference}
                        onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                        placeholder="UTR / IMPS / Txn ID"
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Payment Method</label>
                      <select
                        value={paymentForm.method}
                        onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      >
                        <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                        <option value="UPI">UPI</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="CARD">Debit/Credit Card</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-white/60 text-[10px]">Payment Date</label>
                      <input
                        type="date"
                        value={paymentForm.paymentDate}
                        onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                        className="w-full p-2 rounded bg-black/40 border border-white/10 text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading || invoiceSavedList.length === 0}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      + Record Payment
                    </button>
                  </form>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/10 rounded-xl">
                <div>
                  <h4 className="text-white font-medium">Have many records to import?</h4>
                  <p className="text-white/50 text-[11px]">
                    You can bulk import customers, invoices, and payment histories using CSV or Excel.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('CSV_IMPORT')}
                  className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg border border-indigo-500/40 font-medium transition-colors cursor-pointer"
                >
                  Switch to Bulk File Import →
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: CSV / Excel Bulk Import */}
          {activeTab === 'CSV_IMPORT' && (
            <div className="space-y-4">
              <div className="p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Bulk File Import (CSV or Excel SpreadsheetML)</h3>
                    <p className="text-white/50 text-[11px] mt-0.5">
                      Upload your CSV file, or copy and paste rows directly from Excel / Google Sheets.
                    </p>
                  </div>
                  <label className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium cursor-pointer transition-colors shadow-lg shadow-indigo-900/30 shrink-0 text-center">
                    📁 Choose CSV / Excel File
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.xml,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="bg-black/40 border border-white/10 rounded-xl p-3 text-[11px] space-y-1 font-mono text-white/70">
                  <div className="text-indigo-300 font-semibold mb-1 font-sans">Supported Column Headers:</div>
                  <div>• Customers: <span className="text-white">Customer Name, Phone, Email, Reference, GSTIN</span></div>
                  <div>• Invoices: <span className="text-white">Invoice Number, Amount, Issue Date, Due Date, Description</span></div>
                  <div>• Payments: <span className="text-white">Payment Amount, Payment Date, Payment Reference, Method</span></div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-white/70 font-medium">Or Paste CSV / Tab-Separated Text Here:</label>
                    <button
                      type="button"
                      onClick={() =>
                        setCsvText(
                          `Customer Name,Phone,Email,Invoice Number,Invoice Amount,Issue Date,Due Date,Payment Amount,Payment Ref\nRajesh Enterprises,+919876543210,rajesh@rajent.in,INV-2026-001,45000,2026-09-01,2026-10-01,15000,UTR-991823\nSharma Logistics,+919812345678,billing@sharma.in,INV-2026-002,32000,2026-09-15,2026-10-15,,`,
                        )
                      }
                      className="text-indigo-400 hover:text-indigo-300 underline text-[10px]"
                    >
                      Paste Sample Template
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder="Customer Name,Phone,Email,Invoice Number,Invoice Amount,Issue Date,Due Date..."
                    className="w-full p-3 rounded-xl bg-black/60 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handlePreviewCsv}
                    disabled={loading || !csvText.trim()}
                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-900/30 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? 'Analyzing & Validating...' : 'Preview & Validate Data →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Reconciliation & Preview Table */}
          {activeTab === 'PREVIEW' && (
            <div className="space-y-5">
              {!previewData ? (
                <div className="p-8 text-center text-white/50 bg-white/[0.02] border border-white/10 rounded-2xl">
                  No preview generated yet. Enter or upload CSV data first.
                </div>
              ) : (
                <>
                  {/* Summary Metric Strip */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
                      <div className="text-white/50 text-[10px]">Total Parsed Rows</div>
                      <div className="text-base font-bold text-white mt-0.5">
                        {previewData.summary.totalRows} ({previewData.summary.validRows} valid)
                      </div>
                    </div>
                    <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
                      <div className="text-white/50 text-[10px]">Total Receivables</div>
                      <div className="text-base font-bold text-white mt-0.5">
                        ₹{previewData.summary.totalReceivables.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
                      <div className="text-white/50 text-[10px]">Settled Payments</div>
                      <div className="text-base font-bold text-emerald-400 mt-0.5">
                        ₹{previewData.summary.totalCollected.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
                      <div className="text-white/50 text-[10px]">Calculated Net Balance</div>
                      <div className="text-base font-bold text-indigo-400 mt-0.5">
                        ₹{previewData.summary.netOutstandingBalance.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* Validation Error Notices if any */}
                  {previewData.validationErrors.length > 0 && (
                    <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl space-y-2">
                      <div className="text-rose-300 font-semibold text-xs flex items-center gap-2">
                        <span>⚠️ Found {previewData.validationErrors.length} validation issue(s):</span>
                      </div>
                      <ul className="space-y-1 text-[11px] text-rose-200/80 max-h-36 overflow-y-auto">
                        {previewData.validationErrors.map((err, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="font-mono text-rose-400">Row {err.rowNumber}:</span>
                            <span>{err.error}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Parsed Invoices Preview */}
                  <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-white flex items-center justify-between">
                      <span>Invoices Preview ({previewData.invoices.length})</span>
                      <span className="text-[10px] text-white/40">Verified against DB duplicates</span>
                    </h4>
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-left text-[11px]">
                        <thead className="border-b border-white/10 text-white/40 uppercase sticky top-0 bg-[#13141c]">
                          <tr>
                            <th className="py-2">Row</th>
                            <th className="py-2">Inv #</th>
                            <th className="py-2">Customer</th>
                            <th className="py-2">Amount</th>
                            <th className="py-2">Due Date</th>
                            <th className="py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {previewData.invoices.map((inv, idx) => (
                            <tr key={idx} className="hover:bg-white/[0.02]">
                              <td className="py-1.5 font-mono text-white/50">{inv.rowNumber}</td>
                              <td className="py-1.5 font-medium text-white">{inv.number}</td>
                              <td className="py-1.5 text-white/70">{inv.customerName || inv.customerReference || '—'}</td>
                              <td className="py-1.5 text-white font-semibold">₹{Number(inv.amount).toLocaleString('en-IN')}</td>
                              <td className="py-1.5 text-white/60">{inv.dueDate}</td>
                              <td className="py-1.5">
                                {inv.isValid ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">Valid</span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px]">{inv.error}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Action Bar */}
                  <div className="flex items-center justify-between pt-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('CSV_IMPORT')}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      ← Edit CSV Content
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteImport}
                      disabled={isImporting || previewData.summary.invalidRows > 0}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-emerald-900/30 cursor-pointer disabled:opacity-50"
                    >
                      {isImporting ? 'Saving Records...' : 'Confirm & Commit Import to Tenant'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 5: Missing Steps & Checklist */}
          {activeTab === 'CHECKLIST' && (
            <div className="space-y-5">
              {status?.isComplete && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs flex items-center gap-3">
                  <span className="text-xl">🎉</span>
                  <div>
                    <h4 className="font-semibold text-white">Setup Complete & Verified!</h4>
                    <p className="text-white/60 text-[11px] mt-0.5">
                      Your business profile, customer directory, and invoice ledger are fully registered. Real-time collections intelligence and aging widgets are unlocked.
                    </p>
                  </div>
                </div>
              )}

              <div className="p-4 bg-white/[0.02] border border-white/10 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Setup Progress & Verification</h3>
                  <span className="text-xs font-semibold text-indigo-400">
                    {status?.completionPercentage ?? status?.progressPercentage ?? 0}% Completed
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    {
                      key: 'COMPANY_DETAILS',
                      label: 'Company Profile & Setup Preferences',
                      done: status?.completedSteps?.includes('COMPANY_DETAILS') || !!status?.checklist?.find((c) => c.id === 'COMPANY_DETAILS')?.completed,
                      required: true,
                    },
                    {
                      key: 'CUSTOMERS',
                      label: 'Customer Directory Populated',
                      done: (status?.counts?.customers ?? status?.metrics?.customerCount ?? 0) > 0,
                      required: true,
                    },
                    {
                      key: 'INVOICES',
                      label: 'Receivables Invoices Recorded',
                      done: (status?.counts?.invoices ?? status?.metrics?.invoiceCount ?? 0) > 0,
                      required: true,
                    },
                    {
                      key: 'PAYMENTS',
                      label: 'Historical Payments / Settlements (Optional)',
                      done: (status?.counts?.payments ?? status?.metrics?.paymentCount ?? 0) > 0,
                      required: false,
                    },
                  ].map((step) => (
                    <div
                      key={step.key}
                      className={`p-3 rounded-xl border flex items-center justify-between ${
                        step.done
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-white/[0.02] border-white/5 text-white/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-base">{step.done ? '✅' : step.required ? '⏳' : 'ℹ️'}</span>
                        <div>
                          <span className="font-medium text-white/90">{step.label}</span>
                          {!step.required && !step.done && (
                            <span className="text-[10px] text-white/40 block mt-0.5">Optional — not required if no payments yet</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono uppercase">
                        {step.done ? 'Completed' : step.required ? 'Pending' : 'Optional'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (onComplete) onComplete()
                    onClose()
                  }}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-lg shadow-indigo-900/30 cursor-pointer"
                >
                  Close & View Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
