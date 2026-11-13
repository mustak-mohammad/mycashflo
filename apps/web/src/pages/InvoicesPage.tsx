import { useState, useCallback, useEffect, useRef } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { RazorpayCheckoutModal, isInvoicePayable } from '../components/payments/RazorpayCheckoutModal'
import { useApi } from '../hooks/useApi'
import { invoicesApi } from '../api/invoices'
import { paymentsApi } from '../api/payments'
import { customersApi } from '../api/customers'
import { voiceApi } from '../api/voice'
import { useAuth } from '../store/AuthContext'
import { useToast } from '../store/ToastContext'
import { extractSafeApiError, extractSafeErrorMessage } from '../utils/safeError'
import type { Invoice, PaymentLinkResponse, Customer, DocumentDeliveryRequest } from '../types'

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  DRAFT:          { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'Draft' },
  OPEN:           { bg: 'rgba(99,102,241,0.15)',  color: 'var(--primary)',    label: 'Open' },
  PARTIALLY_PAID: { bg: 'rgba(245,158,11,0.12)',  color: 'var(--warning)',    label: 'Partial' },
  PAID:           { bg: 'rgba(16,185,129,0.12)',  color: 'var(--accent)',     label: 'Paid' },
  OVERDUE:        { bg: 'rgba(239,68,68,0.12)',   color: 'var(--danger)',     label: 'Overdue' },
  CANCELLED:      { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'Cancelled' },
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'OPEN' },
  { label: 'Overdue', value: 'OVERDUE' },
  { label: 'Partial', value: 'PARTIALLY_PAID' },
  { label: 'Paid', value: 'PAID' },
]

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '70%' }} />
        </td>
      ))}
    </tr>
  )
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const canManageInvoices = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [customersLoadError, setCustomersLoadError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null)
  const [cancellingInvoice, setCancellingInvoice] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const cancelInFlightRef = useRef(false)
  const limit = 20

  // Create Invoice Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [customersList, setCustomersList] = useState<Customer[]>([])
  const [invNumber, setInvNumber] = useState('')
  const [invCustomerId, setInvCustomerId] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invIssueDate, setInvIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [invDueDate, setInvDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
  const [invDescription, setInvDescription] = useState('')
  const [invSubmitting, setInvSubmitting] = useState(false)
  const [invError, setInvError] = useState<string | null>(null)

  // Razorpay Checkout & Invoice Details state
  const [checkoutTargetInvoice, setCheckoutTargetInvoice] = useState<Invoice | null>(null)
  const [detailTargetInvoice, setDetailTargetInvoice] = useState<Invoice | null>(null)

  // Payment Link Modal state
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<'RAZORPAY' | 'STRIPE'>('RAZORPAY')
  const [generatingLink, setGeneratingLink] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<PaymentLinkResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Document Delivery History Modal state
  const [activeDeliveryHistoryInvoice, setActiveDeliveryHistoryInvoice] = useState<Invoice | null>(null)
  const [deliveryRequests, setDeliveryRequests] = useState<DocumentDeliveryRequest[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [deliveryHistoryError, setDeliveryHistoryError] = useState<string | null>(null)
  const [copiedHistoryLinkId, setCopiedHistoryLinkId] = useState<string | null>(null)

  const handleOpenDeliveryHistory = async (inv: Invoice) => {
    setActiveDeliveryHistoryInvoice(inv)
    setLoadingDeliveries(true)
    setDeliveryHistoryError(null)
    try {
      const res = await voiceApi.getDocumentDeliveryRequests({ invoiceId: inv.id })
      setDeliveryRequests(res.data || [])
    } catch (err: any) {
      setDeliveryHistoryError(err?.message || 'Failed to load delivery history')
    } finally {
      setLoadingDeliveries(false)
    }
  }

  const fetcher = useCallback(
    () => invoicesApi.list({ page, limit, status: statusFilter || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, statusFilter, refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  useEffect(() => {
    if (!canManageInvoices) return
    customersApi
      .list({ limit: 100 })
      .then((res) => {
        setCustomersList(res.data)
        setCustomersLoadError(null)
        if (res.data.length > 0 && !invCustomerId) {
          setInvCustomerId(res.data[0].id)
        }
      })
      .catch((err) => {
        setCustomersLoadError(extractSafeErrorMessage(err, 'Failed to load customers for invoice creation.'))
      })
  }, [canManageInvoices])

  const totalPages = data ? Math.ceil(data.total / limit) : 1

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(invAmount)
    if (!invNumber.trim() || !invCustomerId || isNaN(amt) || amt <= 0) {
      setInvError('Invoice number, customer, and positive amount are required.')
      return
    }
    if (new Date(invDueDate) < new Date(invIssueDate)) {
      setInvError('Due date cannot be earlier than issue date.')
      return
    }
    setInvSubmitting(true)
    setInvError(null)
    try {
      await invoicesApi.create({
        number: invNumber.trim().toUpperCase(),
        customerId: invCustomerId,
        amount: amt,
        issueDate: invIssueDate,
        dueDate: invDueDate,
        description: invDescription.trim() || undefined,
      })
      toast.success(`Invoice ${invNumber.trim().toUpperCase()} created.`)
      setIsCreateOpen(false)
      setInvNumber('')
      setInvAmount('')
      setInvDescription('')
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to create invoice.')
      setInvError(msg)
      toast.error(msg)
    } finally {
      setInvSubmitting(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setActionError(null)
    try {
      await invoicesApi.downloadCsv({ status: statusFilter || undefined })
      toast.success('Invoices CSV exported.')
    } catch (e: unknown) {
      const msg = await extractSafeApiError(e, 'Failed to export invoices CSV.')
      setActionError(msg)
      toast.error(msg)
    } finally {
      setExporting(false)
    }
  }

  const handleRowDownload = async (inv: Invoice) => {
    setDownloadingId(inv.id)
    setActionError(null)
    try {
      await invoicesApi.downloadPdf(inv.id, inv.number)
    } catch (e: unknown) {
      const msg = await extractSafeApiError(e, `Failed to download invoice ${inv.number} PDF.`)
      setActionError(msg)
      toast.error(msg)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleConfirmCancelInvoice = async () => {
    if (!cancelTarget || cancelInFlightRef.current) return
    cancelInFlightRef.current = true
    setCancellingInvoice(true)
    setCancelError(null)
    try {
      await invoicesApi.update(cancelTarget.id, { status: 'CANCELLED' })
      toast.success(`Invoice ${cancelTarget.number} cancelled.`)
      setCancelTarget(null)
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, `Failed to cancel invoice ${cancelTarget.number}.`)
      setCancelError(msg)
      toast.error(msg)
    } finally {
      setCancellingInvoice(false)
      cancelInFlightRef.current = false
    }
  }

  const handleOpenPayModal = (inv: Invoice) => {
    setActiveInvoice(inv)
    setSelectedProvider(inv.currency === 'USD' ? 'STRIPE' : 'RAZORPAY')
    setGeneratedLink(null)
    setCopied(false)
    setErrorMsg(null)
  }

  const handleGenerateLink = async () => {
    if (!activeInvoice) return
    setGeneratingLink(true)
    setErrorMsg(null)
    try {
      const res = await paymentsApi.createPaymentLink({
        invoiceId: activeInvoice.id,
        provider: selectedProvider,
      })
      setGeneratedLink(res)
    } catch (e: any) {
      setErrorMsg(e?.response?.data?.message || e.message || 'Failed to generate link')
    } finally {
      setGeneratingLink(false)
    }
  }

  const handleCopy = () => {
    if (!generatedLink?.shortUrl) return
    navigator.clipboard.writeText(generatedLink.shortUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Invoices"
        subtitle={`${data?.total ?? '…'} total invoices`}
        action={
          <div className="flex items-center gap-2">
            {canManageInvoices && (
              <button
                onClick={() => {
                  setInvError(null)
                  setIsCreateOpen(true)
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer"
              >
                + Create Invoice
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              style={{
                background: '#059669',
                color: '#ffffff',
                border: 'none',
                cursor: exporting ? 'wait' : 'pointer',
              }}
            >
              <span>📥</span>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        }
      />

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Status filter tabs */}
        <div className="px-5 py-3 flex items-center gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1) }}
              className="px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all"
              style={statusFilter === f.value
                ? { background: 'var(--primary)', color: '#fff' }
                : { background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
              }
            >
              {f.label}
            </button>
          ))}
          {loading && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>Loading…</span>}
        </div>

        {(error || actionError) && (
          <div role="alert" className="px-5 py-3 text-sm flex items-center justify-between gap-3" style={{ color: 'var(--danger)' }}>
            <span>⚠️ {actionError || error}</span>
            {actionError && (
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-xs underline cursor-pointer bg-transparent border-none text-current"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Invoice #', 'Customer', 'Amount', 'Outstanding', 'Due Date', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)
              ) : !data?.data?.length ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {statusFilter ? `No ${statusFilter.toLowerCase()} invoices.` : 'No invoices yet.'}
                  </td>
                </tr>
              ) : (
                data.data.map((inv: Invoice) => {
                  const st = STATUS_COLORS[inv.status] ?? STATUS_COLORS.DRAFT
                  const hasOutstanding = Number(inv.outstanding) > 0 && inv.status !== 'CANCELLED'
                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-5 py-3.5 font-mono text-white text-xs">
                        <button
                          type="button"
                          onClick={() => setDetailTargetInvoice(inv)}
                          title={`View details for invoice ${inv.number}`}
                          className="hover:underline text-indigo-300 font-semibold cursor-pointer text-left font-mono bg-transparent border-none p-0"
                        >
                          {inv.number}
                        </button>
                      </td>
                      <td className="px-5 py-3.5 text-white font-medium">{inv.customer?.name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-white">{fmt(Number(inv.amount))}</td>
                      <td className="px-5 py-3.5 font-semibold" style={{ color: Number(inv.outstanding) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {Number(inv.outstanding) > 0 ? fmt(Number(inv.outstanding)) : '—'}
                      </td>
                      <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{formatDate(inv.dueDate)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium w-fit" style={{ background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                          {inv.status === 'PAID' ? (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 w-fit">
                              ✓ Paid in Full
                            </span>
                          ) : inv.status === 'CANCELLED' ? (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700 w-fit">
                              Disabled
                            </span>
                          ) : hasOutstanding ? (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-950/70 text-indigo-300 border border-indigo-800/60 w-fit">
                              Link Ready
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRowDownload(inv)}
                            disabled={downloadingId === inv.id}
                            title="Download invoice PDF"
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            style={{
                              background: 'var(--surface-2)',
                              color: 'var(--text-muted)',
                              border: '1px solid var(--border)',
                              cursor: downloadingId === inv.id ? 'wait' : 'pointer',
                            }}
                          >
                            <span>📄</span>
                            {downloadingId === inv.id ? '…' : 'PDF'}
                          </button>

                          {isInvoicePayable(inv) ? (
                            <button
                              type="button"
                              data-testid={`pay-now-btn-${inv.id}`}
                              onClick={() => setCheckoutTargetInvoice(inv)}
                              title="Pay invoice now via Razorpay Standard Checkout (Test Mode)"
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 cursor-pointer transition-colors shadow-sm"
                            >
                              <span>⚡</span>
                              <span>Pay Now</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              data-testid={`pay-now-btn-${inv.id}`}
                              title={
                                inv.status === 'PAID'
                                  ? 'Invoice is already paid in full'
                                  : inv.status === 'CANCELLED'
                                  ? 'Cannot pay cancelled invoice'
                                  : inv.status === 'DRAFT'
                                  ? 'Cannot pay draft invoice'
                                  : 'No outstanding balance'
                              }
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-slate-800/50 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-50"
                            >
                              <span>⚡</span>
                              <span>Pay Now</span>
                            </button>
                          )}

                          {inv.status === 'PAID' || inv.status === 'CANCELLED' ? (
                            <button
                              disabled
                              title={inv.status === 'PAID' ? 'Invoice is already paid in full' : 'Cannot generate payment link for cancelled invoice'}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-slate-800/50 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-50"
                            >
                              <span>💳</span>
                              <span>Pay Link</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenPayModal(inv)}
                              title="Generate or retrieve payment link (Razorpay / Stripe)"
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-indigo-900/40 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 cursor-pointer transition-colors"
                            >
                              <span>💳</span>
                              <span>Pay Link</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleOpenDeliveryHistory(inv)}
                            title="View customer invoice & payment-link delivery history"
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer transition-colors"
                          >
                            <span>📬</span>
                            <span>Deliveries</span>
                          </button>

                          {canManageInvoices && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                            <button
                              type="button"
                              aria-label={`Cancel invoice ${inv.number}`}
                              onClick={() => {
                                setCancelError(null)
                                setCancelTarget(inv)
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 cursor-pointer transition-colors"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > limit && (
          <div className="px-5 py-3 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <span>Page {page} of {totalPages} · {data.total} invoices</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded-lg disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1 rounded-lg disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Payment Link Modal */}
      {activeInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <span>💳</span> Create Payment Link
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Generate an online remittance link for Invoice <strong>{activeInvoice.number}</strong>
                </p>
              </div>
              <button
                onClick={() => setActiveInvoice(null)}
                className="text-white/40 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-xl space-y-2 bg-white/[0.02] border border-white/5 text-xs">
              <div className="flex justify-between text-white/70">
                <span>Customer:</span>
                <span className="font-semibold text-white">{activeInvoice.customer?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Invoice Total:</span>
                <span className="font-mono text-white">{fmt(Number(activeInvoice.amount))}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Outstanding Due:</span>
                <span className="font-mono font-bold text-rose-400">{fmt(Number(activeInvoice.outstanding))}</span>
              </div>
            </div>

            {/* Provider selection */}
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">Select Payment Provider Adapter</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'RAZORPAY', name: 'Razorpay', icon: '🇮🇳', desc: 'UPI, Cards & Netbanking' },
                  { id: 'STRIPE', name: 'Stripe', icon: '🌐', desc: 'International & Multi-Currency' },
                ].map((prov) => (
                  <button
                    key={prov.id}
                    type="button"
                    onClick={() => setSelectedProvider(prov.id as any)}
                    className={`p-3 rounded-xl text-left border cursor-pointer transition-all ${
                      selectedProvider === prov.id
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-white/[0.02] border-white/5 text-white/60 hover:border-white/10'
                    }`}
                  >
                    <div className="font-semibold text-xs flex items-center gap-1.5">
                      <span>{prov.icon}</span>
                      <span>{prov.name}</span>
                    </div>
                    <div className="text-[11px] text-white/40 mt-1">{prov.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg text-xs bg-rose-950/40 border border-rose-800 text-rose-400">
                ⚠️ {errorMsg}
              </div>
            )}

            {/* Generated Link Display */}
            {generatedLink && (
              <div className={`p-4 rounded-xl space-y-3 border ${
                generatedLink.isSimulated 
                  ? 'bg-amber-950/20 border-amber-800/70' 
                  : 'bg-emerald-950/30 border-emerald-800/80'
              }`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold flex items-center gap-1.5 ${
                    generatedLink.isSimulated ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    <span>{generatedLink.isSimulated ? '🧪' : '✅'}</span>
                    {generatedLink.isSimulated ? 'SIMULATED Test Payment Link' : 'Payment Link Active'}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold font-mono border ${
                    generatedLink.isSimulated 
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/40' 
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  }`}>
                    {generatedLink.isSimulated ? '⚠️ SIMULATION ONLY' : '⚡ Live Provider'}
                  </span>
                </div>

                {generatedLink.isSimulated && (
                  <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-700/50 text-[11px] text-amber-200/90 leading-relaxed">
                    <strong>Sandbox Notice:</strong> This is a mock simulation link for developer testing. No live payment gateway connection or merchant account is attached.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedLink.shortUrl}
                    className={`w-full px-3 py-2 text-xs font-mono rounded-lg bg-black/40 border text-white select-all ${
                      generatedLink.isSimulated ? 'border-amber-700/50' : 'border-emerald-700/50'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer shrink-0 transition-colors ${
                      generatedLink.isSimulated ? 'bg-amber-700 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div className="text-[11px] text-white/50 flex justify-between items-center">
                  <span>Reference: {generatedLink.paymentLinkId}</span>
                  <a
                    href={generatedLink.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 underline font-medium hover:text-indigo-300"
                  >
                    {generatedLink.isSimulated ? 'Open Simulated Checkout ↗' : 'Open Checkout ↗'}
                  </a>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActiveInvoice(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={generatingLink}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50 transition-colors shadow-lg shadow-indigo-600/30"
              >
                {generatingLink ? 'Generating…' : 'Generate Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Delivery History Modal */}
      {activeDeliveryHistoryInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📬</span> Document Delivery History
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Invoice <strong className="text-white font-mono">{activeDeliveryHistoryInvoice.number}</strong> • Customer: <strong className="text-white">{activeDeliveryHistoryInvoice.customer?.name ?? '—'}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                  <span>🧪</span> Simulation Mode (No real messages sent)
                </span>
                <button
                  onClick={() => setActiveDeliveryHistoryInvoice(null)}
                  className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300">
              {deliveryHistoryError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300">
                  ⚠️ {deliveryHistoryError}
                </div>
              )}

              {loadingDeliveries ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <div className="animate-spin text-2xl">⏳</div>
                  <div>Loading delivery records from backend…</div>
                </div>
              ) : deliveryRequests.length === 0 ? (
                <div className="py-10 text-center text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800 p-6">
                  <div className="text-2xl mb-2">📭</div>
                  <div className="font-semibold text-slate-300">No document delivery requests found</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    When a customer requests an invoice or payment link during a Chotu voice session, the delivery record and channel attempts will appear here.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {deliveryRequests.map((req) => (
                    <div key={req.id} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                            {req.requestType === 'BOTH' ? 'Invoice & Payment Link' : req.requestType === 'PAYMENT_LINK' ? 'Payment Link' : 'Invoice Copy'}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            by <span className="text-slate-200 font-mono">{req.requestedBy}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-[11px] font-mono">
                            {formatDate(req.requestedAt)} {new Date(req.requestedAt).toLocaleTimeString()}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            req.status === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : req.status === 'PARTIAL_SUCCESS'
                              ? 'bg-amber-950 text-amber-300 border-amber-800'
                              : req.status === 'FAILED'
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {req.status}
                          </span>
                        </div>
                      </div>

                      {/* Delivery attempts */}
                      {req.attempts && req.attempts.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Channel Attempts:
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {req.attempts.map((att) => (
                              <div key={att.id} className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span>{att.channel === 'WHATSAPP' ? '💬' : '✉️'}</span>
                                  <span className="font-semibold text-slate-200">{att.channel}</span>
                                  <span className="text-slate-400 font-mono text-[10px]">({att.destinationMasked})</span>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  att.status === 'SIMULATED'
                                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                                    : att.status === 'DELIVERED' || att.status === 'SENT'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : att.status === 'FAILED'
                                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                                    : 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}>
                                  {att.status === 'SIMULATED' ? '🧪 Sim' : att.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action buttons inside delivery card */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                        <button
                          onClick={() => handleRowDownload(activeDeliveryHistoryInvoice)}
                          className="px-2.5 py-1 rounded text-xs font-semibold bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 cursor-pointer flex items-center gap-1"
                        >
                          <span>📄</span> Download Invoice PDF
                        </button>
                        {req.metadata?.paymentLinkUrl && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(req.metadata!.paymentLinkUrl!)
                              setCopiedHistoryLinkId(req.id)
                              setTimeout(() => setCopiedHistoryLinkId(null), 2000)
                            }}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 cursor-pointer flex items-center gap-1"
                          >
                            <span>💳</span> {copiedHistoryLinkId === req.id ? '✓ Link Copied!' : 'Copy Payment Link'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-800 flex justify-end bg-slate-950">
              <button
                onClick={() => setActiveDeliveryHistoryInvoice(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {canManageInvoices && isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Create New Invoice</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="p-6 space-y-4 text-xs">
              {(invError || customersLoadError) && (
                <div role="alert" className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  ⚠️ {invError || customersLoadError}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-white/70 mb-1">Customer *</label>
                  <select
                    required
                    value={invCustomerId}
                    onChange={(e) => setInvCustomerId(e.target.value)}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select customer...</option>
                    {customersList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''} - {c.phone}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Invoice Number *</label>
                  <input
                    type="text"
                    required
                    value={invNumber}
                    onChange={(e) => setInvNumber(e.target.value.toUpperCase())}
                    placeholder="INV-2026-001"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Total Invoice Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={invAmount}
                    onChange={(e) => setInvAmount(e.target.value)}
                    placeholder="50000"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/70 mb-1">Issue Date *</label>
                    <input
                      type="date"
                      required
                      value={invIssueDate}
                      onChange={(e) => setInvIssueDate(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-white/70 mb-1">Due Date *</label>
                    <input
                      type="date"
                      required
                      value={invDueDate}
                      onChange={(e) => setInvDueDate(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Description / Notes</label>
                  <input
                    type="text"
                    value={invDescription}
                    onChange={(e) => setInvDescription(e.target.value)}
                    placeholder="Hardware delivery or services..."
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={invSubmitting || customersList.length === 0}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  {invSubmitting ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Details Modal */}
      {detailTargetInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-details-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start justify-between pb-3 border-b border-white/10">
              <div>
                <div className="flex items-center gap-2">
                  <h3 id="invoice-details-title" className="text-base font-bold text-white tracking-tight">
                    Invoice {detailTargetInvoice.number}
                  </h3>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      background: (STATUS_COLORS[detailTargetInvoice.status] ?? STATUS_COLORS.DRAFT).bg,
                      color: (STATUS_COLORS[detailTargetInvoice.status] ?? STATUS_COLORS.DRAFT).color,
                    }}
                  >
                    {(STATUS_COLORS[detailTargetInvoice.status] ?? STATUS_COLORS.DRAFT).label}
                  </span>
                </div>
                <p className="text-xs text-white/50 mt-0.5">
                  Issued to <strong>{detailTargetInvoice.customer?.name ?? 'Customer'}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTargetInvoice(null)}
                aria-label="Close invoice details"
                className="text-white/40 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-xl space-y-2 bg-white/[0.02] border border-white/5 text-xs">
              <div className="flex justify-between text-white/70">
                <span>Issue Date:</span>
                <span className="text-white">{formatDate(detailTargetInvoice.issueDate)}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Due Date:</span>
                <span className="text-white">{formatDate(detailTargetInvoice.dueDate)}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Total Amount:</span>
                <span className="font-mono text-white">{fmt(Number(detailTargetInvoice.amount))}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Amount Paid:</span>
                <span className="font-mono text-emerald-400">
                  {fmt(Math.max(0, Number(detailTargetInvoice.amount) - Number(detailTargetInvoice.outstanding)))}
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Remaining Outstanding:</span>
                <span
                  className="font-mono font-bold"
                  style={{
                    color: Number(detailTargetInvoice.outstanding) > 0 ? 'var(--danger)' : 'var(--text-muted)',
                  }}
                >
                  {fmt(Number(detailTargetInvoice.outstanding))}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRowDownload(detailTargetInvoice)}
                  disabled={downloadingId === detailTargetInvoice.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white cursor-pointer"
                >
                  <span>📄</span>
                  <span>PDF</span>
                </button>
                {detailTargetInvoice.status !== 'PAID' && detailTargetInvoice.status !== 'CANCELLED' && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailTargetInvoice
                      setDetailTargetInvoice(null)
                      handleOpenPayModal(target)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 bg-indigo-900/40 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 cursor-pointer"
                  >
                    <span>💳</span>
                    <span>Pay Link</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailTargetInvoice(null)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer"
                >
                  Close
                </button>
                {isInvoicePayable(detailTargetInvoice) && (
                  <button
                    type="button"
                    data-testid="detail-pay-now-btn"
                    onClick={() => {
                      const target = detailTargetInvoice
                      setDetailTargetInvoice(null)
                      setCheckoutTargetInvoice(target)
                    }}
                    className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 cursor-pointer shadow-lg shadow-emerald-600/30 flex items-center gap-1.5"
                  >
                    <span>⚡</span>
                    <span>Pay Now</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Razorpay Standard Checkout Modal (Test Mode) */}
      {checkoutTargetInvoice && (
        <RazorpayCheckoutModal
          invoice={checkoutTargetInvoice}
          isOpen={Boolean(checkoutTargetInvoice)}
          onClose={() => setCheckoutTargetInvoice(null)}
          onPaymentSuccess={(result) => {
            setRefreshKey((k) => k + 1)
            if (detailTargetInvoice && checkoutTargetInvoice && detailTargetInvoice.id === checkoutTargetInvoice.id) {
              setDetailTargetInvoice((prev) =>
                prev
                  ? {
                      ...prev,
                      status: (result.invoiceStatus as any) || prev.status,
                      outstanding:
                        typeof result.remainingOutstanding === 'number'
                          ? result.remainingOutstanding
                          : prev.outstanding,
                    }
                  : null,
              )
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel Invoice"
        description={
          cancelTarget
            ? `Are you sure you want to cancel invoice ${cancelTarget.number}? Cancelled invoices cannot receive payment links.`
            : ''
        }
        confirmLabel="Confirm Cancel"
        cancelLabel="Keep Invoice"
        variant="danger"
        loading={cancellingInvoice}
        errorMessage={cancelError}
        onCancel={() => {
          setCancelTarget(null)
          setCancelError(null)
        }}
        onConfirm={handleConfirmCancelInvoice}
      />
    </div>
  )
}
