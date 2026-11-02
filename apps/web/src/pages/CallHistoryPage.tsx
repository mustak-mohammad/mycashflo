import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { callsApi } from '../api/calls'
import type { CallSession } from '../types'

const OUTCOME_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  PROMISE_TO_PAY:      { bg: 'rgba(245,158,11,0.15)', color: 'var(--warning)',    label: 'Promise to Pay' },
  WILL_PAY_LATER:      { bg: 'rgba(59,130,246,0.15)',  color: '#3b82f6',           label: 'Will Pay Later' },
  UNABLE_TO_PAY:       { bg: 'rgba(239,68,68,0.15)',   color: 'var(--danger)',     label: 'Unable to Pay' },
  PAYMENT_CLAIMED:     { bg: 'rgba(16,185,129,0.15)',  color: 'var(--accent)',     label: 'Payment Claimed' },
  CALLBACK_REQUESTED:  { bg: 'rgba(99,102,241,0.15)',  color: 'var(--primary)',    label: 'Callback Requested' },
  DISPUTE:             { bg: 'rgba(244,63,94,0.15)',   color: '#f43f5e',           label: 'Dispute' },
  NO_CONTACT:          { bg: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)', label: 'No Contact' },
  RESOLVED:            { bg: 'rgba(16,185,129,0.15)',  color: 'var(--accent)',     label: 'Resolved' },
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
  const [playingId, setPlayingId] = useState<string | null>(null)
  const token = localStorage.getItem('mcf_access_token') || localStorage.getItem('token') || ''
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
          { label: 'Will Pay Later', value: 'WILL_PAY_LATER' },
          { label: 'Unable to Pay', value: 'UNABLE_TO_PAY' },
          { label: 'Payment Claimed', value: 'PAYMENT_CLAIMED' },
          { label: 'Callback', value: 'CALLBACK_REQUESTED' },
          { label: 'Dispute', value: 'DISPUTE' },
          { label: 'Resolved', value: 'RESOLVED' },
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
                        {c.recordingStatus === 'AVAILABLE' ? (
                          <div className="flex flex-col gap-1.5 min-w-[140px]">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setPlayingId(playingId === c.id ? null : c.id)}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors"
                                style={{
                                  background: playingId === c.id ? 'var(--primary)' : 'rgba(99,102,241,0.15)',
                                  color: playingId === c.id ? '#ffffff' : 'var(--primary)',
                                  border: '1px solid var(--border)',
                                }}
                                title={playingId === c.id ? 'Close player' : 'Play call audio'}
                              >
                                <span>{playingId === c.id ? '⏹️' : '▶️'}</span>
                                {playingId === c.id ? 'Close' : 'Play'}
                              </button>

                              <button
                                onClick={() => handleRecordingDownload(c)}
                                disabled={downloadingId === c.id}
                                title="Download call recording"
                                className="px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors"
                                style={{
                                  background: 'rgba(255,255,255,0.06)',
                                  color: 'var(--text)',
                                  border: '1px solid var(--border)',
                                  cursor: downloadingId === c.id ? 'wait' : 'pointer',
                                }}
                              >
                                <span>📥</span>
                                {downloadingId === c.id ? '…' : 'Audio'}
                              </button>
                            </div>

                            {playingId === c.id && (
                              <div className="mt-1.5 p-1 rounded bg-black/40 border border-slate-700/60 shadow-lg">
                                <audio
                                  controls
                                  autoPlay
                                  className="h-8 w-48 rounded"
                                  src={`/api/calls/${c.id}/recording/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`}
                                >
                                  Your browser does not support audio playback.
                                </audio>
                              </div>
                            )}
                          </div>
                        ) : c.recordingStatus === 'PROCESSING' ? (
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1"
                            style={{ background: 'rgba(234,179,8,0.12)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.2)' }}
                          >
                            <span>⏳</span> Processing
                          </span>
                        ) : c.recordingStatus === 'FAILED' ? (
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1"
                            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}
                            title="Audio recording failed during processing or upload"
                          >
                            <span>❌</span> Failed
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-normal inline-block"
                            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                            title="Audio was not recorded for this historical session"
                          >
                            Recording unavailable
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
