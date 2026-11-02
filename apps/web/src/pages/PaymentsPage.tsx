import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { paymentsApi } from '../api/payments'
import { invoicesApi } from '../api/invoices'
import { useAuth } from '../store/AuthContext'
import type { Payment, Invoice } from '../types'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '70%' }} />
        </td>
      ))}
    </tr>
  )
}

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  CARD: 'Card',
  PAYMENT_LINK: 'Payment Link',
  OTHER: 'Other',
}

export default function PaymentsPage() {
  const { user } = useAuth()
  const isAgent = user?.role === 'AGENT'
  const [refreshKey, setRefreshKey] = useState(0)

  // Record / Claim Payment Modal State
  const [isRecordOpen, setIsRecordOpen] = useState(false)
  const [unpaidInvoices, setUnpaidInvoices] = useState<Invoice[]>([])
  const [targetInvoiceId, setTargetInvoiceId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payRef, setPayRef] = useState('')
  const [payEvidence, setPayEvidence] = useState('')
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER')
  const [payNotes, setPayNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)

  const fetcher = useCallback(
    () => paymentsApi.list({ limit: 50 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  useEffect(() => {
    invoicesApi.list({ limit: 100 }).then((res) => {
      const openInvs = res.data.filter((i) => i.outstanding > 0)
      setUnpaidInvoices(openInvs)
      if (openInvs.length > 0 && !targetInvoiceId) {
        setTargetInvoiceId(openInvs[0].id)
        setPayAmount(String(openInvs[0].outstanding))
      }
    }).catch(console.error)
  }, [refreshKey])

  const handleSelectInvoice = (id: string) => {
    setTargetInvoiceId(id)
    const inv = unpaidInvoices.find((i) => i.id === id)
    if (inv) {
      setPayAmount(String(inv.outstanding))
    }
  }

  const handleRecordOrClaim = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(payAmount)
    if (!targetInvoiceId || !payRef.trim() || isNaN(amt) || amt <= 0) {
      setRecordError('Target invoice, reference number, and a positive amount are required.')
      return
    }

    const selectedInv = unpaidInvoices.find((i) => i.id === targetInvoiceId)
    if (selectedInv && amt > selectedInv.outstanding) {
      setRecordError(`Amount (₹${amt}) cannot exceed remaining invoice outstanding (₹${selectedInv.outstanding}).`)
      return
    }

    setSubmitting(true)
    setRecordError(null)
    try {
      if (isAgent) {
        await paymentsApi.recordPaymentClaim({
          invoiceId: targetInvoiceId,
          amount: amt,
          paymentDate: payDate,
          reference: payRef.trim(),
          method: payMethod,
          notes: payNotes.trim() || undefined,
          evidenceUrl: payEvidence.trim() || undefined,
        })
      } else {
        await paymentsApi.recordPayment({
          invoiceId: targetInvoiceId,
          amount: amt,
          paymentDate: payDate,
          reference: payRef.trim(),
          method: payMethod,
          notes: payNotes.trim() || undefined,
        })
      }
      setIsRecordOpen(false)
      setPayRef('')
      setPayEvidence('')
      setPayNotes('')
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      setRecordError(err?.response?.data?.message || err.message || 'Failed to submit payment.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVerifyClaim = async (paymentId: string) => {
    if (!confirm('Verify and reconcile this customer payment claim? This will settle the invoice balance and update the customer ledger.')) {
      return
    }
    setVerifyingId(paymentId)
    try {
      await paymentsApi.verifyPaymentClaim(paymentId)
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      alert(`Verification failed: ${err?.response?.data?.message || err.message}`)
    } finally {
      setVerifyingId(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Payments"
        subtitle={`${data?.total ?? '…'} recorded transactions`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRecordError(null)
                setIsRecordOpen(true)
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors shadow-sm cursor-pointer ${
                isAgent
                  ? 'bg-amber-600 hover:bg-amber-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {isAgent ? '📥 Submit Payment Claim' : '+ Record Payment'}
            </button>
            {!isAgent && (
              <Link
                to="/settings"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 no-underline transition-colors"
              >
                ⚙️ Gateways
              </Link>
            )}
            <Link
              to="/invoices"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 no-underline transition-colors shadow-sm"
            >
              💳 Generate Payment Link
            </Link>
          </div>
        }
      />

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {error && (
          <div className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Ref #', 'Customer', 'Invoice #', 'Amount', 'Date', 'Method', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)
              ) : !data?.data?.length ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No payment records found.
                  </td>
                </tr>
              ) : (
                data.data.map((p: Payment) => {
                  const isPending = p.status === 'PENDING'
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-5 py-3.5 font-mono text-xs text-white">
                        <div>{p.ref}</div>
                        {p.notes && <div className="text-[10px] text-white/40 truncate max-w-[140px]">{p.notes}</div>}
                      </td>
                      <td className="px-5 py-3.5 text-white font-medium">{p.customer?.name ?? '—'}</td>
                      <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{p.invoice?.number ?? '—'}</td>
                      <td className="px-5 py-3.5 text-white font-semibold">{fmt(Number(p.amount))}</td>
                      <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{formatDate(p.paidAt || p.createdAt)}</td>
                      <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>
                        <span className="flex items-center gap-1.5">
                          {p.method === 'PAYMENT_LINK' && <span>🔗</span>}
                          {METHOD_LABELS[p.method] ?? p.method}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className="px-2.5 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1"
                          style={p.status === 'COMPLETED'
                            ? { background: 'rgba(16,185,129,0.12)', color: 'var(--accent)' }
                            : p.status === 'FAILED'
                            ? { background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }
                            : { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }
                          }
                        >
                          {isPending ? '⏳ Awaiting Verification' : p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {!isAgent && isPending ? (
                          <button
                            type="button"
                            onClick={() => handleVerifyClaim(p.id)}
                            disabled={verifyingId === p.id}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 cursor-pointer transition-colors"
                          >
                            {verifyingId === p.id ? 'Verifying…' : '✓ Verify Claim'}
                          </button>
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2.5 text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          <span>⚡ Payment Ledger: Verified settlements with ledger rebalancing and audit logs.</span>
          <span className="text-white/40">Tenant-Scoped</span>
        </div>
      </div>

      {/* Record Payment / Submit Claim Modal */}
      {isRecordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">
                {isAgent ? '📥 Submit Customer Payment Claim' : 'Record Manual Settlement'}
              </h3>
              <button
                onClick={() => setIsRecordOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordOrClaim} className="p-6 space-y-4 text-xs">
              {recordError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  ⚠️ {recordError}
                </div>
              )}

              {isAgent && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 leading-relaxed">
                  <strong>Notice (RBAC Safety Rule):</strong> As a Collection Agent, you are recording a customer's claim of payment. This registers an <em>Awaiting Verification</em> claim with audit trail. The invoice balance and status will remain open until verified by an Administrator.
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-white/70 mb-1">Invoice to Settle *</label>
                  <select
                    required
                    value={targetInvoiceId}
                    onChange={(e) => handleSelectInvoice(e.target.value)}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Select unpaid invoice...</option>
                    {unpaidInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.number} — {inv.customer?.name ?? 'Customer'} (Outstanding: ₹{inv.outstanding})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/70 mb-1">Payment Amount (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="25000"
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-white/70 mb-1">Payment Date *</label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/70 mb-1">Transaction / UTR Reference *</label>
                    <input
                      type="text"
                      required
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      placeholder="e.g. UTR-99881122"
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-white/70 mb-1">Method *</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                      <option value="UPI">UPI</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CARD">Debit/Credit Card</option>
                      <option value="CASH">Cash</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>

                {isAgent && (
                  <div>
                    <label className="block text-white/70 mb-1">Supporting Evidence / Receipt URL</label>
                    <input
                      type="text"
                      value={payEvidence}
                      onChange={(e) => setPayEvidence(e.target.value)}
                      placeholder="https://drive.google.com/receipt-proof or Doc ID"
                      className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-white/70 mb-1">Notes / Remarks</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder={isAgent ? 'Customer claimed payment via WhatsApp...' : 'Received via direct bank deposit...'}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsRecordOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || unpaidInvoices.length === 0}
                  className={`px-5 py-2 rounded-lg text-white font-medium disabled:opacity-50 cursor-pointer shadow-lg ${
                    isAgent
                      ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                  }`}
                >
                  {submitting ? 'Submitting…' : isAgent ? 'Submit Claim' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
