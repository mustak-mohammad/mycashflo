import { useState, useEffect } from 'react'
import {
  getPlatformAnalytics,
  getPlatformSummary,
  type PlatformAnalytics,
  type PlatformSummary,
} from '../../api/platform'
import { StatCard } from '../../components/ui/StatCard'

export default function PlatformAnalyticsPage() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null)
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [anData, sumData] = await Promise.all([
        getPlatformAnalytics(),
        getPlatformSummary(),
      ])
      setAnalytics(anData)
      setSummary(sumData)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load platform analytics')
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

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-4" />
        <div className="text-sm font-medium text-slate-300">Computing global platform metrics...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="p-6 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200">
          <h3 className="font-semibold text-base mb-2">Error Loading Analytics</h3>
          <p className="text-sm text-rose-300 mb-4">{error}</p>
          <button
            onClick={() => loadData()}
            className="px-4 py-2 text-xs font-semibold rounded bg-rose-800 hover:bg-rose-700 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Platform Analytics & Usage
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Global multi-tenant growth trends, role distribution, and cross-organization financial throughput.
          </p>
        </div>

        <button
          onClick={() => loadData()}
          className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <span>🔄</span> Recalculate Aggregates
        </button>
      </div>

      {/* Authenticity Notice */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
        <span className="text-base text-blue-400 mt-0.5">ℹ️</span>
        <div>
          <span className="font-semibold text-white">Verified Platform Metrics:</span> All values on this dashboard reflect live transactional and tenant data from PostgreSQL database records. Speculative projections or fabricated telemetry are explicitly excluded to maintain compliance and audit integrity.
        </div>
      </div>

      {/* High-Level Overview Stats */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Onboarded Workspaces"
            value={summary.tenantsCount}
            subtext={`${summary.activeTenantsCount ?? summary.tenantsCount} active tenant org(s)`}
            icon="🏢"
            color="#0ea5e9"
          />
          <StatCard
            label="Total Platform Users"
            value={analytics?.usersTotal ?? summary.usersCount}
            subtext={`${analytics?.activeUsersTotal ?? summary.usersCount} active account(s)`}
            icon="👥"
            color="#8b5cf6"
          />
          <StatCard
            label="Cumulative Invoiced"
            value={formatCurrency(summary.totalInvoiced)}
            subtext={`${summary.invoicesCount} invoices issued`}
            icon="🧾"
            color="#6366f1"
          />
          <StatCard
            label="Cumulative Collections"
            value={formatCurrency(summary.totalCollected)}
            subtext={`${summary.completedPaymentsCount} verified settlements`}
            icon="💳"
            color="#10b981"
          />
        </div>
      )}

      {/* Role Distribution & Financial Liquidity Aggregation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Role Distribution */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
              Cross-Tenant Role Distribution
            </h2>
            <span className="text-xs text-slate-400">
              Total Accounts: {analytics?.usersTotal || 0}
            </span>
          </div>

          <div className="space-y-4 text-xs">
            {Object.entries(analytics?.roleDistribution || {}).map(([role, count]) => {
              const total = analytics?.usersTotal || 1
              const pct = Math.round((count / total) * 100)

              return (
                <div key={role} className="space-y-1.5">
                  <div className="flex items-center justify-between text-slate-200">
                    <span className="font-semibold flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          background:
                            role === 'SUPER_ADMIN'
                              ? '#0ea5e9'
                              : role === 'ADMIN'
                              ? '#6366f1'
                              : role === 'MANAGER'
                              ? '#f59e0b'
                              : '#10b981',
                        }}
                      />
                      {role}
                    </span>
                    <span className="text-slate-400 font-mono">
                      {count} user(s) ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background:
                          role === 'SUPER_ADMIN'
                            ? '#0ea5e9'
                            : role === 'ADMIN'
                            ? '#6366f1'
                            : role === 'MANAGER'
                            ? '#f59e0b'
                            : '#10b981',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Global Financial Liquidity & Settlements */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
              Platform Throughput Ratios
            </h2>
            <span className="text-xs text-slate-400">Ledger Aggregates</span>
          </div>

          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-slate-400">Total Billed Volume</div>
                <div className="text-lg font-bold text-white mt-0.5">
                  {formatCurrency(analytics?.financials.totalInvoiced || 0)}
                </div>
              </div>
              <span className="text-2xl">🧾</span>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-slate-400">Total Collected Settlements</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">
                  {formatCurrency(analytics?.financials.totalCollected || 0)}
                </div>
              </div>
              <span className="text-2xl">💳</span>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-slate-400">Outstanding Tenant Receivables</div>
                <div className="text-lg font-bold text-amber-400 mt-0.5">
                  {formatCurrency(analytics?.financials.totalOutstanding || 0)}
                </div>
              </div>
              <span className="text-2xl">⏳</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tenant Growth & Account Onboarding Timeline */}
      <div className="rounded-xl border border-slate-800 bg-[#111927] p-5">
        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wide mb-3">
          Workspace Provisioning History
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Chronological record of enterprise organizations provisioned on this platform instance.
        </p>

        {analytics?.tenantCreationTimeline.length === 0 ? (
          <div className="text-xs text-slate-400 p-4">No tenant timeline data recorded.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {analytics?.tenantCreationTimeline.map((item, idx) => (
              <div
                key={item.id}
                className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold text-slate-200">Workspace #{idx + 1}</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-sky-950/40 text-sky-400 border border-sky-900/50 text-[10px] font-bold">
                  Active
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

