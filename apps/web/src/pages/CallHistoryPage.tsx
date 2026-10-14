import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { callsApi } from '../api/calls'
import type { CallSession } from '../types'

const OUTCOME_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  PROMISE_TO_PAY:      { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)',    label: 'Promise to Pay' },
  NO_CONTACT:          { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'No Contact' },
  RESOLVED:            { bg: 'rgba(16,185,129,0.12)',  color: 'var(--accent)',     label: 'Resolved' },
  DISPUTE:             { bg: 'rgba(239,68,68,0.12)',   color: 'var(--danger)',     label: 'Dispute' },
  CALLBACK_REQUESTED:  { bg: 'rgba(99,102,241,0.15)',  color: 'var(--primary)',    label: 'Callback' },
  OTHER:               { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'Other' },
}

function formatDuration(seconds?: number) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDateTime(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '80%' }} />
        </td>
      ))}
    </tr>
  )
}

export default function CallHistoryPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const limit = 20

  const fetcher = useCallback(
    () => callsApi.list({ page, limit, outcome: outcomeFilter || undefined }),
    [page, outcomeFilter],
  )
  const { data, loading, error } = useApi(fetcher)

  const calls = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Call History"
        subtitle={`${total} total AI voice & collection call records`}
      />

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm mb-4"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[
          { label: 'All Outcomes', value: '' },
          { label: 'Promise to Pay', value: 'PROMISE_TO_PAY' },
          { label: 'Resolved', value: 'RESOLVED' },
          { label: 'Dispute', value: 'DISPUTE' },
          { label: 'No Contact', value: 'NO_CONTACT' },
        ].map((tab) => (
          <button
            key={tab.label}
            onClick={() => {
              setOutcomeFilter(tab.value)
              setPage(1)
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors whitespace-nowrap"
            style={{
              background: outcomeFilter === tab.value ? 'var(--primary)' : 'var(--surface)',
              color: outcomeFilter === tab.value ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Customer', 'Duration', 'Date & Time', 'Outcome', 'Summary', 'Agent'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No call sessions recorded yet. Calls initiated via Chotu AI will automatically appear here.
                  </td>
                </tr>
              ) : (
                calls.map((c: CallSession) => {
                  const s = c.outcome && OUTCOME_STYLE[c.outcome]
                    ? OUTCOME_STYLE[c.outcome]
                    : { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: c.outcome ?? 'Pending' }
                  return (
                    <tr key={c.id}>
                      <td className="px-5 py-3.5 text-white font-medium">
                        {c.customer?.name ?? 'Customer'}
                        {c.customer?.phone && (
                          <div className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                            {c.customer.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatDuration(c.duration)}
                      </td>
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatDateTime(c.startedAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.color }}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {c.summary ?? 'Call in progress or no summary generated'}
                      </td>
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {c.agent?.name ?? 'Chotu AI'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
