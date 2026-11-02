import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../store/AuthContext'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { dashboardApi, type DashboardPreferences } from '../api/dashboard'
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

const DEFAULT_PREFERENCES: DashboardPreferences = {
  visibleWidgets: {
    totalReceivables: true,
    overdueAmount: true,
    agingBreakdown: true,
    overdueInvoiceCount: true,
    recentPayments: true,
    collectionPriorities: true,
    promisesToPay: true,
    pendingCallbacks: true,
    collectionRate: true,
    recentOverdueInvoices: true,
  },
  dateRange: 'all',
  agingThreshold: 30,
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [preferences, setPreferences] = useState<DashboardPreferences>(DEFAULT_PREFERENCES)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [prefSaveMsg, setPrefSaveMsg] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Fetch verified stats scoped with date filter and aging threshold
  const fetcher = useCallback(
    () =>
      dashboardApi.getStats({
        dateRange: preferences.dateRange,
        agingThreshold: preferences.agingThreshold,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences.dateRange, preferences.agingThreshold, refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  // Load saved preferences & onboarding status on mount
  useEffect(() => {
    dashboardApi
      .getPreferences()
      .then((saved) => {
        if (saved) {
          setPreferences({
            ...DEFAULT_PREFERENCES,
            ...saved,
            visibleWidgets: {
              ...DEFAULT_PREFERENCES.visibleWidgets,
              ...(saved.visibleWidgets || {}),
            },
          })
        }
      })
      .catch((err) => console.warn('Could not load dashboard preferences:', err))

    onboardingApi
      .getStatus()
      .then((st) => setOnboardingStatus(st))
      .catch((err) => console.warn('Could not load onboarding status:', err))
  }, [])

  // Save updated preferences to backend
  async function handleSavePreferences(newPrefs: DashboardPreferences) {
    setSavingPrefs(true)
    setPrefSaveMsg(null)
    try {
      await dashboardApi.savePreferences(newPrefs)
      setPreferences(newPrefs)
      setPrefSaveMsg('Preferences saved successfully.')
      setTimeout(() => setPrefSaveMsg(null), 3000)
    } catch (err: any) {
      setPrefSaveMsg('Failed to save preferences.')
    } finally {
      setSavingPrefs(false)
    }
  }

  const isWidgetVisible = (widgetKey: keyof DashboardPreferences['visibleWidgets']) => {
    return preferences.visibleWidgets[widgetKey] !== false
  }

  const toggleWidget = (widgetKey: keyof DashboardPreferences['visibleWidgets']) => {
    const updated: DashboardPreferences = {
      ...preferences,
      visibleWidgets: {
        ...preferences.visibleWidgets,
        [widgetKey]: !isWidgetVisible(widgetKey),
      },
    }
    handleSavePreferences(updated)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header with Quick Action Controls */}
      <PageHeader
        title={`Welcome back${user ? `, ${getDisplayName(user).split(' ')[0]}` : ''}! 👋`}
        subtitle="Here's your live collections overview and financial intelligence."
        action={
          <div className="flex items-center gap-2">
            {/* Quick Date Range Selector */}
            <select
              value={preferences.dateRange}
              onChange={(e) => {
                const updated = { ...preferences, dateRange: e.target.value }
                handleSavePreferences(updated)
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all" className="bg-[#18181b] text-white">All Time</option>
              <option value="30d" className="bg-[#18181b] text-white">Last 30 Days</option>
              <option value="90d" className="bg-[#18181b] text-white">Last 90 Days</option>
              <option value="this_month" className="bg-[#18181b] text-white">This Month</option>
              <option value="this_year" className="bg-[#18181b] text-white">This Year</option>
            </select>

            {/* Customize Dashboard Button */}
            <button
              type="button"
              onClick={() => setIsCustomizeOpen(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>⚙️</span>
              <span>Customize View</span>
            </button>

            {/* Onboarding Wizard Launcher */}
            <button
              type="button"
              onClick={() => setIsOnboardingOpen(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>🚀</span>
              <span>Setup Wizard</span>
            </button>
          </div>
        }
      />

      {/* Onboarding Progress Guide Banner (shows if setup is incomplete) */}
      {onboardingStatus && (!onboardingStatus.isComplete || (onboardingStatus.completionPercentage ?? onboardingStatus.progressPercentage ?? 0) < 100) && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-900/30 via-purple-900/20 to-black/40 border border-indigo-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Onboarding Setup ({onboardingStatus.completionPercentage ?? onboardingStatus.progressPercentage ?? 0}% Complete)
              </span>
              <span className="text-xs text-white/50">
                Next: {onboardingStatus.nextStepTitle || onboardingStatus.currentStep}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white">
              Complete your company setup and financial ledger import
            </h3>
            <p className="text-xs text-white/60">
              {onboardingStatus.missingSteps && onboardingStatus.missingSteps.length > 0 && (
                <span className="text-amber-300/80 font-medium mr-1">
                  Pending: {onboardingStatus.missingSteps.join(', ')}.
                </span>
              )}
              Import invoices, customers, and settlement records to unlock automated aging analytics and AI follow-ups.
            </p>
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
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          ⚠️ Could not load dashboard data: {error}
        </div>
      )}

      {/* ── KPI Row 1: Primary Receivables & Overdue ────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            {isWidgetVisible('totalReceivables') && (
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
            )}
            {isWidgetVisible('overdueAmount') && (
              <StatCard
                label="Overdue Amount"
                value={fmt(data?.overdueAmount ?? 0)}
                subtext={`${data?.overdueCustomerCount ?? 0} customer(s) overdue`}
                icon="⚠️"
                color="var(--danger, #ef4444)"
              />
            )}
            {isWidgetVisible('collectionRate') && (
              <StatCard
                label="Collection Rate"
                value={`${data?.collectionRate ?? 0}%`}
                subtext={
                  data?.totalBilled
                    ? `${fmt(data?.totalCollected ?? 0)} of ${fmt(data?.totalBilled ?? 0)}`
                    : 'Settled vs Total Billed'
                }
                icon="📊"
                color="var(--warning, #f59e0b)"
              />
            )}
            {isWidgetVisible('overdueInvoiceCount') && (
              <StatCard
                label="Overdue Invoices"
                value={data?.overdueInvoiceCount ?? 0}
                subtext={`Threshold: ${preferences.agingThreshold} days past due`}
                icon="🧾"
                color="var(--danger, #ef4444)"
              />
            )}
          </>
        )}
      </div>

      {/* ── KPI Row 2: Secondary Operational Counts ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard
              label="Overdue Customers"
              value={data?.overdueCustomerCount ?? 0}
              subtext="Requiring prioritized outreach"
              icon="👥"
              color="var(--danger, #ef4444)"
            />
            <StatCard
              label="Active Collection Cases"
              value={data?.openCaseCount ?? 0}
              subtext="Under management"
              icon="📋"
              color="var(--primary, #6366f1)"
            />
            <StatCard
              label="Open Invoices"
              value={data?.openInvoiceCount ?? 0}
              subtext="Pending payment"
              icon="💼"
              color="var(--warning, #f59e0b)"
            />
          </>
        )}
      </div>

      {/* ── Widget: Aging Breakdown ────────────────────────────────────────── */}
      {isWidgetVisible('agingBreakdown') && data?.agingBreakdown && (
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📊</span>
                <span>Aging Breakdown (Configurable Threshold: {preferences.agingThreshold} Days)</span>
              </h2>
              <p className="text-xs text-white/50">
                Verified bucket distribution of all unpaid invoices across maturity horizons.
              </p>
            </div>
            <div className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 self-start sm:self-auto">
              Total &gt;{preferences.agingThreshold}d: {fmt(data.agingBreakdown.thresholdOverdueAmount)}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {/* 0-30 Days */}
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

            {/* 31-60 Days */}
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

            {/* 61-90 Days */}
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

            {/* 90+ Days */}
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

      {/* ── Widget: Operational Lists Grid (Priorities & Promises) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collection Priorities */}
        {isWidgetVisible('collectionPriorities') && (
          <div
            className="rounded-2xl p-5 space-y-3"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>🎯</span>
                <span>Collection Priorities</span>
              </h2>
              <span className="text-[11px] text-white/40">{data?.collectionPriorities?.length ?? 0} High Priority</span>
            </div>

            {!data?.collectionPriorities?.length ? (
              <div className="p-8 text-center text-xs text-white/50">
                🎉 No high-priority collection targets found. All accounts in good standing.
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
        )}

        {/* Promises to Pay (PTP) */}
        {isWidgetVisible('promisesToPay') && (
          <div
            className="rounded-2xl p-5 space-y-3"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>🤝</span>
                <span>Active Promises-to-Pay (PTP)</span>
              </h2>
              <span className="text-[11px] text-white/40">{data?.promisesToPay?.length ?? 0} Commitments</span>
            </div>

            {!data?.promisesToPay?.length ? (
              <div className="p-8 text-center text-xs text-white/50">
                No active payment promises recorded yet. Use Chotu AI to log customer commitments.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-white/40 uppercase">
                    <tr>
                      <th className="py-2">Customer & Inv</th>
                      <th className="py-2">Promised Amount</th>
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
        )}
      </div>

      {/* ── Widget: Pending Callbacks & Internal Tasks ────────────────────── */}
      {isWidgetVisible('pendingCallbacks') && (
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>⏰</span>
              <span>Pending Callbacks & Follow-up Tasks</span>
            </h2>
            <span className="text-[11px] text-white/40">{data?.pendingCallbacks?.length ?? 0} Tasks</span>
          </div>

          {!data?.pendingCallbacks?.length ? (
            <div className="p-6 text-center text-xs text-white/50">
              No pending callbacks scheduled.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.pendingCallbacks.map((task) => (
                <div key={task.id} className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{task.customerName || 'General Task'}</span>
                    <span className="text-[10px] text-amber-400 font-semibold">{task.priority}</span>
                  </div>
                  <div className="text-white/80">{task.title}</div>
                  <div className="text-[10px] text-white/40">Due: {new Date(task.dueDate).toLocaleDateString('en-IN')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Widget: Recent Payments Feed ───────────────────────────────────── */}
      {isWidgetVisible('recentPayments') && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>💳</span>
              <span>Recent Settlements & Payments</span>
            </h2>
            <span className="text-xs text-white/40">{data?.recentPayments?.length ?? 0} transactions</span>
          </div>

          {!data?.recentPayments?.length ? (
            <div className="p-8 text-center text-xs text-white/50">
              No recent payments recorded. Use '+ Record Payment' on the Payments page to log settlements.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 text-white/40 uppercase bg-white/[0.01]">
                  <tr>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Invoice #</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3">Method</th>
                    <th className="px-5 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-medium text-white">{p.customerName}</td>
                      <td className="px-5 py-3 font-mono text-white/60">{p.invoiceNumber}</td>
                      <td className="px-5 py-3 text-emerald-400 font-semibold">{fmt(p.amount)}</td>
                      <td className="px-5 py-3 font-mono text-[11px] text-white/50">{p.reference}</td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-white/70">
                          {p.method}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/50">{new Date(p.paymentDate).toLocaleDateString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Widget: Overdue Invoices List ─────────────────────────────────── */}
      {isWidgetVisible('recentOverdueInvoices') && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
        >
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>⚠️</span>
              <span>Overdue Invoices List</span>
            </h2>
            <span className="text-xs text-white/40">{data?.recentOverdueInvoices?.length ?? 0} shown</span>
          </div>

          {!data?.recentOverdueInvoices?.length ? (
            <div className="px-5 py-8 text-center text-sm text-white/50">
              🎉 No overdue invoices right now!
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {data.recentOverdueInvoices.map((inv) => (
                <div key={inv.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-white/[0.02]">
                  <div className="w-2 h-2 rounded-full shrink-0 bg-rose-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{inv.customerName}</div>
                    <div className="text-xs mt-0.5 text-white/50">
                      {inv.number} · <span className="text-rose-300 font-semibold">{fmt(inv.outstanding)}</span> overdue · {inv.daysOverdue}d past due
                    </div>
                  </div>
                  <div className="text-xs text-white/40 shrink-0">{timeAgo(inv.dueDate)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modal / Drawer: Dashboard Customization & Filters ─────────────── */}
      {isCustomizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <div>
                <h3 className="text-sm font-semibold text-white">Customize Dashboard View</h3>
                <p className="text-xs text-white/50">Preferences are saved per-tenant and restored across sessions.</p>
              </div>
              <button
                onClick={() => setIsCustomizeOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs overflow-y-auto max-h-[75vh]">
              {prefSaveMsg && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                  {prefSaveMsg}
                </div>
              )}

              {/* Configurable Filters */}
              <div className="space-y-3">
                <h4 className="text-white font-medium text-xs uppercase tracking-wider text-indigo-300">
                  Filters & Thresholds
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-white/70 mb-1">Date Range Filter</label>
                    <select
                      value={preferences.dateRange}
                      onChange={(e) =>
                        setPreferences({ ...preferences, dateRange: e.target.value })
                      }
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="all">All Time</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="90d">Last 90 Days</option>
                      <option value="this_month">This Month</option>
                      <option value="this_year">This Year</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-white/70 mb-1">Aging Threshold (Days)</label>
                    <select
                      value={preferences.agingThreshold}
                      onChange={(e) =>
                        setPreferences({ ...preferences, agingThreshold: Number(e.target.value) })
                      }
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value={15}>15 Days Overdue</option>
                      <option value={30}>30 Days Overdue</option>
                      <option value={45}>45 Days Overdue</option>
                      <option value={60}>60 Days Overdue</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Widget Visibility Toggles */}
              <div className="space-y-3">
                <h4 className="text-white font-medium text-xs uppercase tracking-wider text-indigo-300">
                  Visible Widgets
                </h4>
                <div className="space-y-2">
                  {[
                    { key: 'totalReceivables', label: 'Total Outstanding Balance Card' },
                    { key: 'overdueAmount', label: 'Total Overdue Amount Card' },
                    { key: 'agingBreakdown', label: 'Aging Breakdown (0-30, 31-60, 61-90, 90+ days)' },
                    { key: 'overdueInvoiceCount', label: 'Overdue Invoices Count Card' },
                    { key: 'recentPayments', label: 'Recent Settlements & Payments Table' },
                    { key: 'collectionPriorities', label: 'High Priority Collection Targets' },
                    { key: 'promisesToPay', label: 'Promises-to-Pay (PTP) Commitments' },
                    { key: 'pendingCallbacks', label: 'Pending Callbacks & Follow-up Tasks' },
                    { key: 'collectionRate', label: 'Collection Rate KPI' },
                    { key: 'recentOverdueInvoices', label: 'Recent Overdue Invoices List' },
                  ].map((w) => (
                    <label
                      key={w.key}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] cursor-pointer"
                    >
                      <span className="text-white/80">{w.label}</span>
                      <input
                        type="checkbox"
                        checked={isWidgetVisible(w.key as any)}
                        onChange={() => toggleWidget(w.key as any)}
                        className="rounded accent-indigo-600 w-4 h-4 cursor-pointer"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 flex justify-end gap-2 bg-white/[0.01]">
              <button
                type="button"
                onClick={() => setIsCustomizeOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSavePreferences(preferences)
                  setIsCustomizeOpen(false)
                }}
                disabled={savingPrefs}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/30"
              >
                {savingPrefs ? 'Saving…' : 'Save Preferences'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Wizard Modal ────────────────────────────────────────── */}
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
    </div>
  )
}
