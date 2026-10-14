import { useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { paymentsApi } from '../api/payments'
import type { Payment } from '../types'

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
      {Array.from({ length: 7 }).map((_, i) => (
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
  const fetcher = useCallback(() => paymentsApi.list({ limit: 20 }), [])
  const { data, loading, error } = useApi(fetcher)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Payments"
        subtitle={`${data?.total ?? '…'} payment records`}
      />

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm mb-4" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          ⚠️ {error}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Ref', 'Customer', 'Invoice', 'Amount', 'Date', 'Method', 'Status'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)
              ) : !data?.data?.length ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No payment records found.</td></tr>
              ) : (
                data.data.map((p: Payment) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3.5 font-mono text-xs text-white">{p.ref}</td>
                    <td className="px-5 py-3.5 text-white font-medium">{p.customer?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{p.invoice?.number ?? '—'}</td>
                    <td className="px-5 py-3.5 text-white font-semibold">{fmt(Number(p.amount))}</td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{formatDate(p.paidAt)}</td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{METHOD_LABELS[p.method] ?? p.method}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={p.status === 'COMPLETED'
                          ? { background: 'rgba(16,185,129,0.12)', color: 'var(--accent)' }
                          : p.status === 'FAILED'
                          ? { background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }
                          : { background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2 text-xs" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          ℹ️ Payment records are read-only. Payment provider integration is planned for Phase 7.
        </div>
      </div>
    </div>
  )
}
