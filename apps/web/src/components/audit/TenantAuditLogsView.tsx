import { useState, useEffect, useCallback } from 'react'
import { getAuditLogs } from '../../api/auditLogs'
import type { AuditLog } from '../../../../../packages/shared-types'

const ENTITY_TYPES = [
  { value: '', label: 'All Entities' },
  { value: 'User', label: 'User' },
  { value: 'Customer', label: 'Customer' },
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Payment', label: 'Payment' },
  { value: 'CollectionCase', label: 'Collection Case' },
  { value: 'VoicePrompt', label: 'Voice Prompt' },
  { value: 'IntegrationConfig', label: 'Integration Config' },
  { value: 'Tenant', label: 'Tenant' },
]

const SENSITIVE_META_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'apikey',
  'keysecret',
  'secretkey',
  'webhooksecret',
  'appsecret',
  'sippassword',
  'secret',
  'authorization',
])

function sanitizeMetadata(val: unknown): unknown {
  if (val === null || val === undefined) return val
  if (Array.isArray(val)) return val.map(sanitizeMetadata)
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_META_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = sanitizeMetadata(v)
      }
    }
    return out
  }
  return val
}

function formatMetadataSummary(metadata: unknown): string {
  if (!metadata) return '—'
  try {
    const cleaned = sanitizeMetadata(metadata)
    const str = JSON.stringify(cleaned)
    return str === '{}' ? '—' : str
  } catch {
    return '—'
  }
}

function deriveOutcomeBadge(log: AuditLog): { label: string; style: string } {
  const meta = (log.metadata || {}) as Record<string, unknown>
  if (meta.status === 'FAILED' || log.action.includes('failed') || log.action.includes('rejected')) {
    return {
      label: 'Failed / Rejected',
      style: 'bg-rose-950/60 text-rose-300 border border-rose-800/60',
    }
  }
  if (meta.isSimulated === true) {
    return {
      label: 'Simulated',
      style: 'bg-amber-950/60 text-amber-300 border border-amber-800/60',
    }
  }
  return {
    label: 'Recorded',
    style: 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50',
  }
}

export function TenantAuditLogsView() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionInput, setActionInput] = useState('')
  const [appliedAction, setAppliedAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [reloadSeq, setReloadSeq] = useState(0)

  const limit = 20
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const fetchAuditPage = useCallback(
    async (targetPage: number, actionFilter: string, entityFilter: string) => {
      return getAuditLogs({
        page: targetPage,
        limit,
        action: actionFilter.trim() || undefined,
        entityType: entityFilter || undefined,
      })
    },
    [],
  )

  useEffect(() => {
    let active = true
    void fetchAuditPage(page, appliedAction, entityType)
      .then((res) => {
        if (!active) return
        setLogs(res.data || [])
        setTotal(res.total || 0)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        const status = (err as { response?: { status?: number } })?.response?.status
        const rawMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        const msg =
          status === 403
            ? 'You do not have permission to view tenant audit logs.'
            : typeof rawMsg === 'string'
            ? rawMsg
            : err instanceof Error
            ? err.message
            : 'Failed to load audit logs.'
        setError(msg)
        setLogs([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [page, appliedAction, entityType, reloadSeq, fetchAuditPage])

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setPage(1)
    setAppliedAction(actionInput)
  }

  const handleEntityChange = (nextEntity: string) => {
    setLoading(true)
    setError(null)
    setPage(1)
    setEntityType(nextEntity)
  }

  const handleReset = () => {
    setLoading(true)
    setError(null)
    setActionInput('')
    setAppliedAction('')
    setEntityType('')
    setPage(1)
  }

  const handleRefresh = () => {
    setLoading(true)
    setError(null)
    setReloadSeq((s) => s + 1)
  }

  return (
    <div
      className="rounded-2xl p-6 space-y-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>📜</span> Tenant Compliance Audit Trail
          </h2>
          <p className="text-xs text-white/50 mt-1">
            Tenant-scoped security and operational audit log ({total} total event{total === 1 ? '' : 's'}).
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Filters */}
      <form
        onSubmit={handleFilterSubmit}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 text-xs"
      >
        <input
          type="text"
          aria-label="Filter by action"
          placeholder="Filter by action (e.g. integration.configured, user.created)…"
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500"
        />

        <select
          aria-label="Filter by entity type"
          value={entityType}
          onChange={(e) => handleEntityChange(e.target.value)}
          className="px-3 py-2 rounded-lg text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500"
        >
          {ENTITY_TYPES.map((et) => (
            <option key={et.value || 'ALL'} value={et.value} className="bg-slate-900">
              {et.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
          >
            Apply Filter
          </button>
          {(appliedAction || entityType || actionInput) && (
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-2 rounded-lg font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs flex items-center justify-between gap-4"
        >
          <span>⚠️ {error}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-semibold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              {['Timestamp', 'Actor', 'Action', 'Entity', 'Outcome', 'Details'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-medium uppercase tracking-wider text-white/50"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/50">
                  Loading compliance audit trail…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-white/40">
                  Audit records unavailable until the error above is resolved.
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/50">
                  No audit records match the selected filters.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const outcome = deriveOutcomeBadge(log)
                const actorRole = (log.user as { role?: string } | undefined)?.role
                return (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white/60 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">
                        {log.user?.name || log.user?.email || 'System'}
                      </div>
                      {(log.user?.email || actorRole) && (
                        <div className="text-[11px] text-white/40">
                          {log.user?.email}
                          {actorRole ? ` · ${actorRole}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-indigo-300">{log.action}</td>
                    <td className="px-4 py-3 text-white/70">
                      <div>{log.entityType || '—'}</div>
                      {log.entityId && (
                        <div className="text-[10px] font-mono text-white/40">{log.entityId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${outcome.style}`}>
                        {outcome.label}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 text-white/50 font-mono text-[11px] max-w-xs truncate"
                      title={formatMetadataSummary(log.metadata)}
                    >
                      {formatMetadataSummary(log.metadata)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div
          className="pt-3 flex items-center justify-between text-xs text-white/60"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <span>
            Page {page} of {totalPages} · {total} entries
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true)
                setPage((p) => Math.max(1, p - 1))
              }}
              className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 cursor-pointer"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => {
                setLoading(true)
                setPage((p) => Math.min(totalPages, p + 1))
              }}
              className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 cursor-pointer"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

