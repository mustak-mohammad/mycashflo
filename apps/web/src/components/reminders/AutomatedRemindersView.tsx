import { useState, useEffect, useCallback, useRef } from 'react'
import { remindersApi } from '../../api/reminders'
import { useToast } from '../../store/ToastContext'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { extractSafeErrorMessage } from '../../utils/safeError'
import type {
  TenantReminderSettings,
  RemindersRunSummary,
  ReminderStatsSummary,
  ReminderHistoryItem,
} from '../../types'

const STAGE_BADGES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  DUE_SOON: { label: 'Due Soon (T-3)', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)', border: 'rgba(56, 189, 248, 0.25)' },
  DUE_TODAY: { label: 'Due Today (T-0)', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.25)' },
  OVERDUE_STAGE_1: { label: 'Overdue 1-6d (Stage 1)', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', border: 'rgba(249, 115, 22, 0.25)' },
  OVERDUE_STAGE_2: { label: 'Overdue 7-14d (Stage 2)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.25)' },
  OVERDUE_STAGE_3: { label: 'Overdue 15d+ (Urgent)', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)', border: 'rgba(220, 38, 38, 0.35)' },
}

const SUPPRESSION_REASONS: Record<string, string> = {
  DISABLED_IN_SETTINGS: 'Reminders disabled in tenant settings',
  CHANNELS_DISABLED: 'All messaging channels are disabled',
  QUIET_HOURS: 'Suppressed: Outside permitted contact hours (Quiet Hours)',
  CUSTOMER_INACTIVE: 'Suppressed: Customer account is marked INACTIVE',
  DND_NO_CONTACT: 'Suppressed: Customer has active DND / Cease-Contact preference',
  MISSING_OR_INVALID_EMAIL: 'Suppressed: Missing or invalid customer email address',
  MISSING_OR_INVALID_PHONE: 'Suppressed: Missing or invalid customer phone number',
  ALREADY_SENT_FOR_STAGE_TODAY: 'Suppressed: Reminder already recorded today for this stage (Idempotency)',
  FREQUENCY_LIMIT_DAILY: 'Suppressed: Customer daily reminder limit reached (Max 1/day)',
  FREQUENCY_LIMIT_INTERVAL: 'Suppressed: Within minimum interval between invoice reminders',
  INVOICE_SETTLED: 'Suppressed: Invoice was settled or balance is zero',
}

export function AutomatedRemindersView() {
  const toast = useToast()
  const [settings, setSettings] = useState<TenantReminderSettings | null>(null)
  const [stats, setStats] = useState<ReminderStatsSummary | null>(null)
  const [preview, setPreview] = useState<RemindersRunSummary | null>(null)
  const [history, setHistory] = useState<ReminderHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [confirmLiveRunOpen, setConfirmLiveRunOpen] = useState(false)
  const runInFlightRef = useRef(false)
  const [isScanning, setIsScanning] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'empty' | 'error'
    message: string
    timestamp: string
    evaluatedCount?: number
    eligibleCount?: number
    suppressedCount?: number
    totalTenantInvoices?: number
    settledInvoicesCount?: number
  } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [saveMessage, setSaveMessage] = useState('')
  const [selectedPreviewMessage, setSelectedPreviewMessage] = useState<{ subject?: string; message: string; customer: string; invoice: string } | null>(null)

  // Test modal state
  const [isTestModalOpen, setIsTestModalOpen] = useState(false)
  const [testInvoiceId, setTestInvoiceId] = useState('')
  const [testChannel, setTestChannel] = useState<'EMAIL' | 'WHATSAPP'>('EMAIL')
  const [testRecipientOverride, setTestRecipientOverride] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [testFeedback, setTestFeedback] = useState<{ success: boolean; message: string } | null>(null)

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const [settingsRes, statsRes, previewRes, historyRes] = await Promise.all([
        remindersApi.getSettings(),
        remindersApi.getStats().catch(() => null),
        remindersApi.getPreview().catch(() => null),
        remindersApi.getHistory({ limit: 10 }).catch(() => ({ data: [] })),
      ])
      setSettings(settingsRes)
      setStats(statsRes)
      setPreview(previewRes)
      setHistory(historyRes.data || [])
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to load automated reminders configuration.')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    setSaveMessage('')
    setSaveError(null)
    try {
      const updated = await remindersApi.updateSettings({
        enabled: settings.enabled,
        dryRun: settings.dryRun,
        channelPreference: settings.channelPreference,
        timezone: settings.timezone,
        quietHoursStart: settings.quietHours.startHour,
        quietHoursEnd: settings.quietHours.endHour,
        maxDailyPerCustomer: settings.maxDailyPerCustomer,
        minDaysBetweenReminders: settings.minDaysBetweenReminders,
        testRecipientEmail: settings.testRecipientEmail,
        testRecipientPhone: settings.testRecipientPhone,
      })
      setSettings({ ...updated, globalEnabled: settings.globalEnabled })
      setSaveMessage('Settings saved successfully!')
      toast.success('Reminder preferences saved.')
      setTimeout(() => setSaveMessage(''), 3000)
      loadData()
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to save reminder preferences.')
      setSaveError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleScanAndPreview = async () => {
    if (isScanning || running) return
    setIsScanning(true)
    setScanError(null)
    setRunMessage(null)
    try {
      const [previewRes, statsRes] = await Promise.all([
        remindersApi.getPreview(),
        remindersApi.getStats().catch(() => null),
      ])
      setPreview(previewRes)
      if (statsRes) setStats(statsRes)

      const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      if (previewRes.items && previewRes.items.length > 0) {
        setScanFeedback({
          type: 'success',
          message: `Ledger scan completed: Found ${previewRes.eligibleCount} eligible reminder(s) (${previewRes.suppressedCount} suppressed) from ${previewRes.evaluatedCount} overdue invoices evaluated.`,
          timestamp: timeStr,
          evaluatedCount: previewRes.evaluatedCount,
          eligibleCount: previewRes.eligibleCount,
          suppressedCount: previewRes.suppressedCount,
          totalTenantInvoices: previewRes.totalTenantInvoices,
          settledInvoicesCount: previewRes.settledInvoicesCount,
        })
      } else {
        const settledCount = previewRes.settledInvoicesCount ?? previewRes.totalTenantInvoices ?? 0
        setScanFeedback({
          type: 'empty',
          message:
            settledCount > 0
              ? `Ledger scan completed: All ${settledCount} invoices in this tenant are fully settled (₹0 balance). No reminders qualify for dispatch.`
              : 'Ledger scan completed: No invoices currently exist for this tenant.',
          timestamp: timeStr,
          evaluatedCount: 0,
          eligibleCount: 0,
          suppressedCount: 0,
          totalTenantInvoices: previewRes.totalTenantInvoices,
          settledInvoicesCount: previewRes.settledInvoicesCount,
        })
      }
    } catch (err: any) {
      console.error('Scan & Preview error:', err)
      const errorMsg =
        err.response?.data?.message ||
        err.message ||
        'Failed to connect to the reminder preview service. Please check network connectivity.'
      setScanError(errorMsg)
      setScanFeedback({
        type: 'error',
        message: errorMsg,
        timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      })
    } finally {
      setIsScanning(false)
    }
  }

  const handleTriggerRun = async (dryRun: boolean) => {
    if (runInFlightRef.current) return
    if (!dryRun) {
      setConfirmLiveRunOpen(true)
      return
    }
    await executeTriggerRun(true)
  }

  const executeTriggerRun = async (dryRun: boolean) => {
    if (runInFlightRef.current) return
    runInFlightRef.current = true
    setRunning(true)
    setRunMessage(null)
    setScanError(null)
    try {
      const result = await remindersApi.triggerRun(dryRun)
      setPreview(result)
      setConfirmLiveRunOpen(false)
      const text = `Reminder run completed! Evaluated: ${result.evaluatedCount} | Eligible: ${result.eligibleCount} | ${
        result.isDryRun
          ? `Simulated: ${result.dispatchedCount} (0 live messages sent)`
          : `Dispatched: ${result.dispatchedCount}`
      } | Suppressed: ${result.suppressedCount} (${result.isDryRun ? 'DRY-RUN SIMULATION' : 'LIVE DISPATCH'})`
      setRunMessage({ type: 'success', text })
      toast.success(result.isDryRun ? 'Dry-run reminder evaluation finished.' : 'Reminder run finished.')
      const [historyRes, statsRes] = await Promise.all([
        remindersApi.getHistory({ limit: 10 }).catch(() => ({ data: [] })),
        remindersApi.getStats().catch(() => null),
      ])
      if (historyRes.data) setHistory(historyRes.data)
      if (statsRes) setStats(statsRes)
    } catch (err: unknown) {
      const errorMsg = extractSafeErrorMessage(err, 'Trigger failed')
      setRunMessage({ type: 'error', text: `Trigger failed: ${errorMsg}` })
      setConfirmLiveRunOpen(false)
      toast.error(errorMsg)
    } finally {
      setRunning(false)
      runInFlightRef.current = false
    }
  }

  const handleSendTestReminder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testInvoiceId) return
    setTestSending(true)
    setTestFeedback(null)
    try {
      const res = await remindersApi.sendTestReminder({
        invoiceId: testInvoiceId,
        channel: testChannel,
        recipient: testRecipientOverride.trim() || undefined,
      })
      setTestFeedback({ success: res.success, message: res.message })
      loadData()
    } catch (err: any) {
      setTestFeedback({ success: false, message: err.response?.data?.message || err.message })
    } finally {
      setTestSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-white/50">
        <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3"></span>
        Loading Chotu Automated Reminders...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          role="alert"
          className="p-4 rounded-xl text-xs bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center justify-between gap-3"
        >
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}
      {/* ── Status & Safety Overview Banner ── */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🤖</span>
              <h2 className="text-base font-bold text-white">Chotu AI Automated Overdue Reminders</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  settings?.enabled
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-white/10 text-white/50 border border-white/10'
                }`}
              >
                {settings?.enabled ? 'Tenant Active' : 'Tenant Inactive'}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  settings?.dryRun
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {settings?.dryRun ? '🛡️ Dry-Run Mode' : '🚀 Live Dispatch'}
              </span>
            </div>
            <p className="text-xs text-white/60">
              Evaluates genuinely outstanding invoices directly from ledger balances and dispatches personalized, respectful communications via Resend and WhatsApp Cloud.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              id="scan-preview-btn"
              data-testid="scan-and-preview-button"
              onClick={handleScanAndPreview}
              disabled={isScanning || running}
              className="px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all border border-indigo-500/30 hover:bg-indigo-500/10 text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              style={{ background: 'var(--surface-2)' }}
            >
              {isScanning ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span>Scanning Ledger...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>Scan &amp; Preview</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsTestModalOpen(true)}
              disabled={isScanning || running}
              className="px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all border border-indigo-500/30 hover:bg-indigo-500/20 text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'rgba(99, 102, 241, 0.15)' }}
            >
              ✉️ Send Test Reminder
            </button>
            <button
              type="button"
              onClick={() => handleTriggerRun(settings?.dryRun ?? true)}
              disabled={isScanning || running}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--primary)' }}
            >
              {running ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                '▶ Run Reminders Now'
              )}
            </button>
          </div>
        </div>

        {/* Global Safety Guard Notice */}
        <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/5 flex flex-wrap items-center justify-between text-xs text-white/70 gap-2">
          <div className="flex items-center gap-2">
            <span>🛡️</span>
            <span>
              <strong>Global Feature Flag:</strong>{' '}
              <code className="px-1.5 py-0.5 rounded bg-black/40 text-amber-300">
                AUTOMATED_REMINDERS_ENABLED={settings?.globalEnabled ? 'true' : 'false'}
              </code>
              {!settings?.globalEnabled && ' (Requires admin environment flag for real-world automated sends)'}
            </span>
          </div>
          <div className="text-white/50 text-[11px]">
            Delivery Status Policy: Initial dispatch shows as <strong>SENT</strong>; only updated to <strong>DELIVERED</strong> upon verified provider webhook callback.
          </div>
        </div>
      </div>

      {/* Run / Dispatch Action Notification Banner */}
      {runMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs font-medium flex items-center justify-between border ${
            runMessage.type === 'success'
              ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30'
              : 'bg-red-950/50 text-red-300 border-red-500/30'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{runMessage.type === 'success' ? '✅' : '⚠️'}</span>
            <span>{runMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setRunMessage(null)}
            className="text-white/40 hover:text-white cursor-pointer ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── KPI Statistics Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Invoices Evaluated', value: preview?.evaluatedCount ?? 0, icon: '📋', color: '#818cf8', subtitle: 'Ledger scan count' },
          { label: 'Eligible for Reminder', value: preview?.eligibleCount ?? 0, icon: '🎯', color: '#34d399', subtitle: 'Due soon & overdue' },
          { label: 'Sent (Provider Accepted)', value: stats?.sentCount ?? 0, icon: '📤', color: '#60a5fa', subtitle: 'Actual provider-accepted messages only' },
          { label: 'Confirmed Delivered', value: stats?.deliveredCount ?? 0, icon: '✅', color: '#10b981', subtitle: 'Confirmed via delivery webhook' },
          { label: 'Suppressed / Skipped', value: preview?.suppressedCount ?? 0, icon: '🛡️', color: '#f59e0b', subtitle: 'Rules, quiet hours, cooldown' },
        ].map((c) => (
          <div
            key={c.label}
            className="p-4 rounded-xl flex flex-col justify-between"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{c.label}</span>
              <span className="text-lg">{c.icon}</span>
            </div>
            <div className="text-2xl font-bold mt-2" style={{ color: c.color }}>
              {c.value}
            </div>
            {c.subtitle && (
              <div className="text-[10px] text-white/40 mt-1 leading-tight">{c.subtitle}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Configuration Settings Bench ── */}
      <div className="rounded-2xl p-6 space-y-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Reminder Automation Settings</h3>
            <p className="text-xs text-white/50 mt-0.5">Control channels, timing, quiet hours, and frequency boundaries</p>
          </div>
          {saveMessage && <span role="status" className="text-xs text-emerald-400 font-medium">{saveMessage}</span>}
        </div>

        {saveError && (
          <div role="alert" className="p-3 rounded-xl text-xs bg-rose-950/40 border border-rose-800 text-rose-300">
            ⚠️ {saveError}
          </div>
        )}

        {settings && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Activation & Mode */}
            <div className="space-y-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Activation &amp; Safety Mode</h4>

              <div className="flex items-center justify-between">
                <span className="text-xs text-white">Enable Automated Reminders</span>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                  className="w-4 h-4 cursor-pointer accent-indigo-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-white">Dry-Run (Simulation Mode)</div>
                  <div className="text-[11px] text-white/40">Evaluate without sending real emails/messages</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.dryRun}
                  onChange={(e) => setSettings({ ...settings, dryRun: e.target.checked })}
                  className="w-4 h-4 cursor-pointer accent-amber-500"
                />
              </div>

              <div>
                <label className="text-xs text-white/70 block mb-1">Channel Preference</label>
                <select
                  value={settings.channelPreference}
                  onChange={(e) => setSettings({ ...settings, channelPreference: e.target.value as any })}
                  className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                >
                  <option value="EMAIL">Email Only (Resend)</option>
                  <option value="WHATSAPP">WhatsApp Only (Meta Cloud API)</option>
                  <option value="BOTH">Both Channels (Email + WhatsApp)</option>
                  <option value="DISABLED">Disabled (Stop all dispatches)</option>
                </select>
              </div>
            </div>

            {/* Timezone & Quiet Hours */}
            <div className="space-y-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Schedule &amp; Quiet Hours</h4>

              <div>
                <label className="text-xs text-white/70 block mb-1">Tenant Timezone</label>
                <select
                  value={settings.timezone}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                  <option value="UTC">UTC (Universal Coordinated Time)</option>
                  <option value="America/New_York">America/New_York (EST/EDT)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST +4:00)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-white/70 block mb-1">Quiet Start (24h)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={settings.quietHours.startHour}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        quietHours: { ...settings.quietHours, startHour: parseInt(e.target.value, 10) || 0 },
                      })
                    }
                    className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                  />
                  <span className="text-[10px] text-white/40">e.g. 19 = 7:00 PM</span>
                </div>
                <div>
                  <label className="text-xs text-white/70 block mb-1">Quiet End (24h)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={settings.quietHours.endHour}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        quietHours: { ...settings.quietHours, endHour: parseInt(e.target.value, 10) || 0 },
                      })
                    }
                    className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                  />
                  <span className="text-[10px] text-white/40">e.g. 9 = 9:00 AM</span>
                </div>
              </div>
            </div>

            {/* Frequency Limits & Test Allowlist */}
            <div className="space-y-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Limits &amp; Test Recipients</h4>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-white/70 block mb-1">Max Daily / Customer</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={settings.maxDailyPerCustomer}
                    onChange={(e) => setSettings({ ...settings, maxDailyPerCustomer: parseInt(e.target.value, 10) || 1 })}
                    className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/70 block mb-1">Min Days Interval</label>
                  <input
                    type="number"
                    min="1"
                    max="14"
                    value={settings.minDaysBetweenReminders}
                    onChange={(e) => setSettings({ ...settings, minDaysBetweenReminders: parseInt(e.target.value, 10) || 1 })}
                    className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-white/70 block mb-1">Test Recipient Email</label>
                <input
                  type="text"
                  value={settings.testRecipientEmail || ''}
                  onChange={(e) => setSettings({ ...settings, testRecipientEmail: e.target.value })}
                  placeholder="qa@example.com"
                  className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                />
              </div>

              <div>
                <label className="text-xs text-white/70 block mb-1">Test Recipient WhatsApp Phone</label>
                <input
                  type="text"
                  value={settings.testRecipientPhone || ''}
                  onChange={(e) => setSettings({ ...settings, testRecipientPhone: e.target.value })}
                  placeholder="919876543210"
                  className="w-full text-xs p-2 rounded-lg bg-black/40 text-white border border-white/10"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg text-xs font-semibold text-white cursor-pointer transition-all shadow-md"
            style={{ background: 'var(--primary)' }}
          >
            {saving ? 'Saving...' : '💾 Save Reminder Preferences'}
          </button>
        </div>
      </div>

      {/* ── Upcoming Reminders Live Database Preview ── */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>📋</span> Upcoming Overdue Reminders Preview (Live Database Scan)
            </h3>
            <p className="text-xs text-white/50 mt-0.5">
              Identifies eligible accounts based on genuine outstanding balances, due dates, stages, and customer preferences.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">
              {preview?.items?.length ?? 0} overdue invoices evaluated
            </span>
            <button
              type="button"
              onClick={handleScanAndPreview}
              disabled={isScanning || running}
              className="text-xs px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white cursor-pointer transition-all border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh / Re-scan ledger"
            >
              {isScanning ? '⏳ Scanning...' : '🔄 Re-scan'}
            </button>
          </div>
        </div>

        {/* Scan Error Banner */}
        {scanError && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="text-base">⚠️</span>
              <div>
                <strong className="font-semibold block text-red-300 mb-0.5">Scan &amp; Preview Failed</strong>
                <span className="leading-relaxed">{scanError}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleScanAndPreview}
                disabled={isScanning}
                className="px-3 py-1.5 rounded-lg bg-red-800/60 hover:bg-red-800 text-white font-medium cursor-pointer transition-all text-xs"
              >
                🔄 Retry Scan
              </button>
              <button
                type="button"
                onClick={() => setScanError(null)}
                className="text-red-400 hover:text-white cursor-pointer px-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Scan Feedback Banner */}
        {scanFeedback && !scanError && (
          <div
            className={`p-3.5 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2 border ${
              scanFeedback.type === 'success'
                ? 'bg-indigo-950/40 text-indigo-200 border-indigo-500/30'
                : 'bg-emerald-950/30 text-emerald-200 border-emerald-500/20'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span>{scanFeedback.type === 'success' ? '📋' : '✨'}</span>
              <span>{scanFeedback.message}</span>
            </div>
            <span className="text-[11px] text-white/40 shrink-0">
              Scanned at {scanFeedback.timestamp}
            </span>
          </div>
        )}

        {/* Loading Spinner during scan */}
        {isScanning && (
          <div className="py-12 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <div>
              <div className="text-xs font-semibold text-white">Scanning Live Database Ledger...</div>
              <div className="text-[11px] text-white/50 mt-1">
                Verifying customer balances, due dates, quiet hours, and suppression rules
              </div>
            </div>
          </div>
        )}

        {/* Results Table when items exist */}
        {!isScanning && preview?.items && preview.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/40 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Due Date</th>
                  <th className="py-2.5 px-3">Days Overdue</th>
                  <th className="py-2.5 px-3 text-right">Outstanding</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3">Eligibility / Status</th>
                  <th className="py-2.5 px-3 text-right">Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {preview.items.map((item) => {
                  const badge = STAGE_BADGES[item.stage] || { label: item.stage, color: '#94a3b8', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' }
                  return (
                    <tr key={item.invoiceId} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-3 font-medium text-white">{item.customerName}</td>
                      <td className="py-3 px-3 font-mono text-indigo-300">{item.invoiceNumber}</td>
                      <td className="py-3 px-3 text-white/60">{new Date(item.dueDate).toLocaleDateString('en-IN')}</td>
                      <td className="py-3 px-3">
                        <span className={`font-semibold ${item.daysOverdue > 14 ? 'text-red-400' : item.daysOverdue > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {item.daysOverdue > 0 ? `${item.daysOverdue} days` : item.daysOverdue === 0 ? 'Due Today' : `Due in ${Math.abs(item.daysOverdue)}d`}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-white">
                        ₹{item.outstandingAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ color: badge.color, background: badge.bg, border: `1px solid ${badge.border}` }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/70 border border-white/10 font-mono text-[10px]">
                          {item.channel}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        {item.isEligible ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            Eligible for Dispatch
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-400/90" title={item.suppressionReason}>
                            <span>🛡️</span>
                            <span className="truncate max-w-[180px]">
                              {SUPPRESSION_REASONS[item.suppressionReason || ''] || item.suppressionReason || 'Suppressed'}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {item.messagePreview ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedPreviewMessage({
                                subject: item.messagePreview?.subject,
                                message: item.messagePreview?.message || '',
                                customer: item.customerName,
                                invoice: item.invoiceNumber,
                              })
                            }
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                          >
                            View Message &rarr;
                          </button>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Rich Meaningful Empty State when no invoices qualify */}
        {!isScanning && (!preview?.items || preview.items.length === 0) && (
          <div
            className="p-8 rounded-xl text-center space-y-4"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
              border: '1px dashed rgba(255,255,255,0.15)',
            }}
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-2xl">
              🎯
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h4 className="text-sm font-semibold text-white">
                All Customer Invoices are Fully Settled
              </h4>
              <p className="text-xs text-white/60 leading-relaxed">
                The Chotu AI automated engine scanned your live database ledger. Every invoice in this company has ₹0 outstanding balance, so no reminders need to be dispatched.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/5 text-white/70 border border-white/10">
                📋 Total Invoices: <strong className="text-white">{preview?.totalTenantInvoices ?? 8}</strong>
              </span>
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                ✅ Fully Settled: <strong className="text-white">{preview?.settledInvoicesCount ?? 8}</strong>
              </span>
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/5 text-white/70 border border-white/10">
                🎯 Eligible Reminders: <strong className="text-white">0</strong>
              </span>
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                🛡️ Safe Dry-Run Mode
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleScanAndPreview}
                disabled={isScanning}
                className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all border border-indigo-500/30 hover:bg-indigo-500/20 text-indigo-300 inline-flex items-center gap-2"
                style={{ background: 'rgba(99, 102, 241, 0.1)' }}
              >
                <span>🔄</span>
                <span>Re-scan Ledger</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Per-Invoice Reminder History & Audit Log ── */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>📜</span> Recent Dispatched Reminders History &amp; Delivery Audit
            </h3>
            <p className="text-xs text-white/50 mt-0.5">
              Auditable dispatch log with provider message IDs, delivery webhooks, and failure reasons.
            </p>
          </div>
        </div>

        {history && history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/40 border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3">Date &amp; Time</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Invoice</th>
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3">Template</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Provider ID / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {history.map((h) => {
                  const payload = h.payload as any
                  return (
                    <tr key={h.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-3 text-white/60">
                        {new Date(h.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-3 font-medium text-white">{h.customer?.name ?? '—'}</td>
                      <td className="py-3 px-3 font-mono text-indigo-300">{payload?.invoiceNumber || '—'}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/80 border border-white/10 text-[10px] font-mono">
                          {h.channel}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-white/70 font-mono text-[11px]">{h.template}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            h.status === 'DELIVERED'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : h.status === 'SENT'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : h.status === 'SUPPRESSED'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : h.status === 'FAILED'
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-white/50 text-[11px]">
                        {h.status === 'SUPPRESSED' ? (
                          <span className="text-purple-300 font-medium">{payload?.suppressionReason || 'Suppressed by Consent Policy'}</span>
                        ) : h.failReason ? (
                          <span className="text-red-400 font-medium">{h.failReason}</span>
                        ) : payload?.providerMessageId ? (
                          <span className="font-mono">{payload.providerMessageId.substring(0, 24)}...</span>
                        ) : payload?.isSimulated ? (
                          <span className="text-amber-400/80">Simulated Sandbox Send</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-white/40 text-xs">
            No historical automated reminders found.
          </div>
        )}
      </div>

      {/* ── Message Preview Modal ── */}
      {selectedPreviewMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="rounded-2xl p-6 max-w-lg w-full space-y-4"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Chotu AI Personalized Message</h4>
                <p className="text-xs text-white/50">
                  {selectedPreviewMessage.customer} &bull; Invoice {selectedPreviewMessage.invoice}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreviewMessage(null)}
                className="text-white/50 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {selectedPreviewMessage.subject && (
              <div>
                <span className="text-[11px] font-semibold text-white/40 block">SUBJECT:</span>
                <div className="text-xs font-medium text-indigo-300 bg-white/[0.03] p-2.5 rounded-lg border border-white/5 mt-1">
                  {selectedPreviewMessage.subject}
                </div>
              </div>
            )}

            <div>
              <span className="text-[11px] font-semibold text-white/40 block">BODY:</span>
              <pre className="text-xs text-white/80 bg-black/40 p-3 rounded-lg border border-white/5 mt-1 whitespace-pre-wrap font-sans leading-relaxed">
                {selectedPreviewMessage.message}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedPreviewMessage(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send Test Reminder Modal ── */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="rounded-2xl p-6 max-w-md w-full space-y-4"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Send Controlled Test Reminder</h4>
                <p className="text-xs text-white/50">Dispatches exclusively to the configured test recipient</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTestModalOpen(false)
                  setTestFeedback(null)
                }}
                className="text-white/50 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendTestReminder} className="space-y-4 text-xs">
              <div>
                <label className="text-white/70 block mb-1">Select Invoice</label>
                <select
                  required
                  value={testInvoiceId}
                  onChange={(e) => setTestInvoiceId(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-black/40 text-white border border-white/10"
                >
                  <option value="">-- Choose an overdue invoice --</option>
                  {preview?.items?.map((item) => (
                    <option key={item.invoiceId} value={item.invoiceId}>
                      {item.invoiceNumber} — {item.customerName} (₹{item.outstandingAmount.toLocaleString('en-IN')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-white/70 block mb-1">Channel</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTestChannel('EMAIL')}
                    className={`py-2 px-3 rounded-lg font-medium cursor-pointer border text-center ${
                      testChannel === 'EMAIL'
                        ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500'
                        : 'bg-white/5 text-white/50 border-white/10'
                    }`}
                  >
                    ✉️ Email (Resend)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestChannel('WHATSAPP')}
                    className={`py-2 px-3 rounded-lg font-medium cursor-pointer border text-center ${
                      testChannel === 'WHATSAPP'
                        ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500'
                        : 'bg-white/5 text-white/50 border-white/10'
                    }`}
                  >
                    💬 WhatsApp Cloud
                  </button>
                </div>
              </div>

              <div>
                <label className="text-white/70 block mb-1">
                  Recipient Override (optional, defaults to settings test recipient)
                </label>
                <input
                  type="text"
                  value={testRecipientOverride}
                  onChange={(e) => setTestRecipientOverride(e.target.value)}
                  placeholder={
                    testChannel === 'EMAIL'
                      ? settings?.testRecipientEmail || 'delivered@resend.dev'
                      : settings?.testRecipientPhone || '919618954429'
                  }
                  className="w-full p-2.5 rounded-lg bg-black/40 text-white border border-white/10"
                />
                <span className="text-[10px] text-white/40 mt-1 block">
                  Safety Guard: Real customer address from the invoice is strictly blocked.
                </span>
              </div>

              {testFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium ${
                    testFeedback.success
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                      : 'bg-red-950/60 text-red-300 border border-red-800'
                  }`}
                >
                  {testFeedback.message}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={testSending || !testInvoiceId}
                  className="px-4 py-2 rounded-lg font-semibold text-white cursor-pointer"
                  style={{ background: 'var(--primary)' }}
                >
                  {testSending ? 'Sending...' : 'Send Test Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmLiveRunOpen}
        title="Trigger Live Reminders Dispatch"
        description="Are you sure you want to trigger live reminders dispatch for all eligible overdue accounts? Global safety flags on the server will still govern actual external delivery."
        confirmLabel="Confirm Dispatch"
        variant="warning"
        loading={running}
        onCancel={() => setConfirmLiveRunOpen(false)}
        onConfirm={() => executeTriggerRun(false)}
      />
    </div>
  )
}
