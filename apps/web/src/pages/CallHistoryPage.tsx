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
      {Array.from({ length: 7 }).map((_, i) => (
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
  const [exporting, setExporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const limit = 20

  const fetcher = useCallback(
    () => callsApi.list({ page, limit, outcome: outcomeFilter || undefined }),
    [page, outcomeFilter],
  )
  const { data, loading, error } = useApi(fetcher)

  const calls = data?.data ?? []
  const total = data?.total ?? 0

  const handleExport = async () => {
    try {
      setExporting(true)
      await callsApi.downloadCsv({ outcome: outcomeFilter || undefined })
    } catch (err: any) {
      alert('Failed to export call history: ' + (err?.message || 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  const handleRecordingDownload = async (c: CallSession) => {
    try {
      setDownloadingId(c.id)
      const label = (c.customer?.name ?? 'call').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      await callsApi.downloadRecording(c.id, label)
    } catch (err: any) {
      alert('Failed to download recording: ' + (err?.message || 'Unknown error'))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Call History"
        subtitle={`${total} total AI voice & collection call records`}
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
                {['Customer', 'Duration', 'Date & Time', 'Outcome', 'Summary', 'Agent', 'Recording'].map((h) => (
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
                  <td colSpan={7} className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
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
                      <td className="px-5 py-3.5">
                        {c.recordingStatus ? (
                          <button
                            onClick={() => handleRecordingDownload(c)}
                            disabled={downloadingId === c.id}
                            title="Download call recording"
                            className="px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
                            style={{
                              background: 'rgba(99,102,241,0.15)',
                              color: 'var(--primary)',
                              border: '1px solid var(--border)',
                              cursor: downloadingId === c.id ? 'wait' : 'pointer',
                            }}
                          >
                            <span>🎙️</span>
                            {downloadingId === c.id ? 'Preparing…' : 'Audio'}
                          </button>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider font-semibold opacity-30" style={{ color: 'var(--text-muted)' }}>
                            No Audio
                          </span>
                        )}
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
