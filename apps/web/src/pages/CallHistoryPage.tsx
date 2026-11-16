import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { callsApi } from '../api/calls'
import { invoicesApi } from '../api/invoices'
import { useToast } from '../store/ToastContext'
import { extractSafeApiError } from '../utils/safeError'
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

export function CallHistoryView({ hideHeader }: { hideHeader?: boolean } = {}) {
  const toast = useToast()
  const [outcomeFilter, setOutcomeFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [selectedCallForDetails, setSelectedCallForDetails] = useState<CallSession | null>(null)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)
  const [copiedPaymentLinkId, setCopiedPaymentLinkId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
    setActionError(null)
    try {
      setExporting(true)
      await callsApi.downloadCsv({ outcome: outcomeFilter || undefined })
      toast.success('Call history exported to CSV.')
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to export call history.')
      setActionError(msg)
      toast.error(msg)
    } finally {
      setExporting(false)
    }
  }

  const handleRecordingDownload = async (c: CallSession) => {
    setActionError(null)
    try {
      setDownloadingId(c.id)
      const label = (c.customer?.name ?? 'call').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      await callsApi.downloadRecording(c.id, label)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to download call recording.')
      setActionError(msg)
      toast.error(msg)
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className={hideHeader ? 'space-y-4' : 'p-6 max-w-7xl mx-auto'}>
      {!hideHeader ? (
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
      ) : (
        <div className="flex justify-end">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-md shadow-emerald-600/30 disabled:opacity-50"
          >
            <span>📥</span>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      )}

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

      {(error || actionError) && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm mb-4 flex items-center justify-between gap-3"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
          }}
        >
          <span>⚠️ {actionError || error}</span>
          {actionError && (
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs underline cursor-pointer bg-transparent border-none text-current"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Customer', 'Duration', 'Date & Time', 'Outcome', 'Summary', 'Agent', 'Actions & Recording'].map((h) => (
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
                        <div>{c.summary ?? 'Call in progress or no summary generated'}</div>
                        {c.metadata?.structuredSummary && (
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                            {c.metadata.structuredSummary.paymentCommitment && c.metadata.structuredSummary.paymentCommitment !== 'NONE' && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 font-semibold">
                                PTP: {c.metadata.structuredSummary.paymentCommitment}
                                {c.metadata.structuredSummary.commitmentAmount ? ` (${c.metadata.structuredSummary.commitmentAmount})` : ''}
                              </span>
                            )}
                            {c.metadata.structuredSummary.customerReportedPayment && (
                              <span className="px-1.5 py-0.5 rounded bg-sky-950/70 text-sky-400 border border-sky-800/60">
                                Ref: {c.metadata.structuredSummary.customerReportedPayment.utrOrReference}
                              </span>
                            )}
                            {c.metadata.structuredSummary.disputeDetails && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-950/70 text-rose-400 border border-rose-800/60">
                                Dispute: {c.metadata.structuredSummary.disputeDetails.reason}
                              </span>
                            )}
                            {c.metadata.structuredSummary.callbackRequest && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-950/70 text-purple-400 border border-purple-800/60">
                                Callback: {c.metadata.structuredSummary.callbackRequest.requestedTime}
                              </span>
                            )}
                            {c.metadata.structuredSummary.nextAction && (
                              <span className="text-indigo-300 font-medium block w-full mt-0.5">
                                Next: {c.metadata.structuredSummary.nextAction}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Document Delivery Row Indicator */}
                        {(() => {
                          const docDel = c.metadata?.structuredSummary?.documentDelivery ||
                            c.metadata?.extractedData?.documentDelivery ||
                            c.metadata?.documentDelivery
                          if (!docDel) return null
                          return (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="px-2 py-0.5 rounded font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 flex items-center gap-1">
                                <span>📄</span> {docDel.requestType === 'BOTH' ? 'Invoice & Pay Link' : docDel.requestType === 'PAYMENT_LINK' ? 'Pay Link' : 'Invoice'}
                                {docDel.invoiceNumber && <span className="font-mono text-[10px]">({docDel.invoiceNumber})</span>}
                              </span>
                              {docDel.attempts?.map((att: any, i: number) => (
                                <span
                                  key={i}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                    att.status === 'SIMULATED'
                                      ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                                      : att.status === 'DELIVERED' || att.status === 'SENT'
                                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                                      : att.status === 'FAILED'
                                      ? 'bg-rose-950/70 text-rose-300 border-rose-800/60'
                                      : 'bg-slate-800/70 text-slate-300 border-slate-700/60'
                                  }`}
                                >
                                  {att.channel === 'WHATSAPP' ? '💬 WA' : '✉️ Email'}: {att.status === 'SIMULATED' ? '🧪 Sim' : att.status}
                                </span>
                              ))}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {c.agent?.name ?? 'Chotu AI'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-2 min-w-[150px]">
                          <button
                            onClick={() => setSelectedCallForDetails(c)}
                            className="px-2.5 py-1 rounded-md text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-800/70 cursor-pointer flex items-center gap-1 w-fit transition-colors"
                          >
                            <span>📋</span> Call Details
                          </button>

                          {c.recordingStatus === 'AVAILABLE' ? (
                            <div className="flex flex-col gap-1.5">
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
                              className="px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 w-fit"
                              style={{ background: 'rgba(234,179,8,0.12)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.2)' }}
                            >
                              <span>⏳</span> Processing
                            </span>
                          ) : c.recordingStatus === 'FAILED' ? (
                            <span
                              className="px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 w-fit"
                              style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}
                              title="Audio recording failed during processing or upload"
                            >
                              <span>❌</span> Failed
                            </span>
                          ) : (
                            <span
                              className="px-2 py-0.5 rounded text-[11px] font-normal inline-block w-fit"
                              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                              title="Audio was not recorded for this historical session"
                            >
                              Recording unavailable
                            </span>
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
      </div>

      {/* Detailed Call Session Modal */}
      {selectedCallForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📞</span> Call Session Details: {selectedCallForDetails.customer?.name ?? 'Customer'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  ID: {selectedCallForDetails.id} • {formatDateTime(selectedCallForDetails.startedAt)} • {formatDuration(selectedCallForDetails.duration)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const s = selectedCallForDetails.outcome && OUTCOME_STYLE[selectedCallForDetails.outcome]
                    ? OUTCOME_STYLE[selectedCallForDetails.outcome]
                    : { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: selectedCallForDetails.outcome ?? 'Pending' }
                  return (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
                      {s.label}
                    </span>
                  )
                })()}
                <button
                  onClick={() => setSelectedCallForDetails(null)}
                  className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-6 space-y-5 overflow-y-auto text-xs text-slate-300">
              {/* Document Delivery Section */}
              {(() => {
                const doc = selectedCallForDetails.metadata?.structuredSummary?.documentDelivery ||
                  selectedCallForDetails.metadata?.extractedData?.documentDelivery ||
                  selectedCallForDetails.metadata?.documentDelivery
                if (!doc) return null
                const reqTypeLabel = doc.requestType === 'BOTH' ? 'Invoice & Payment Link' : doc.requestType === 'PAYMENT_LINK' ? 'Payment Link' : 'Invoice Copy'
                return (
                  <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-900/40 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-400 font-bold text-sm">📄 Customer Document Delivery</span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-900 text-indigo-200 border border-indigo-700">
                          {reqTypeLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                          <span>🧪</span> Simulation Mode (No real message sent)
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700">
                          {doc.status}
                        </span>
                      </div>
                    </div>

                    {/* Invoice & Actions Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Invoice Number:</span>
                        <span className="text-white font-mono font-medium">{doc.invoiceNumber || 'INV-CURRENT'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Channels:</span>
                        <span className="text-slate-200">{doc.deliveryChannel}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Requested At:</span>
                        <span className="text-slate-300 font-mono">{doc.requestedAt ? formatDateTime(doc.requestedAt) : formatDateTime(selectedCallForDetails.startedAt)}</span>
                      </div>
                    </div>

                    {/* Action Buttons for Document Delivery: PDF Download & Copy Link */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-900/30">
                      {doc.invoiceId && (
                        <button
                          onClick={async () => {
                            try {
                              setDownloadingPdfId(doc.invoiceId)
                              setActionError(null)
                              await invoicesApi.downloadPdf(doc.invoiceId, doc.invoiceNumber || 'INV-CURRENT')
                            } catch (err: unknown) {
                              const msg = await extractSafeApiError(err, 'Failed to download invoice PDF.')
                              setActionError(msg)
                              toast.error(msg)
                            } finally {
                              setDownloadingPdfId(null)
                            }
                          }}
                          disabled={downloadingPdfId === doc.invoiceId}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <span>📄</span>
                          {downloadingPdfId === doc.invoiceId ? 'Downloading PDF...' : 'Download Invoice PDF'}
                        </button>
                      )}

                      {doc.paymentLinkUrl && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(doc.paymentLinkUrl)
                            setCopiedPaymentLinkId(selectedCallForDetails.id)
                            setTimeout(() => setCopiedPaymentLinkId(null), 2000)
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>💳</span>
                          {copiedPaymentLinkId === selectedCallForDetails.id ? '✓ Payment Link Copied!' : 'Copy Payment Link'}
                        </button>
                      )}
                    </div>

                    {/* Delivery Attempts Table */}
                    {doc.attempts && doc.attempts.length > 0 && (
                      <div className="pt-2 border-t border-indigo-900/30">
                        <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2">
                          Delivery Attempts History
                        </div>
                        <div className="rounded-lg overflow-hidden border border-slate-800">
                          <table className="w-full text-[11px]">
                            <thead className="bg-slate-950 text-slate-400">
                              <tr>
                                <th className="px-3 py-1.5 text-left">Channel</th>
                                <th className="px-3 py-1.5 text-left">Destination</th>
                                <th className="px-3 py-1.5 text-left">Status</th>
                                <th className="px-3 py-1.5 text-left">Provider</th>
                                <th className="px-3 py-1.5 text-left">Error / Note</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 bg-slate-900/60">
                              {doc.attempts.map((att: any, idx: number) => (
                                <tr key={idx}>
                                  <td className="px-3 py-1.5 font-medium text-slate-200">
                                    {att.channel === 'WHATSAPP' ? '💬 WhatsApp' : '✉️ Email'}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-slate-300">
                                    {att.destinationMasked || '—'}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                      att.status === 'SIMULATED'
                                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                                        : att.status === 'DELIVERED' || att.status === 'SENT'
                                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                        : att.status === 'FAILED'
                                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                                        : 'bg-slate-800 text-slate-300 border-slate-700'
                                    }`}>
                                      {att.status === 'SIMULATED' ? '🧪 Simulated' : att.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-400 font-mono">
                                    {att.provider || 'SIMULATION'}
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-400">
                                    {att.errorMessage || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Structured Call Summary */}
              {selectedCallForDetails.metadata?.structuredSummary && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <span>📋</span> Structured Call Summary
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block">Customer Main Response:</span>
                      <span className="text-slate-200 italic font-medium">
                        "{selectedCallForDetails.metadata.structuredSummary.customerMainResponse || 'No response recorded'}"
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Payment Commitment:</span>
                      <span className="text-white font-medium">
                        {selectedCallForDetails.metadata.structuredSummary.paymentCommitment}
                        {selectedCallForDetails.metadata.structuredSummary.commitmentAmount ? ` (${selectedCallForDetails.metadata.structuredSummary.commitmentAmount})` : ''}
                      </span>
                    </div>
                    {selectedCallForDetails.metadata.structuredSummary.customerReportedPayment && (
                      <div className="sm:col-span-2 bg-sky-950/30 p-2 rounded border border-sky-800">
                        <span className="text-sky-400 font-semibold">Customer Reported Payment: </span>
                        <span>UTR/Ref: {selectedCallForDetails.metadata.structuredSummary.customerReportedPayment.utrOrReference}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 block">Next Action:</span>
                      <span className="text-indigo-300 font-semibold">{selectedCallForDetails.metadata.structuredSummary.nextAction}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Executive Narrative:</span>
                      <span className="text-slate-300">{selectedCallForDetails.metadata.structuredSummary.shortSummary}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Call Transcript */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>🗣️</span> Full Call Transcript
                </h4>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedCallForDetails.transcript ? (
                    selectedCallForDetails.transcript.split('\n').map((line, i) => {
                      const isAgent = line.startsWith('[AGENT]:')
                      const isCustomer = line.startsWith('[CUSTOMER]:')
                      const text = line.replace(/^\[(AGENT|CUSTOMER|SYSTEM)\]:\s*/, '')
                      return (
                        <div
                          key={i}
                          className={`p-2 rounded text-xs ${
                            isAgent
                              ? 'bg-indigo-950/50 border border-indigo-900/60 text-indigo-100 ml-3'
                              : isCustomer
                              ? 'bg-slate-800/60 border border-slate-700 text-slate-200 mr-3'
                              : 'text-slate-400 italic text-[11px]'
                          }`}
                        >
                          <span className="font-semibold block text-[10px] text-slate-400 uppercase mb-0.5">
                            {isAgent ? '🤖 Chotu AI' : isCustomer ? '👤 Customer' : 'ℹ️ System'}
                          </span>
                          {text}
                        </div>
                      )
                    })
                  ) : (
                    <div className="text-slate-400 italic">No transcript recorded for this session.</div>
                  )}
                </div>
              </div>

              {/* Audio Recording Section if available */}
              {selectedCallForDetails.recordingStatus === 'AVAILABLE' && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-base">🎙️</span>
                    <div>
                      <div className="text-xs font-semibold text-white">Call Recording Audio</div>
                      <div className="text-[11px] text-slate-400">Available on server</div>
                    </div>
                  </div>
                  <audio
                    controls
                    className="h-8 rounded w-64"
                    src={`/api/calls/${selectedCallForDetails.id}/recording/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`}
                  >
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 flex justify-end bg-slate-950">
              <button
                onClick={() => setSelectedCallForDetails(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CallHistoryPage() {
  return <CallHistoryView />
}
