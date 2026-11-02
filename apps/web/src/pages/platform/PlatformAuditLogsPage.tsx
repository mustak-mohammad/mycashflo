import { useState, useEffect } from 'react'
import {
  getPlatformAuditLogs,
  getPlatformTenants,
  type PlatformAuditLog,
  type PlatformTenant,
} from '../../api/platform'

export default function PlatformAuditLogsPage() {
  const [logs, setLogs] = useState<PlatformAuditLog[]>([])
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters & Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [tenantFilter, setTenantFilter] = useState('ALL')
  const [actionFilter, setActionFilter] = useState('')
  const [selectedLog, setSelectedLog] = useState<PlatformAuditLog | null>(null)

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const [logRes, tenRes] = await Promise.all([
        getPlatformAuditLogs({
          page,
          limit: 25,
          tenantId: tenantFilter === 'ALL' ? undefined : tenantFilter,
          action: actionFilter.trim() || undefined,
        }),
        getPlatformTenants().catch(() => []),
      ])
      setLogs(logRes.data || [])
      setTotal(logRes.total || 0)
      setTotalPages(logRes.totalPages || 1)
      if (tenants.length === 0) {
        setTenants(tenRes)
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load platform audit trail')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [page, tenantFilter])

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    loadLogs()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Platform Audit Trail
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Immutable cross-tenant activity logs, security access events, and administrative mutations.
          </p>
        </div>

        <button
          onClick={() => loadLogs()}
          disabled={loading}
          className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <span>🔄</span> Refresh Trail
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <form
        onSubmit={handleFilterSubmit}
        className="p-4 rounded-xl border border-slate-800 bg-[#111927] flex flex-col sm:flex-row items-center gap-3 text-xs"
      >
        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Filter by action (e.g. platform, role)..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="w-full sm:w-56">
          <select
            value={tenantFilter}
            onChange={(e) => {
              setTenantFilter(e.target.value)
              setPage(1)
            }}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Tenants</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.slug})
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="px-4 py-2 font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer w-full sm:w-auto"
        >
          Search
        </button>

        <div className="text-slate-400 sm:ml-auto">
          Total Recorded Events: <span className="font-semibold text-slate-200">{total}</span>
        </div>
      </form>

      {/* Audit Log Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111927] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading audit records...
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No audit events found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action Event</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Tenant Scope</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono text-sky-300 font-semibold bg-sky-950/40 border border-sky-900/50 px-1.5 py-0.5 rounded text-[11px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-white">{log.user?.name || log.userId}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {log.user?.email || 'System / Platform'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-300 font-medium">
                        {log.tenant?.name || 'Platform Level'}
                      </div>
                      <code className="text-[10px] text-slate-500">
                        {log.tenant?.slug || log.tenantId}
                      </code>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                      {log.entityType ? (
                        <span>
                          {log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)}...)` : ''}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {log.metadata ? (
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer text-[11px]"
                        >
                          View JSON
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div>
              Page <span className="font-semibold text-slate-200">{page}</span> of{' '}
              <span className="font-semibold text-slate-200">{totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata JSON Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white font-mono">{selectedLog.action}</h3>
                <div className="text-xs text-slate-400">
                  {new Date(selectedLog.createdAt).toLocaleString()} · ID: {selectedLog.id}
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="text-xs mb-4">
              <div className="text-slate-400 mb-1 font-semibold uppercase text-[10px]">
                Event Payload & Metadata
              </div>
              <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-emerald-400 font-mono text-[11px] overflow-x-auto max-h-72">
                {JSON.stringify(selectedLog.metadata, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white"
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

