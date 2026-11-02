import { useState, useCallback, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { invoicesApi } from '../api/invoices'
import { paymentsApi } from '../api/payments'
import { customersApi } from '../api/customers'
import type { Invoice, PaymentLinkResponse, Customer } from '../types'

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
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
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

  // Payment Link Modal state
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<'RAZORPAY' | 'STRIPE'>('RAZORPAY')
  const [generatingLink, setGeneratingLink] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<PaymentLinkResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetcher = useCallback(
    () => invoicesApi.list({ page, limit, status: statusFilter || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, statusFilter, refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  useEffect(() => {
    customersApi.list({ limit: 100 }).then((res) => {
      setCustomersList(res.data)
      if (res.data.length > 0 && !invCustomerId) {
        setInvCustomerId(res.data[0].id)
      }
    }).catch(console.error)
  }, [])

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
      setIsCreateOpen(false)
      setInvNumber('')
      setInvAmount('')
      setInvDescription('')
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      setInvError(err.message || 'Failed to create invoice.')
    } finally {
      setInvSubmitting(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await invoicesApi.downloadCsv({ status: statusFilter || undefined })
    } catch (e: any) {
      alert(`Export failed: ${e?.message ?? 'unknown error'}`)
    } finally {
      setExporting(false)
    }
  }

  const handleRowDownload = async (inv: Invoice) => {
    setDownloadingId(inv.id)
    try {
      await invoicesApi.downloadPdf(inv.id, inv.number)
    } catch (e: any) {
      alert(`Failed to download invoice PDF: ${e?.message ?? 'unknown error'}`)
    } finally {
      setDownloadingId(null)
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
            <button
              onClick={() => {
                setInvError(null)
                setIsCreateOpen(true)
              }}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer"
            >
              + Create Invoice
            </button>
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

        {error && (
          <div className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>
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
                      <td className="px-5 py-3.5 font-mono text-white text-xs">{inv.number}</td>
                      <td className="px-5 py-3.5 text-white font-medium">{inv.customer?.name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-white">{fmt(Number(inv.amount))}</td>
                      <td className="px-5 py-3.5 font-semibold" style={{ color: Number(inv.outstanding) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {Number(inv.outstanding) > 0 ? fmt(Number(inv.outstanding)) : '—'}
                      </td>
                      <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{formatDate(inv.dueDate)}</td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
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

                          {hasOutstanding && (
                            <button
                              onClick={() => handleOpenPayModal(inv)}
                              title="Generate payment link (Razorpay / Stripe)"
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 bg-indigo-900/40 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 cursor-pointer transition-colors"
                            >
                              <span>💳</span>
                              <span>Pay Link</span>
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

      {/* Create Invoice Modal */}
      {isCreateOpen && (
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
              {invError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  ⚠️ {invError}
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
    </div>
  )
}
