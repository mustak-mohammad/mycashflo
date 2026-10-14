import { useCallback } from 'react'
import { useAuth } from '../store/AuthContext'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { dashboardApi } from '../api/dashboard'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded ${className ?? ''}`}
      style={{ background: 'var(--surface-2)' }}
    />
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const fetcher = useCallback(() => dashboardApi.getStats(), [])
  const { data, loading, error } = useApi(fetcher)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title={`Welcome back${user ? `, ${user.name.split(' ')[0]}` : ''}! 👋`}
        subtitle="Here's your collections overview for today."
      />

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm mb-6"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          ⚠️ Could not load dashboard data: {error}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard label="Total Receivables"    value={fmt(data?.totalReceivables ?? 0)}   subtext="Across active invoices"       icon="📈" color="var(--primary)" />
            <StatCard label="Overdue Amount"        value={fmt(data?.overdueAmount ?? 0)}       subtext={`${data?.overdueCustomerCount ?? 0} customers overdue`} icon="⚠️" color="var(--danger)" />
            <StatCard label="Collected This Month"  value={fmt(data?.collectedThisMonth ?? 0)} subtext="Payments received"            icon="✅" color="var(--accent)" />
            <StatCard label="Collection Rate"       value={`${data?.collectionRate ?? 0}%`}    subtext={`${data?.openInvoiceCount ?? 0} invoices open`} icon="📊" color="var(--warning)" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard label="Overdue Customers"  value={data?.overdueCustomerCount ?? 0} subtext="Need immediate attention" icon="👥" color="var(--danger)" />
            <StatCard label="Open Cases"         value={data?.openCaseCount ?? 0}         subtext="Collection cases active"  icon="📋" color="var(--primary)" />
            <StatCard label="Open Invoices"      value={data?.openInvoiceCount ?? 0}      subtext="Pending collection"       icon="🧾" color="var(--warning)" />
          </>
        )}
      </div>

      {/* Recent overdue invoices */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white">Overdue Invoices</h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {loading ? '…' : `${data?.recentOverdueInvoices?.length ?? 0} shown`}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : !data?.recentOverdueInvoices?.length ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            🎉 No overdue invoices right now.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.recentOverdueInvoices.map((inv) => (
              <div key={inv.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--danger)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">{inv.customerName}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {inv.number} · {fmt(inv.outstanding)} overdue · {inv.daysOverdue}d past due
                  </div>
                </div>
                <div className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {timeAgo(inv.dueDate)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
