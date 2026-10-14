import { useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { reportsApi } from '../api/reports'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className ?? ''}`} style={{ background: 'var(--surface-2)' }} />
}

export default function ReportsPage() {
  const ageingFetcher = useCallback(() => reportsApi.getAgeing(), [])
  const summaryFetcher = useCallback(() => reportsApi.getSummary(), [])

  const { data: ageing, loading: ageingLoading, error: ageingError } = useApi(ageingFetcher)
  const { data: summary, loading: summaryLoading } = useApi(summaryFetcher)

  const loading = ageingLoading || summaryLoading

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Collection performance, ageing analysis, and payment trends"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard label="Total Billed"     value={fmt(summary?.totalBilled ?? 0)}     icon="📄" color="var(--primary)" />
            <StatCard label="Total Collected"  value={fmt(summary?.totalCollected ?? 0)}  icon="✅" color="var(--accent)"  />
            <StatCard label="Total Overdue"    value={fmt(summary?.totalOverdue ?? 0)}    icon="⚠️" color="var(--danger)"  />
            <StatCard label="Collection Rate"  value={`${summary?.collectionRate ?? 0}%`} icon="📊" color="var(--warning)" />
          </>
        )}
      </div>

      {/* Ageing table */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white">Receivables Ageing</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Days past due — overdue invoices only</p>
        </div>

        {ageingError && (
          <div className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>⚠️ {ageingError}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['0–30 days', '31–60 days', '61–90 days', '90+ days', 'Total'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {ageingLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <td key={i} className="px-5 py-3.5">
                      <div className="h-5 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '80px' }} />
                    </td>
                  ))
                ) : (
                  [ageing?.d0_30, ageing?.d31_60, ageing?.d61_90, ageing?.d90plus, ageing?.total].map((v, i) => (
                    <td key={i} className="px-5 py-3.5 text-white font-semibold">{fmt(v ?? 0)}</td>
                  ))
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Extra summary stats */}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Open Invoices"       value={summary.openInvoices}    icon="🧾" color="var(--primary)" />
          <StatCard label="Overdue Customers"   value={summary.overdueCustomers} icon="👥" color="var(--danger)"  />
          <StatCard label="This Month Received" value={fmt(summary.collectedThisMonth)} icon="💰" color="var(--accent)" />
        </div>
      )}
    </div>
  )
}
