import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { StatCard } from '../../components/ui/StatCard'
import {
  getPlatformSummary,
  getPlatformTenants,
  getPlatformSettings,
  getPlatformAuditLogs,
  type PlatformSummary,
  type PlatformTenant,
  type PlatformSettings,
  type PlatformAuditLog,
} from '../../api/platform'

export default function PlatformOverviewPage() {
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [recentLogs, setRecentLogs] = useState<PlatformAuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, ten, set, logs] = await Promise.all([
        getPlatformSummary(),
        getPlatformTenants(),
        getPlatformSettings().catch(() => null),
        getPlatformAuditLogs({ limit: 4 }).catch(() => ({ data: [] })),
      ])
      setSummary(sum)
      setTenants(ten)
      setSettings(set)
      setRecentLogs(logs.data || [])
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load platform overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const formatCurrency = (amt: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt)
  }

  // Derive compact platform alerts from live data
  const alerts: Array<{ id: string; type: 'warning' | 'info'; text: string; link?: string }> = []
  if (tenants.length > 0) {
    const emptyTenants = tenants.filter((t) => t.stats.userCount === 0)
    if (emptyTenants.length > 0) {
      alerts.push({
        id: 'empty_tenants',
        type: 'warning',
        text: `${emptyTenants.length} tenant(s) provisioned without users`,
        link: '/platform/tenants',
      })
    }

    const suspendedTenants = tenants.filter((t) => (t.stats.activeUserCount ?? 1) === 0 && t.stats.userCount > 0)
    if (suspendedTenants.length > 0) {
      alerts.push({
        id: 'suspended_tenants',
        type: 'warning',
        text: `${suspendedTenants.length} tenant organization(s) suspended`,
        link: '/platform/tenants',
      })
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-slate-400">Loading platform overview...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs">
          <div className="font-semibold text-sm mb-1">Unable to Load Platform Data</div>
          <p className="mb-3 text-rose-300">{error}</p>
          <button
            onClick={() => loadData()}
            className="px-3 py-1.5 rounded bg-rose-800 hover:bg-rose-700 text-white font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Concise Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Platform Overview
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Key metrics and health status across all tenant organizations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => loadData()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span>🔄</span> Refresh
          </button>
          <Link
            to="/platform/tenants"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors no-underline shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <span>➕</span> Provision Tenant
          </Link>
        </div>
      </div>

      {/* 4 Core KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Tenants"
            value={summary.tenantsCount}
            subtext={`${summary.activeTenantsCount ?? summary.tenantsCount} active`}
            icon="🏢"
            color="#0ea5e9"
          />
          <StatCard
            label="Total Platform Users"
            value={summary.totalUsersCount ?? summary.usersCount}
            subtext={`${summary.usersCount} active`}
            icon="👥"
            color="#8b5cf6"
          />
          <StatCard
            label="Platform Invoiced"
            value={formatCurrency(summary.totalInvoiced)}
            subtext={`${summary.invoicesCount} invoices`}
            icon="🧾"
            color="#6366f1"
          />
          <StatCard
            label="Platform Collected"
            value={formatCurrency(summary.totalCollected)}
            subtext={`${summary.completedPaymentsCount} settlements`}
            icon="💳"
            color="#10b981"
          />
        </div>
      )}

      {/* Compact Status & Alerts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Core Service Health */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <h2 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <span>⚡</span> Core Service Health
            </h2>
            <span className="text-[10px] text-slate-500">Live Status</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between">
              <span className="text-slate-400">API Gateway</span>
              <span className="font-semibold text-emerald-400 flex items-center gap-1 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Operational
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between">
              <span className="text-slate-400">Database</span>
              <span className="font-semibold text-emerald-400 flex items-center gap-1 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Connected
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between">
              <span className="text-slate-400">Isolation</span>
              <span className="font-semibold text-emerald-400 text-[11px]">Enforced</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 flex items-center justify-between">
              <span className="text-slate-400">Environment</span>
              <span className="font-mono text-slate-300 uppercase text-[10px]">
                {settings?.environment || 'development'}
              </span>
            </div>
          </div>
        </div>

        {/* Compact Alerts Summary */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <h2 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <span>🛡️</span> Platform Alerts
            </h2>
            <Link
              to="/platform/settings"
              className="text-[11px] text-sky-400 hover:text-sky-300 no-underline"
            >
              Settings →
            </Link>
          </div>

          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-800/50 text-amber-200 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400">⚠️</span>
                    <span>{alert.text}</span>
                  </div>
                  {alert.link && (
                    <Link
                      to={alert.link}
                      className="text-[11px] font-semibold text-sky-400 hover:underline"
                    >
                      Manage
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-300 text-xs flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              <span>All platform invariants normal. No tenant access or configuration alerts.</span>
            </div>
          )}
        </div>
      </div>

      {/* Compact Activity & Tenants Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Tenants */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <span>🏢</span> Recent Workspaces
            </h2>
            <Link
              to="/platform/tenants"
              className="text-[11px] text-sky-400 hover:text-sky-300 no-underline"
            >
              View all ({tenants.length}) →
            </Link>
          </div>

          {tenants.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No tenants provisioned yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50 text-xs">
              {tenants.slice(0, 4).map((t) => (
                <div key={t.id} className="p-3 hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-200">{t.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      slug: {t.slug}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400">
                      {t.stats.userCount} users
                    </span>
                    <div className="text-[10px] text-slate-500">
                      {t.stats.invoiceCount} invoices
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Administrative Activity */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <span>📜</span> Recent Platform Activity
            </h2>
            <Link
              to="/platform/audit-logs"
              className="text-[11px] text-sky-400 hover:text-sky-300 no-underline"
            >
              Full trail →
            </Link>
          </div>

          {recentLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No recent activity recorded.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50 text-xs">
              {recentLogs.map((log) => (
                <div key={log.id} className="p-3 hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sky-400 text-[11px]">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    by {log.user?.email || log.userId} {log.tenant ? `· ${log.tenant.slug}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
