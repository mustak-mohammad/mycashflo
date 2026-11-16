import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { dashboardApi } from '../api/dashboard'
import { onboardingApi, type OnboardingStatus } from '../api/onboarding'
import { OnboardingWizardModal } from '../components/onboarding/OnboardingWizardModal'
import { getDisplayName } from '../utils/user'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded ${className ?? ''}`}
      style={{ background: 'var(--surface-2, rgba(255,255,255,0.05))' }}
    />
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const canManageOnboarding = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [dateRange, setDateRange] = useState<string>('all')
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Fetch verified stats scoped with date filter
  const fetcher = useCallback(
    () =>
      dashboardApi.getStats({
        dateRange,
        agingThreshold: 30,
      }),
    [dateRange, refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  // Load onboarding status on mount for Admin/Manager
  useEffect(() => {
    if (canManageOnboarding) {
      onboardingApi
        .getStatus()
        .then((st) => setOnboardingStatus(st))
        .catch((err) => console.warn('Could not load onboarding status:', err))
    }
  }, [canManageOnboarding])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header with Date Range Filter & Onboarding Action */}
      <PageHeader
        title={`Welcome back${user ? `, ${getDisplayName(user).split(' ')[0]}` : ''}! 👋`}
        subtitle="Live accounts receivable, collections performance, and financial overview."
        action={
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              aria-label="Filter dashboard by date range"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all" className="bg-[#18181b] text-white">All Time</option>
              <option value="30d" className="bg-[#18181b] text-white">Last 30 Days</option>
              <option value="90d" className="bg-[#18181b] text-white">Last 90 Days</option>
              <option value="this_month" className="bg-[#18181b] text-white">This Month</option>
              <option value="this_year" className="bg-[#18181b] text-white">This Year</option>
            </select>

            {canManageOnboarding && (
              <button
                type="button"
                onClick={() => setIsOnboardingOpen(true)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>🚀</span>
                <span>Setup Wizard</span>
              </button>
            )}
          </div>
        }
      />

      {/* Onboarding Banner (if setup is incomplete) */}
      {canManageOnboarding && onboardingStatus && (!onboardingStatus.isComplete || (onboardingStatus.completionPercentage ?? onboardingStatus.progressPercentage ?? 0) < 100) && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-900/30 via-purple-900/20 to-black/40 border border-indigo-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Setup ({onboardingStatus.completionPercentage ?? onboardingStatus.progressPercentage ?? 0}% Complete)
              </span>
              <span className="text-xs text-white/50">
                Next: {onboardingStatus.nextStepTitle || onboardingStatus.currentStep}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white">
              Complete your ledger configuration to unlock automated aging analytics
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setIsOnboardingOpen(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-lg shadow-indigo-900/40 shrink-0 cursor-pointer"
          >
            Continue Setup Wizard →
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          ⚠️ Could not load dashboard data: {error}
        </div>
      )}

      {/* ── KPI Row: Core Financial Metrics ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard
              label="Total Receivables"
              value={fmt(data?.totalReceivables ?? 0)}
              subtext={
                data?.totalReceivables === 0 && (data?.totalBilled ?? 0) > 0
                  ? `100% collected (${fmt(data?.totalCollected ?? 0)} settled)`
                  : 'Calculated outstanding balance'
              }
              icon="📈"
              color="var(--primary, #6366f1)"
            />
            <StatCard
              label="Overdue Amount"
              value={fmt(data?.overdueAmount ?? 0)}
              subtext={`${data?.overdueCustomerCount ?? 0} customer(s) overdue`}
              icon="⚠️"
              color="var(--danger, #ef4444)"
            />
            <StatCard
              label="Payments Received"
              value={fmt(data?.totalCollected ?? 0)}
              subtext={`${data?.openInvoiceCount ?? 0} invoices pending`}
              icon="✅"
              color="var(--accent, #10b981)"
            />
            <StatCard
              label="Collection Performance"
              value={`${data?.collectionRate ?? 0}%`}
              subtext={
                data?.totalBilled
                  ? `${fmt(data?.totalCollected ?? 0)} of ${fmt(data?.totalBilled ?? 0)} billed`
                  : 'Settled vs Total Billed'
              }
              icon="📊"
              color="var(--warning, #f59e0b)"
            />
          </>
        )}
      </div>

      {/* ── Aging Breakdown ────────────────────────────────────────────────── */}
      {data?.agingBreakdown && (
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📊</span>
                <span>Receivables Aging Breakdown</span>
              </h2>
              <p className="text-xs text-white/50">
                Distribution of outstanding invoices across maturity horizons.
              </p>
            </div>
            <div className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 self-start sm:self-auto">
              Total Overdue: {fmt(data.agingBreakdown.thresholdOverdueAmount ?? data.overdueAmount ?? 0)}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
              <div className="text-white/50 text-[11px]">Current (0 - 30 Days)</div>
              <div className="text-base font-bold text-emerald-400">{fmt(data.agingBreakdown.d0_30)}</div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-400 h-full rounded-full"
                  style={{ width: `${Math.min(100, (data.agingBreakdown.d0_30 / (data.totalReceivables || 1)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
              <div className="text-white/50 text-[11px]">31 - 60 Days Overdue</div>
              <div className="text-base font-bold text-amber-400">{fmt(data.agingBreakdown.d31_60)}</div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-amber-400 h-full rounded-full"
                  style={{ width: `${Math.min(100, (data.agingBreakdown.d31_60 / (data.totalReceivables || 1)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
              <div className="text-white/50 text-[11px]">61 - 90 Days Overdue</div>
              <div className="text-base font-bold text-orange-400">{fmt(data.agingBreakdown.d61_90)}</div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-orange-400 h-full rounded-full"
                  style={{ width: `${Math.min(100, (data.agingBreakdown.d61_90 / (data.totalReceivables || 1)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
              <div className="text-white/50 text-[11px]">90+ Days (Critical)</div>
              <div className="text-base font-bold text-rose-400">{fmt(data.agingBreakdown.d90plus)}</div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-rose-400 h-full rounded-full"
                  style={{ width: `${Math.min(100, (data.agingBreakdown.d90plus / (data.totalReceivables || 1)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Operational Grid: Priorities & Promises ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collection Priorities */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>🎯</span>
              <span>Important Collection Actions</span>
            </h2>
            <Link to="/invoices?status=OVERDUE" className="text-[11px] text-indigo-400 hover:underline">
              View All Invoices →
            </Link>
          </div>

          {!data?.collectionPriorities?.length ? (
            <div className="p-8 text-center text-xs text-white/50">
              🎉 No overdue collection priorities found. All accounts in good standing.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 text-white/40 uppercase">
                  <tr>
                    <th className="py-2">Customer</th>
                    <th className="py-2">Overdue</th>
                    <th className="py-2">Aging</th>
                    <th className="py-2">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.collectionPriorities.map((item, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 font-medium text-white">{item.customerName}</td>
                      <td className="py-2.5 text-rose-300 font-semibold">{fmt(item.overdueAmount)}</td>
                      <td className="py-2.5 text-white/60">{item.daysOverdue}d</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300">
                          {item.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Promises to Pay & Callbacks */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>🤝</span>
              <span>Customer Payment Promises (PTP)</span>
            </h2>
            <Link to="/reminders?tab=calls" className="text-[11px] text-indigo-400 hover:underline">
              Call Logs →
            </Link>
          </div>

          {!data?.promisesToPay?.length ? (
            <div className="p-8 text-center text-xs text-white/50">
              No active payment promises logged yet. Record customer commitments through calls or follow-ups.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 text-white/40 uppercase">
                  <tr>
                    <th className="py-2">Customer &amp; Inv</th>
                    <th className="py-2">Promised</th>
                    <th className="py-2">Target Date</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.promisesToPay.map((ptp) => (
                    <tr key={ptp.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5">
                        <div className="font-medium text-white">{ptp.customerName}</div>
                        <div className="text-[10px] text-white/40">{ptp.invoiceNumber}</div>
                      </td>
                      <td className="py-2.5 text-emerald-400 font-semibold">{fmt(ptp.promisedAmount)}</td>
                      <td className="py-2.5 text-white/60">
                        {new Date(ptp.promisedDate).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300">
                          {ptp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Financial Activity: Invoices Overview & Recent Payments ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outstanding Overdue Invoices */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>🧾</span>
              <span>Outstanding Invoice Overview</span>
            </h2>
            <Link to="/invoices" className="text-xs text-indigo-400 hover:underline">
              All Invoices →
            </Link>
          </div>

          {!data?.recentOverdueInvoices?.length ? (
            <div className="px-5 py-8 text-center text-xs text-white/50">
              🎉 No overdue invoices currently outstanding!
            </div>
          ) : (
            <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
              {data.recentOverdueInvoices.map((inv) => (
                <div key={inv.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                  <div className="w-2 h-2 rounded-full shrink-0 bg-rose-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white font-medium truncate">{inv.customerName}</div>
                    <div className="text-[11px] mt-0.5 text-white/50">
                      {inv.number} · <span className="text-rose-300 font-semibold">{fmt(inv.outstanding)}</span> overdue · {inv.daysOverdue}d past due
                    </div>
                  </div>
                  <div className="text-[11px] text-white/40 shrink-0">{timeAgo(inv.dueDate)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Payment Settlements */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>💳</span>
              <span>Recent Settlements &amp; Activity</span>
            </h2>
            <Link to="/payments" className="text-xs text-indigo-400 hover:underline">
              All Payments →
            </Link>
          </div>

          {!data?.recentPayments?.length ? (
            <div className="p-8 text-center text-xs text-white/50">
              No recent payments recorded in this period.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 text-white/40 uppercase bg-white/[0.01]">
                  <tr>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Invoice #</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 font-medium text-white">{p.customerName}</td>
                      <td className="px-5 py-3 font-mono text-white/60">{p.invoiceNumber}</td>
                      <td className="px-5 py-3 text-emerald-400 font-semibold">{fmt(p.amount)}</td>
                      <td className="px-5 py-3 text-white/50">{new Date(p.paymentDate).toLocaleDateString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Setup Wizard Modal for Admins/Managers */}
      {canManageOnboarding && (
        <OnboardingWizardModal
          isOpen={isOnboardingOpen}
          onClose={() => {
            setIsOnboardingOpen(false)
            setRefreshKey((k) => k + 1)
            onboardingApi.getStatus().then((st) => setOnboardingStatus(st)).catch(console.warn)
          }}
          onComplete={() => {
            setIsOnboardingOpen(false)
            setRefreshKey((k) => k + 1)
            onboardingApi.getStatus().then((st) => setOnboardingStatus(st)).catch(console.warn)
          }}
        />
      )}
    </div>
  )
}
