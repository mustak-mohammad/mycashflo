import { useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { collectionsApi } from '../api/collections'
import type { CollectionCase } from '../types'

function priorityBadge(p: CollectionCase['priority']) {
  const m: Record<string, { bg: string; color: string }> = {
    URGENT: { bg: 'rgba(239,68,68,0.18)',  color: 'var(--danger)' },
    HIGH:   { bg: 'rgba(239,68,68,0.12)',  color: 'var(--danger)' },
    MEDIUM: { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)' },
    LOW:    { bg: 'rgba(16,185,129,0.12)', color: 'var(--accent)' },
  }
  const s = m[p] ?? m.LOW
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.color }}>{p}</span>
}

function statusBadge(s: CollectionCase['status']) {
  const m: Record<string, { bg: string; color: string }> = {
    OPEN:        { bg: 'rgba(99,102,241,0.15)', color: 'var(--primary)' },
    IN_PROGRESS: { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)' },
    RESOLVED:    { bg: 'rgba(16,185,129,0.12)', color: 'var(--accent)' },
    CLOSED:      { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)' },
  }
  const st = m[s] ?? m.OPEN
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: st.bg, color: st.color }}>{s.replace('_', ' ')}</span>
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '70%' }} />
        </td>
      ))}
    </tr>
  )
}

export default function CollectionsPage() {
  const fetcher = useCallback(() => collectionsApi.list({ limit: 20 }), [])
  const { data, loading, error } = useApi(fetcher)

  const openCount = data?.summary?.openCount ?? 0
  const highCount = data?.summary?.highCount ?? 0
  const total = data?.total ?? 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Collections" subtitle="Active collection cases and follow-up workflows" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Cases"   value={loading ? '…' : openCount} icon="📋" color="var(--primary)" />
        <StatCard label="High Priority"  value={loading ? '…' : highCount} icon="🔴" color="var(--danger)"  />
        <StatCard label="Total Cases"    value={loading ? '…' : total}     icon="📁" color="var(--warning)" />
        <StatCard label="Resolved"       value={loading ? '…' : (total - openCount)} icon="✅" color="var(--accent)" />
      </div>

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
                {['Customer', 'Invoice', 'Outstanding', 'Assigned To', 'Priority', 'Status'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
              ) : !data?.data?.length ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No collection cases found.</td></tr>
              ) : (
                data.data.map((c: CollectionCase) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3.5 text-white font-medium">{c.customer?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{c.invoice?.number ?? '—'}</td>
                    <td className="px-5 py-3.5 font-semibold" style={{ color: 'var(--danger)' }}>
                      {c.invoice?.outstanding ? fmt(Number(c.invoice.outstanding)) : '—'}
                    </td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{c.assignedAgent?.name ?? '—'}</td>
                    <td className="px-5 py-3.5">{priorityBadge(c.priority)}</td>
                    <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
