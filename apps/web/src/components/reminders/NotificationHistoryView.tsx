import { useState, useCallback, useEffect } from 'react'
import {
  getNotifications,
  getNotificationTemplates,
  dispatchNotification,
  type NotificationTemplate,
} from '../../api/notifications'
import { customersApi } from '../../api/customers'
import { useToast } from '../../store/ToastContext'
import { extractSafeErrorMessage } from '../../utils/safeError'
import type { Notification, Customer, NotificationChannel, NotifStatus } from '../../../../../packages/shared-types'

function statusBadge(status: NotifStatus) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    DELIVERED: { bg: 'rgba(16,185,129,0.15)', color: '#34d399', label: 'Delivered' },
    SENT: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'Sent' },
    PENDING: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', label: 'Pending' },
    SUPPRESSED: { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8', label: 'Suppressed' },
    FAILED: { bg: 'rgba(239,68,68,0.15)', color: '#f87171', label: 'Failed' },
  }
  const s = map[status] || { bg: 'rgba(148,163,184,0.1)', color: '#94a3b8', label: status }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold inline-flex items-center gap-1" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function channelBadge(channel: NotificationChannel) {
  const icons: Record<string, string> = {
    WHATSAPP: '💬 WhatsApp',
    EMAIL: '✉️ Email',
    SMS: '📱 SMS',
  }
  return (
    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-white/5 border border-white/10 text-white/80">
      {icons[channel] || channel}
    </span>
  )
}

export function NotificationHistoryView() {
  const toast = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // Dispatch Modal state
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [dispatchCustomer, setDispatchCustomer] = useState('')
  const [dispatchChannel, setDispatchChannel] = useState<NotificationChannel>('WHATSAPP')
  const [dispatchTemplate, setDispatchTemplate] = useState('PAYMENT_REMINDER_OVERDUE')
  const [dispatchCustomMsg, setDispatchCustomMsg] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchError, setDispatchError] = useState<string | null>(null)

  const limit = 20

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getNotifications({
        page,
        limit,
        channel: (channelFilter as NotificationChannel) || undefined,
        status: (statusFilter as NotifStatus) || undefined,
      })
      setNotifications(res.data)
      setTotal(res.total)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to load notifications history.')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [page, channelFilter, statusFilter])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  const handleOpenDispatch = async () => {
    setIsDispatchOpen(true)
    setDispatchError(null)
    try {
      const [tpls, custsRes] = await Promise.all([
        getNotificationTemplates().catch(() => []),
        customersApi.list({ limit: 100 }).catch(() => ({ data: [] })),
      ])
      setTemplates(tpls)
      const list = custsRes.data || []
      setCustomers(list as any)
      if (list.length > 0 && !dispatchCustomer) {
        setDispatchCustomer(list[0].id)
      }
    } catch (err: unknown) {
      console.warn('Could not pre-load customers/templates:', err)
    }
  }

  const handleRetry = async (n: Notification) => {
    await handleOpenDispatch()
    setDispatchCustomer(n.customerId)
    setDispatchChannel(n.channel)
    setDispatchTemplate(n.template || 'PAYMENT_REMINDER_OVERDUE')
  }

  const handleSendDispatch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dispatchCustomer) {
      setDispatchError('Please select a target customer.')
      return
    }
    setDispatching(true)
    setDispatchError(null)
    try {
      const res = await dispatchNotification({
        customerId: dispatchCustomer,
        channel: dispatchChannel,
        template: dispatchTemplate,
        payload: dispatchCustomMsg ? { customMessage: dispatchCustomMsg } : {},
      })
      toast.success(`Notification sent via ${res.channel} (Status: ${res.status}).`)
      setIsDispatchOpen(false)
      setDispatchCustomMsg('')
      loadNotifications()
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to dispatch notification.')
      setDispatchError(msg)
      toast.error(msg)
    } finally {
      setDispatching(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-4">
      {/* Top action & filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="flex items-center gap-3">
          <select
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by notification channel"
            className="px-3 py-1.5 rounded-lg text-xs bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="">All Channels</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by delivery status"
            className="px-3 py-1.5 rounded-lg text-xs bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="DELIVERED">Delivered</option>
            <option value="SENT">Sent</option>
            <option value="PENDING">Pending</option>
            <option value="SUPPRESSED">Suppressed</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        <button
          type="button"
          onClick={handleOpenDispatch}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <span>✉️</span>
          <span>+ Dispatch Notification</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden border border-white/10" style={{ background: 'var(--surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 text-white/50 uppercase tracking-wider bg-white/[0.01]">
              <tr>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Channel</th>
                <th className="px-5 py-3">Template</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Details / Reason</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-5 py-3.5">
                      <div className="h-4 rounded animate-pulse bg-white/5" style={{ width: '80%' }} />
                    </td>
                  </tr>
                ))
              ) : notifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-white/40">
                    No notification history records found for the selected filters.
                  </td>
                </tr>
              ) : (
                notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 font-medium text-white">
                      {(n as any).customer?.name || (n as any).customerId || '—'}
                    </td>
                    <td className="px-5 py-3.5">{channelBadge(n.channel)}</td>
                    <td className="px-5 py-3.5 font-mono text-[11px] text-white/70">
                      {n.template || 'CUSTOM_MESSAGE'}
                    </td>
                    <td className="px-5 py-3.5">{statusBadge(n.status)}</td>
                    <td className="px-5 py-3.5 text-white/60 max-w-xs truncate" title={(n as any).suppressionReason || (n as any).failReason || (n as any).error || ''}>
                      {(n as any).suppressionReason ? (
                        <span className="text-amber-300/80 font-medium">{(n as any).suppressionReason}</span>
                      ) : (n as any).failReason ? (
                        <span className="text-rose-300/80 font-medium">{(n as any).failReason}</span>
                      ) : (n as any).error ? (
                        <span className="text-rose-300/80">{(n as any).error}</span>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-white/40">
                      {new Date(n.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {n.status === 'FAILED' ? (
                        <button
                          type="button"
                          onClick={() => handleRetry(n)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white transition-colors cursor-pointer"
                          title="Open notification dispatch to retry sending"
                        >
                          ↻ Retry
                        </button>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/50 bg-white/[0.01]">
            <div>
              Page {page} of {totalPages} · {total} notifications
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual Dispatch Modal */}
      {isDispatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Ad-hoc Multi-Channel Notification</h3>
              <button
                type="button"
                onClick={() => setIsDispatchOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendDispatch} className="p-6 space-y-4 text-xs">
              {dispatchError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  {dispatchError}
                </div>
              )}

              <div>
                <label className="block text-white/70 mb-1">Target Customer</label>
                <select
                  value={dispatchCustomer}
                  onChange={(e) => setDispatchCustomer(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.company ? `(${c.company})` : ''} — {c.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-white/70 mb-1">Channel</label>
                  <select
                    value={dispatchChannel}
                    onChange={(e) => setDispatchChannel(e.target.value as NotificationChannel)}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">Email</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Template</label>
                  <select
                    value={dispatchTemplate}
                    onChange={(e) => setDispatchTemplate(e.target.value)}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="PAYMENT_REMINDER_OVERDUE">Payment Reminder (Overdue)</option>
                    <option value="PAYMENT_REMINDER_UPCOMING">Payment Reminder (Upcoming)</option>
                    <option value="CUSTOM_MESSAGE">Custom Ad-Hoc Message</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-white/70 mb-1">Custom Message / Variable Payload (Optional)</label>
                <textarea
                  rows={3}
                  value={dispatchCustomMsg}
                  onChange={(e) => setDispatchCustomMsg(e.target.value)}
                  placeholder="Optional custom message note or special payment instruction..."
                  className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsDispatchOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dispatching}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 shadow-md shadow-indigo-600/30"
                >
                  {dispatching ? 'Sending…' : 'Send Notification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
