import { useState, useEffect } from 'react'
import { getPlatformSettings, type PlatformSettings } from '../../api/platform'
import { useAuth } from '../../store/AuthContext'
import { authApi } from '../../api/auth'

export default function SystemSettingsPage() {
  const { user, updateUser } = useAuth()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Profile Edit State
  const [displayName, setDisplayName] = useState(user?.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null)
  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null)

  // Sync display name state with auth user if changed externally
  useEffect(() => {
    if (user?.name) {
      setDisplayName(user.name)
    }
  }, [user?.name])

  const loadSettings = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPlatformSettings()
      setSettings(data)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load platform settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileSuccessMsg(null)
    setProfileErrorMsg(null)

    const trimmed = displayName.trim()
    if (!trimmed) {
      setProfileErrorMsg('Display name cannot be empty')
      return
    }

    setSavingProfile(true)
    try {
      const updated = await authApi.updateProfile(trimmed)
      updateUser({ name: updated.name || trimmed })
      setProfileSuccessMsg('Profile display name updated successfully.')
      setIsEditingName(false)
      setTimeout(() => setProfileSuccessMsg(null), 4000)
    } catch (err: any) {
      setProfileErrorMsg(err?.response?.data?.message || err?.message || 'Failed to update profile name')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleCancelEdit = () => {
    setDisplayName(user?.name || '')
    setIsEditingName(false)
    setProfileErrorMsg(null)
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-slate-400">Loading settings...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs">
          <div className="font-semibold text-sm mb-1">Error Loading Settings</div>
          <p className="mb-3 text-rose-300">{error}</p>
          <button
            onClick={() => loadSettings()}
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Settings
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Super Admin profile and platform configuration posture.
          </p>
        </div>

        <button
          onClick={() => loadSettings()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <span>🔄</span> Refresh Status
        </button>
      </div>

      {/* ─── Card 0: My Profile (Top Priority) ─────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-[#111927] p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-600 to-sky-800 text-white font-bold flex items-center justify-center text-lg shadow-md border border-sky-400/20">
              {user?.name ? user.name.charAt(0).toUpperCase() : 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">My Profile</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-sky-950/80 text-sky-300 border border-sky-800">
                  {user?.role || 'SUPER_ADMIN'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  Active
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Authenticated Super Admin session & identity credentials.
              </p>
            </div>
          </div>

          {!isEditingName && (
            <button
              onClick={() => setIsEditingName(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-sky-700/60 bg-sky-950/50 hover:bg-sky-900/60 text-sky-200 transition-colors cursor-pointer self-start sm:self-auto flex items-center gap-1.5"
            >
              <span>✏️</span> Edit Display Name
            </button>
          )}
        </div>

        {/* Profile Success / Error Feedback */}
        {profileSuccessMsg && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2">
            <span>✅</span> {profileSuccessMsg}
          </div>
        )}
        {profileErrorMsg && (
          <div className="mt-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
            <span>⚠️</span> {profileErrorMsg}
          </div>
        )}

        {/* Profile Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5 text-xs">
          {/* Left Column: Name & Email */}
          <div className="space-y-4">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                Display Name
              </label>
              {isEditingName ? (
                <form onSubmit={handleSaveProfile} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter full name"
                    disabled={savingProfile}
                    className="flex-1 px-3 py-1.5 bg-slate-900 border border-sky-600 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium cursor-pointer disabled:opacity-50"
                  >
                    {savingProfile ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={savingProfile}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="text-slate-100 font-medium text-sm flex items-center gap-2">
                  <span>{user?.name || 'Super Administrator'}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1">
                Email Address
              </label>
              <div className="text-slate-300 font-mono text-xs flex items-center gap-1.5">
                <span>{user?.email || 'superadmin@mycashflo.internal'}</span>
                <span className="text-[10px] text-slate-500">(Primary Login)</span>
              </div>
            </div>
          </div>

          {/* Right Column: Platform Authority & Password Security */}
          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1">
                Security Posture
              </label>
              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2 text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Platform Scope</span>
                  <span className="font-semibold text-sky-300">Global (Multi-tenant)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Role Classification</span>
                  <span className="font-semibold text-slate-200">System Super Administrator</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2">
              <span className="text-amber-400 text-sm mt-0.5">🔒</span>
              <div>
                <span className="font-semibold text-slate-300 block mb-0.5">Password Policy</span>
                Self-service password alteration is disabled for Super Admin platform accounts. Credential rotation is managed securely via owner console bootstrap (<code className="text-slate-300 font-mono">npm run super-admin:bootstrap</code>).
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Platform Posture Cards (4 Distinct Sections) ────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
        {/* Section 1: Security & Platform Policies */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 mb-3">
              <span className="text-sm">🛡️</span>
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Security & Platform Policies
              </h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Security protections</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  Enforced
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Tenant isolation</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  Enforced
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Automated reminders</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.securityPolicies.automatedRemindersEnabled
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                  }`}
                >
                  {settings?.securityPolicies.automatedRemindersEnabled ? 'Enabled' : 'Disabled (Dry-run)'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Outbound telephony calls</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.securityPolicies.outboundCallsEnabled
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                  }`}
                >
                  {settings?.securityPolicies.outboundCallsEnabled ? 'Enabled' : 'Disabled (Policy)'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-300">Super Admin safeguards</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  Enforced
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
            Outreach safety policies prevent unintended customer dispatches.
          </div>
        </div>

        {/* Section 2: Core Infrastructure */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 mb-3">
              <span className="text-sm">⚡</span>
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Core Infrastructure
              </h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Primary Database</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.database.status === 'healthy'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                  }`}
                >
                  {settings?.providers.database.status === 'healthy' ? 'Connected' : 'Unavailable'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">System health</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.systemHealth === 'operational'
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                  }`}
                >
                  {settings?.systemHealth === 'operational' ? 'Operational' : 'Degraded'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Environment</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-800 text-slate-300 border border-slate-700">
                  {settings?.environment || 'development'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Database Engine</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700">
                  {settings?.providers.database.engine || 'PostgreSQL'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-300">API version</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-800">
                  {settings?.version || '0.2.0'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
            Last health ping: {settings?.timestamp ? new Date(settings.timestamp).toLocaleTimeString() : 'Live'}
          </div>
        </div>

        {/* Section 3: Third-Party Services */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 mb-3">
              <span className="text-sm">🔌</span>
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Third-Party Services
              </h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Email Service (Resend)</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.resend.configured
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {settings?.providers.resend.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">WhatsApp Cloud API</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.whatsapp.configured
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {settings?.providers.whatsapp.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">LiveKit Audio SIP</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.livekit.configured
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {settings?.providers.livekit.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-300">Integration Credential Scope</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-800">
                  Tenant-Isolated
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
            Detected via environment presence without exposing secret tokens.
          </div>
        </div>

        {/* Section 4: Live Operations / Payment Configuration */}
        <div className="rounded-xl border border-slate-800 bg-[#111927] p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 mb-3">
              <span className="text-sm">💳</span>
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Live Operations & Payments
              </h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Razorpay Gateway</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.razorpay.configured
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {settings?.providers.razorpay.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Stripe Gateway</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    settings?.providers.stripe.configured
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {settings?.providers.stripe.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-300">Payment Simulation Mode</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-300 border border-amber-800">
                  {settings?.environment === 'production' ? 'Strict Live' : 'Non-Prod Simulation'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-300">Live Webhook Verification</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  HMAC-SHA256 Enforced
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500">
            Silent fallback to mock payment links is permanently disabled in live mode.
          </div>
        </div>
      </div>
    </div>
  )
}
