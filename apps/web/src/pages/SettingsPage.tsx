import { useState, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../store/AuthContext'
import { getAuditLogs } from '../api/auditLogs'
import { integrationsApi, type TestIntegrationResponse } from '../api/integrations'
import { authApi } from '../api/auth'
import { Link, useSearchParams } from 'react-router-dom'
import { AutomatedRemindersView } from '../components/reminders/AutomatedRemindersView'
import { PasswordInput } from '../components/ui/PasswordInput'
import { getDisplayName } from '../utils/user'
import type { IntegrationItem } from '../types'
import type { AuditLog } from '../../../../packages/shared-types'

import { TeamUsersView } from '../components/team/TeamUsersView'

interface ProviderMeta {
  provider: string
  title: string
  icon: string
  description: string
  fields: { key: string; label: string; placeholder: string; type?: string }[]
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'RAZORPAY',
    title: 'Razorpay Gateway',
    icon: '💳',
    description: 'UPI, Net Banking, and Cards for Indian accounts receivable.',
    fields: [
      { key: 'keyId', label: 'Key ID', placeholder: 'rzp_live_...' },
      { key: 'keySecret', label: 'Key Secret', placeholder: 'Secret key...', type: 'password' },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'whsec_...', type: 'password' },
    ],
  },
  {
    provider: 'STRIPE',
    title: 'Stripe Payments',
    icon: '🌐',
    description: 'Global card checkout and multi-currency payment links.',
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_live_...' },
      { key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_...', type: 'password' },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'whsec_...', type: 'password' },
    ],
  },
  {
    provider: 'WHATSAPP_CLOUD',
    title: 'WhatsApp Business Cloud API',
    icon: '💬',
    description: 'Meta Graph API for verified reminder & commitment notifications.',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '1092837465...' },
      { key: 'accessToken', label: 'Permanent Access Token', placeholder: 'EAAG...', type: 'password' },
      { key: 'verifyToken', label: 'Webhook Verify Token', placeholder: 'mycashflo_token' },
    ],
  },
  {
    provider: 'SIP_TELEPHONY',
    title: 'SIP Telephony Gateway',
    icon: '📞',
    description: 'SIP carrier trunking & LiveKit WebRTC outbound dispatch.',
    fields: [
      { key: 'sipTrunkUri', label: 'SIP Trunk URI', placeholder: 'sip.trunk.carrier.net' },
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC_live_...' },
      { key: 'authToken', label: 'Auth Token', placeholder: 'Auth token...', type: 'password' },
    ],
  },
  {
    provider: 'RESEND',
    title: 'Resend Transactional Email',
    icon: '✉️',
    description: 'Transactional email delivery for invoices, statements, and payment reminders.',
    fields: [
      { key: 'apiKey', label: 'Resend API Key', placeholder: 're_123456789...', type: 'password' },
      { key: 'from', label: 'Sender Address (From)', placeholder: 'myCashflo <onboarding@resend.dev>' },
      { key: 'testRecipient', label: 'Test Recipient Allowlist', placeholder: 'delivered@resend.dev' },
    ],
  },
]

export default function SettingsPage() {
  const { user, updateUser } = useAuth()
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as 'integrations' | 'reminders' | 'audit' | 'team') || 'integrations'

  const setActiveTab = (tab: 'integrations' | 'reminders' | 'audit' | 'team') => {
    setSearchParams({ tab })
  }

  // Profile display name state
  const [profileName, setProfileName] = useState(user?.name || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (user?.name) {
      setProfileName(user.name)
    }
  }, [user?.name])

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = profileName.trim()
    if (!trimmed) {
      setProfileMessage({ type: 'error', text: 'Display name cannot be empty.' })
      return
    }
    setSavingProfile(true)
    setProfileMessage(null)
    try {
      const res = await authApi.updateProfile(trimmed)
      updateUser({ name: res.name })
      setProfileMessage({ type: 'success', text: 'Display name updated successfully.' })
      setTimeout(() => setProfileMessage(null), 3500)
    } catch (err: any) {
      setProfileMessage({
        type: 'error',
        text: err?.response?.data?.message || err.message || 'Failed to update display name.',
      })
    } finally {
      setSavingProfile(false)
    }
  }

  // Integrations state
  const [, setIntegrations] = useState<IntegrationItem[]>([])
  const [editingConfig, setEditingConfig] = useState<Record<string, Record<string, string>>>({})
  const [activeStatus, setActiveStatus] = useState<Record<string, boolean>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestIntegrationResponse>>({})
  const [saveSuccess, setSaveSuccess] = useState<Record<string, string>>({})

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getAuditLogs({ limit: 5 }),
      integrationsApi.list().catch(() => []),
    ])
      .then(([logsRes, intRes]) => {
        setRecentLogs(logsRes.data)
        setTotalLogs(logsRes.total)
        setIntegrations(intRes)

        const initialConfig: Record<string, Record<string, string>> = {}
        const initialActive: Record<string, boolean> = {}
        for (const item of intRes) {
          initialConfig[item.provider] = item.config || {}
          initialActive[item.provider] = item.isActive
        }
        setEditingConfig(initialConfig)
        setActiveStatus(initialActive)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleFieldChange = (provider: string, field: string, value: string) => {
    setEditingConfig((prev) => ({
      ...prev,
      [provider]: {
        ...(prev[provider] || {}),
        [field]: value,
      },
    }))
  }

  const handleToggleActive = (provider: string) => {
    setActiveStatus((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }))
  }

  const handleSave = async (provider: string) => {
    setSavingProvider(provider)
    setSaveSuccess((prev) => ({ ...prev, [provider]: '' }))
    try {
      const cfg = editingConfig[provider] || {}
      const isActive = activeStatus[provider] ?? true
      await integrationsApi.save(provider, cfg, isActive)
      setSaveSuccess((prev) => ({ ...prev, [provider]: 'Configuration saved successfully!' }))
      setTimeout(() => {
        setSaveSuccess((prev) => ({ ...prev, [provider]: '' }))
      }, 3000)
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`)
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTest = async (provider: string) => {
    setTestingProvider(provider)
    try {
      const res = await integrationsApi.test(provider)
      setTestResults((prev) => ({ ...prev, [provider]: res }))
    } catch (err: any) {
      alert(`Test failed: ${err.message}`)
    } finally {
      setTestingProvider(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Settings & Integrations" subtitle="Tenant adapters, team roles, carrier gateways, and compliance audit trail" />

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('integrations')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
            activeTab === 'integrations'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          🔌 Provider Adapters
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('team')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
            activeTab === 'team'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          👥 Team & Roles
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reminders')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2 ${
            activeTab === 'reminders'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <span>⏰ Chotu Automated Reminders</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
            activeTab === 'audit'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          📜 Compliance Audit Trail
        </button>
      </div>

      {activeTab === 'reminders' ? (
        <AutomatedRemindersView />
      ) : activeTab === 'team' ? (
        <TeamUsersView />
      ) : (
        <div className="space-y-6">
          {/* Profile */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">User Profile & Identity</h2>
              <p className="text-xs text-white/50 mt-0.5">Manage your personal profile display name and credentials.</p>
            </div>
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider"
              style={
                user?.role === 'SUPER_ADMIN'
                  ? { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }
                  : user?.role === 'ADMIN'
                  ? { background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
                  : user?.role === 'MANAGER'
                  ? { background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }
                  : { background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }
              }
            >
              {user?.role}
            </span>
          </div>

          {profileMessage && (
            <div
              className={`mb-4 p-3 rounded-xl text-xs flex items-center justify-between ${
                profileMessage.type === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/40 border border-rose-800 text-rose-300'
              }`}
            >
              <span>{profileMessage.text}</span>
              <button
                type="button"
                onClick={() => setProfileMessage(null)}
                className="text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )}

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1 text-white/70">
                  Display Name
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder={getDisplayName(user) || 'e.g. Ramesh Kumar'}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500"
                />
                {!user?.name?.trim() && (
                  <p className="text-[11px] mt-1 text-white/40">
                    Active fallback: <span className="text-indigo-300 font-medium">{getDisplayName(user)}</span> (derived from email)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-white/70">
                  Email Address (Read-only)
                </label>
                <input
                  type="email"
                  readOnly
                  disabled
                  value={user?.email || ''}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white/60 bg-white/[0.02] border border-white/5 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Assigned Role</dt>
                <dd className="text-xs text-white mt-0.5 font-medium">{user?.role ?? '—'}</dd>
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tenant ID</dt>
                <dd className="text-xs text-white mt-0.5 font-mono truncate">{user?.tenantId ?? '—'}</dd>
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Current Display</dt>
                <dd className="text-xs text-white mt-0.5 font-medium truncate">{getDisplayName(user)}</dd>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingProfile || !profileName.trim()}
                  className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer shadow-md shadow-indigo-600/20 transition-all"
                >
                  {savingProfile ? 'Saving...' : 'Save Display Name'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Phase 7: Provider Integrations Bench */}
        <div className="rounded-2xl p-6 space-y-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>🔌</span> External Provider Adapters (Phase 7)
              </h2>
              <p className="text-xs text-white/50 mt-1">
                Configure live API credentials or operate seamlessly in verified sandbox/simulation mode.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Adapters Ready
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {PROVIDERS.map((p) => {
              const currentCfg = editingConfig[p.provider] || {}
              const isActive = activeStatus[p.provider] ?? false
              const isSaving = savingProvider === p.provider
              const isTesting = testingProvider === p.provider
              const testResult = testResults[p.provider]
              const successMsg = saveSuccess[p.provider]

              return (
                <div
                  key={p.provider}
                  className="rounded-xl p-5 flex flex-col justify-between"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl p-2 rounded-xl bg-white/[0.04] border border-white/5">{p.icon}</span>
                        <div>
                          <h3 className="text-sm font-semibold text-white">{p.title}</h3>
                          <p className="text-xs text-white/50 mt-0.5">{p.description}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p.provider)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-white/5 text-white/40 border border-white/10'
                        }`}
                      >
                        {isActive ? 'Active' : 'Disabled'}
                      </button>
                    </div>

                    {/* Safety Banner for SIP Telephony */}
                    {p.provider === 'SIP_TELEPHONY' && (
                      <div className="p-2.5 rounded-lg text-xs bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 flex items-center gap-2">
                        <span>🛡️</span>
                        <span>
                          <strong>Strict Safety Guard Active:</strong> Real outbound PSTN calling is policy-disabled. Telephony sessions run safely in sandbox simulation.
                        </span>
                      </div>
                    )}

                    {/* Inputs */}
                    <div className="space-y-2.5 pt-1">
                      {p.fields.map((f) => (
                        <div key={f.key}>
                          <label className="block text-xs font-medium text-white/70 mb-1">{f.label}</label>
                          {f.type === 'password' ? (
                            <PasswordInput
                              value={currentCfg[f.key] || ''}
                              onChange={(e) => handleFieldChange(p.provider, f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className="w-full px-3 py-1.5 text-xs rounded-lg text-white font-mono bg-white/[0.04] border border-white/10 focus:border-indigo-500 focus:outline-none"
                            />
                          ) : (
                            <input
                              type={f.type || 'text'}
                              value={currentCfg[f.key] || ''}
                              onChange={(e) => handleFieldChange(p.provider, f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className="w-full px-3 py-1.5 text-xs rounded-lg text-white font-mono bg-white/[0.04] border border-white/10 focus:border-indigo-500 focus:outline-none"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Test Results Output */}
                    {testResult && (
                      <div
                        className={`p-3 rounded-lg text-xs border ${
                          testResult.isSimulated
                            ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                            : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                        }`}
                      >
                        <div className="font-semibold flex items-center gap-1.5">
                          <span>{testResult.isSimulated ? '🧪' : '✅'}</span>
                          <span>{testResult.message}</span>
                        </div>
                        {testResult.sampleUrl && (
                          <div className="mt-1 text-[11px] text-white/60 truncate">
                            URL: <a href={testResult.sampleUrl} target="_blank" rel="noreferrer" className="text-indigo-400 underline">{testResult.sampleUrl}</a>
                          </div>
                        )}
                        {testResult.messageId && (
                          <div className="mt-1 text-[11px] text-white/60 truncate">
                            Message ID: <span className="font-mono">{testResult.messageId}</span>
                          </div>
                        )}
                        {testResult.callSid && (
                          <div className="mt-1 text-[11px] text-white/60 truncate">
                            Call SID: <span className="font-mono">{testResult.callSid}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {successMsg && (
                      <div className="p-2 rounded-lg text-xs bg-emerald-950/40 border border-emerald-800 text-emerald-400">
                        ✓ {successMsg}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-4 flex items-center justify-end gap-2 border-t border-white/5 mt-4">
                    <button
                      type="button"
                      onClick={() => handleTest(p.provider)}
                      disabled={isTesting}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer disabled:opacity-50"
                    >
                      {isTesting ? 'Testing…' : '⚡ Test Connection'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSave(p.provider)}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50"
                    >
                      {isSaving ? 'Saving…' : 'Save Config'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Compliance & Audit Logs */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📜</span> Tenant Audit Trail & Compliance
              </h2>
              <p className="text-xs text-white/50 mt-1">
                Strict multi-tenant security log tracking all ledger mutations, payment links, and carrier events.
              </p>
            </div>
            <Link
              to="/intelligence"
              className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-xs transition-colors no-underline font-medium"
            >
              Open Full Audit Explorer →
            </Link>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-6 text-center text-xs text-white/40">Loading audit records...</div>
            ) : recentLogs.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/40">No audit logs recorded yet.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 uppercase">
                    <th className="py-2">Time</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Entity</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="py-2 text-white/50">{new Date(log.createdAt).toLocaleTimeString()}</td>
                      <td className="py-2 font-mono text-indigo-400">{log.action}</td>
                      <td className="py-2 text-white/70">{log.entityType ?? '—'}</td>
                      <td className="py-2 text-white/50 max-w-xs truncate">{log.metadata ? JSON.stringify(log.metadata) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-3 text-right text-xs text-white/40">
            Total tenant audit entries: {totalLogs}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
