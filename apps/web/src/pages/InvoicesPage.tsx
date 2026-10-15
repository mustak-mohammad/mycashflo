import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { invoicesApi } from '../api/invoices'
import type { Invoice } from '../types'

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
  const [exporting, setExporting] = useState(false)
  const limit = 20

  const fetcher = useCallback(
    () => invoicesApi.list({ page, limit, status: statusFilter || undefined }),
    [page, statusFilter],
  )
  const { data, loading, error } = useApi(fetcher)
  const totalPages = data ? Math.ceil(data.total / limit) : 1

  const handleExport = async () => {
    try {
      setExporting(true)
      await invoicesApi.downloadCsv({ status: statusFilter || undefined })
    } catch (err: any) {
      alert('Failed to export invoices: ' + (err?.message || 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const handleRowDownload = async (inv: Invoice) => {
    try {
      setDownloadingId(inv.id)
      await invoicesApi.downloadPdf(inv.id, inv.number)
    } catch (err: any) {
      alert('Failed to download invoice: ' + (err?.message || 'Unknown error'))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Invoices"
        subtitle={`${data?.total ?? '…'} total invoices`}
        action={
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
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
                        <button
                          onClick={() => handleRowDownload(inv)}
                          disabled={downloadingId === inv.id}
                          title="Download invoice PDF"
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"
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
                className="px-3 py-1 rounded text-xs disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>← Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded text-xs disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
