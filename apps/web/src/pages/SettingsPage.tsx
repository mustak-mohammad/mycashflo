import { useState, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../store/AuthContext'
import { integrationsApi, type TestIntegrationResponse } from '../api/integrations'
import { useSearchParams } from 'react-router-dom'
import { AutomatedRemindersView } from '../components/reminders/AutomatedRemindersView'
import { PasswordInput } from '../components/ui/PasswordInput'
import type { IntegrationItem } from '../types'

import { TeamUsersView } from '../components/team/TeamUsersView'
import { ProfileSecuritySection } from '../components/auth/ProfileSecuritySection'
import { TenantAuditLogsView } from '../components/audit/TenantAuditLogsView'

interface ProviderFieldMeta {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'password' | 'select'
  options?: Array<{ value: string; label: string }>
}

interface ProviderMeta {
  provider: string
  title: string
  icon: string
  description: string
  fields: ProviderFieldMeta[]
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'RAZORPAY',
    title: 'Razorpay Gateway',
    icon: '💳',
    description: 'UPI, Net Banking, and Cards for Indian accounts receivable.',
    fields: [
      { key: 'keyId', label: 'Key ID', placeholder: 'rzp_test_...' },
      { key: 'keySecret', label: 'Key Secret', placeholder: 'Enter key secret', type: 'password' },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password' },
    ],
  },
  {
    provider: 'STRIPE',
    title: 'Stripe Payments',
    icon: '🌐',
    description: 'Global card checkout and multi-currency payment links.',
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_test_...' },
      { key: 'secretKey', label: 'Secret Key', placeholder: 'Enter secret key', type: 'password' },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password' },
    ],
  },
  {
    provider: 'WHATSAPP_CLOUD',
    title: 'WhatsApp Business Cloud API',
    icon: '💬',
    description: 'Meta Graph API for verified reminder & commitment notifications.',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '1092837465...' },
      { key: 'accessToken', label: 'Permanent Access Token', placeholder: 'Enter access token', type: 'password' },
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
      { key: 'authToken', label: 'Auth Token', placeholder: 'Enter auth token', type: 'password' },
    ],
  },
  {
    provider: 'RESEND',
    title: 'Resend Transactional Email',
    icon: '✉️',
    description: 'Transactional email delivery for invoices, statements, and payment reminders.',
    fields: [
      { key: 'apiKey', label: 'Resend API Key', placeholder: 'Enter Resend API key', type: 'password' },
      { key: 'from', label: 'Sender Address (From)', placeholder: 'myCashflo <onboarding@resend.dev>' },
      { key: 'testRecipient', label: 'Test Recipient Allowlist', placeholder: 'delivered@resend.dev' },
    ],
  },
  {
    provider: 'SMS_GATEWAY',
    title: 'SMS Gateway (DLT / Carrier)',
    icon: '📱',
    description: 'DLT-compliant SMS configuration and safe simulation connectivity checks.',
    fields: [
      {
        key: 'provider',
        label: 'SMS Vendor',
        placeholder: 'Select SMS vendor',
        type: 'select',
        options: [
          { value: 'TWILIO', label: 'Twilio' },
          { value: 'GUPSHUP', label: 'Gupshup' },
          { value: 'EXOTEL', label: 'Exotel' },
          { value: 'GENERIC_SMS', label: 'Generic SMS Gateway' },
        ],
      },
      { key: 'accountSid', label: 'Account SID / API ID', placeholder: 'AC_...' },
      { key: 'authToken', label: 'Auth Token / Secret', placeholder: 'Enter auth token', type: 'password' },
      { key: 'senderId', label: 'DLT Sender ID (6 chars)', placeholder: 'MCASHF' },
      { key: 'entityId', label: 'DLT Principal Entity ID', placeholder: '1101...' },
      { key: 'templateId', label: 'DLT Content Template ID', placeholder: '1107...' },
      { key: 'testRecipient', label: 'Test Recipient Allowlist', placeholder: '+919876543210' },
    ],
  },
]

const SECRET_FIELDS_BY_PROVIDER: Record<string, Set<string>> = Object.fromEntries(
  PROVIDERS.map((p) => [
    p.provider,
    new Set(p.fields.filter((f) => f.type === 'password').map((f) => f.key)),
  ]),
)

function buildEditableAndMaskedState(items: IntegrationItem[]) {
  const editable: Record<string, Record<string, string>> = {}
  const maskedSecrets: Record<string, Record<string, string>> = {}
  const active: Record<string, boolean> = {}

  for (const item of items) {
    const prov = item.provider.toUpperCase()
    const secretSet = SECRET_FIELDS_BY_PROVIDER[prov] ?? new Set<string>()
    const rawCfg = item.config || {}
    editable[prov] = {}
    maskedSecrets[prov] = {}
    active[prov] = item.isActive

    for (const [k, v] of Object.entries(rawCfg)) {
      if (secretSet.has(k)) {
        // Never prefill secret inputs with stored or masked credentials
        if (typeof v === 'string' && v.trim() !== '') {
          maskedSecrets[prov][k] = v
        }
      } else if (v !== undefined && v !== null) {
        editable[prov][k] = String(v)
      }
    }
  }

  return { editable, maskedSecrets, active }
}

export default function SettingsPage() {
  const { user } = useAuth()
  const isTenantAdmin = user?.role === 'ADMIN'
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab =
    (searchParams.get('tab') as 'integrations' | 'reminders' | 'audit' | 'team') || 'integrations'

  const setActiveTab = (tab: 'integrations' | 'reminders' | 'audit' | 'team') => {
    setSearchParams({ tab })
  }

  // Integrations state
  const [loadingIntegrations, setLoadingIntegrations] = useState(true)
  const [integrationsError, setIntegrationsError] = useState<string | null>(null)
  const [editingConfig, setEditingConfig] = useState<Record<string, Record<string, string>>>({})
  const [storedSecretHints, setStoredSecretHints] = useState<Record<string, Record<string, string>>>({})
  const [activeStatus, setActiveStatus] = useState<Record<string, boolean>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestIntegrationResponse>>({})
  const [saveSuccess, setSaveSuccess] = useState<Record<string, string>>({})
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    void integrationsApi
      .list()
      .then((intRes) => {
        if (!active) return
        const parsed = buildEditableAndMaskedState(intRes)
        setEditingConfig(parsed.editable)
        setStoredSecretHints(parsed.maskedSecrets)
        setActiveStatus(parsed.active)
        setIntegrationsError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err instanceof Error ? err.message : 'Failed to load integration configurations.')
        setIntegrationsError(typeof msg === 'string' ? msg : 'Failed to load integration configurations.')
      })
      .finally(() => {
        if (active) setLoadingIntegrations(false)
      })

    return () => {
      active = false
    }
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
    setProviderErrors((prev) => ({ ...prev, [provider]: '' }))

    try {
      const rawCfg = editingConfig[provider] || {}
      const secretSet = SECRET_FIELDS_BY_PROVIDER[provider] ?? new Set<string>()
      const payloadCfg: Record<string, string> = {}

      for (const [key, val] of Object.entries(rawCfg)) {
        if (secretSet.has(key)) {
          // Preserve existing backend secret when input is left blank
          if (val.trim() !== '') {
            payloadCfg[key] = val.trim()
          }
        } else {
          payloadCfg[key] = val
        }
      }

      const isActive = activeStatus[provider] ?? true
      const saved = await integrationsApi.save(provider, payloadCfg, isActive)

      // Update masked hints from server response and reset secret inputs back to blank
      const parsed = buildEditableAndMaskedState([saved])
      setEditingConfig((prev) => ({
        ...prev,
        [provider]: parsed.editable[provider] || {},
      }))
      setStoredSecretHints((prev) => ({
        ...prev,
        [provider]: parsed.maskedSecrets[provider] || {},
      }))
      setActiveStatus((prev) => ({
        ...prev,
        [provider]: saved.isActive,
      }))

      setSaveSuccess((prev) => ({ ...prev, [provider]: 'Configuration saved successfully!' }))
      setTimeout(() => {
        setSaveSuccess((prev) => ({ ...prev, [provider]: '' }))
      }, 3000)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Failed to save configuration.')
      setProviderErrors((prev) => ({
        ...prev,
        [provider]: typeof msg === 'string' ? msg : 'Failed to save configuration.',
      }))
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTest = async (provider: string) => {
    setTestingProvider(provider)
    setProviderErrors((prev) => ({ ...prev, [provider]: '' }))
    try {
      const res = await integrationsApi.test(provider)
      setTestResults((prev) => ({ ...prev, [provider]: res }))
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Connectivity test failed.')
      setProviderErrors((prev) => ({
        ...prev,
        [provider]: typeof msg === 'string' ? msg : 'Connectivity test failed.',
      }))
    } finally {
      setTestingProvider(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Settings & Integrations"
        subtitle="Tenant adapters, team roles, carrier gateways, and compliance audit trail"
      />

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-2">
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
        {isTenantAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === 'team'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            👥 Team &amp; Roles
          </button>
        )}
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
      ) : activeTab === 'audit' ? (
        <TenantAuditLogsView />
      ) : activeTab === 'team' ? (
        isTenantAdmin ? (
          <TeamUsersView />
        ) : (
          <div
            role="alert"
            className="rounded-2xl p-6 text-center space-y-2 border border-amber-800/50 bg-amber-950/20"
          >
            <h2 className="text-sm font-semibold text-white">Tenant Administrator Access Required</h2>
            <p className="text-xs text-slate-300 max-w-md mx-auto">
              User and role management is restricted to Tenant Administrators (ADMIN). Managers can
              manage integrations, automated reminders, audit logs, and personal profile settings.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <ProfileSecuritySection />

          {/* External Provider Integrations Bench */}
          <div
            className="rounded-2xl p-6 space-y-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>🔌</span> External Provider Adapters
                </h2>
                <p className="text-xs text-white/50 mt-1">
                  Configure provider credentials or test safely in sandbox/simulation mode. Stored secrets remain masked and preserved unless replaced.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('audit')}
                  className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 cursor-pointer"
                >
                  📜 View Audit Trail
                </button>
              </div>
            </div>

            {integrationsError && (
              <div
                role="alert"
                className="p-3 rounded-xl text-xs bg-rose-950/40 border border-rose-800 text-rose-300"
              >
                ⚠️ {integrationsError}
              </div>
            )}

            {loadingIntegrations ? (
              <div className="py-10 text-center text-xs text-white/50">
                Loading tenant integration configurations…
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {PROVIDERS.map((p) => {
                  const currentCfg = editingConfig[p.provider] || {}
                  const secretHints = storedSecretHints[p.provider] || {}
                  const isActive = activeStatus[p.provider] ?? false
                  const isSaving = savingProvider === p.provider
                  const isTesting = testingProvider === p.provider
                  const testResult = testResults[p.provider]
                  const successMsg = saveSuccess[p.provider]
                  const errMsg = providerErrors[p.provider]

                  return (
                    <div
                      key={p.provider}
                      data-testid={`provider-card-${p.provider}`}
                      className="rounded-xl p-5 flex flex-col justify-between"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl p-2 rounded-xl bg-white/[0.04] border border-white/5">
                              {p.icon}
                            </span>
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

                        {/* Safety & Support Notice for SMS Gateway */}
                        {p.provider === 'SMS_GATEWAY' && (
                          <div className="p-2.5 rounded-lg text-xs bg-amber-950/30 border border-amber-800/50 text-amber-200 flex items-start gap-2">
                            <span>🛡️</span>
                            <span>
                              <strong>Simulation &amp; Test Mode:</strong> Configuration &amp; DLT metadata are stored securely with masked secrets. Live external carrier HTTP transport is not enabled; connectivity checks execute in safe simulation mode.
                            </span>
                          </div>
                        )}

                        {/* Inputs */}
                        <div className="space-y-2.5 pt-1">
                          {p.fields.map((f) => {
                            const inputId = `${p.provider.toLowerCase()}-${f.key}`
                            const maskedHint = secretHints[f.key]
                            return (
                              <div key={f.key}>
                                <div className="flex items-center justify-between mb-1">
                                  <label
                                    htmlFor={inputId}
                                    className="block text-xs font-medium text-white/70"
                                  >
                                    {f.label}
                                  </label>
                                  {f.type === 'password' && maskedHint && (
                                    <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/50 border border-emerald-800/50 px-1.5 py-0.5 rounded">
                                      Stored: {maskedHint}
                                    </span>
                                  )}
                                </div>
                                {f.type === 'password' ? (
                                  <PasswordInput
                                    id={inputId}
                                    value={currentCfg[f.key] || ''}
                                    onChange={(e) => handleFieldChange(p.provider, f.key, e.target.value)}
                                    placeholder={
                                      maskedHint
                                        ? 'Leave blank to keep stored credential'
                                        : f.placeholder
                                    }
                                    autoComplete="new-password"
                                    className="w-full px-3 py-1.5 text-xs rounded-lg text-white font-mono bg-white/[0.04] border border-white/10 focus:border-indigo-500 focus:outline-none"
                                  />
                                ) : f.type === 'select' && f.options ? (
                                  <select
                                    id={inputId}
                                    value={currentCfg[f.key] || f.options[0].value}
                                    onChange={(e) => handleFieldChange(p.provider, f.key, e.target.value)}
                                    className="w-full px-3 py-1.5 text-xs rounded-lg text-white font-mono bg-slate-900 border border-white/10 focus:border-indigo-500 focus:outline-none"
                                  >
                                    {f.options.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    id={inputId}
                                    type="text"
                                    value={currentCfg[f.key] || ''}
                                    onChange={(e) => handleFieldChange(p.provider, f.key, e.target.value)}
                                    placeholder={f.placeholder}
                                    className="w-full px-3 py-1.5 text-xs rounded-lg text-white font-mono bg-white/[0.04] border border-white/10 focus:border-indigo-500 focus:outline-none"
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Test Results Output */}
                        {testResult && (() => {
                          const isFailure =
                            testResult.status === 'FAILED' || testResult.status === 'ERROR'
                          return (
                            <div
                              className={`p-3 rounded-lg text-xs border ${
                                isFailure
                                  ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                                  : testResult.isSimulated
                                  ? 'bg-amber-950/40 border-amber-800 text-amber-300'
                                  : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                              }`}
                            >
                              <div className="font-semibold flex items-center gap-1.5">
                                <span>{isFailure ? '❌' : testResult.isSimulated ? '🧪' : '✅'}</span>
                                <span>{testResult.message}</span>
                              </div>
                            {testResult.sampleUrl && (
                              <div className="mt-1 text-[11px] text-white/60 truncate">
                                URL:{' '}
                                <a
                                  href={testResult.sampleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-indigo-400 underline"
                                >
                                  {testResult.sampleUrl}
                                </a>
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
                          )
                        })()}

                        {errMsg && (
                          <div
                            role="alert"
                            className="p-2 rounded-lg text-xs bg-rose-950/40 border border-rose-800 text-rose-300"
                          >
                            ⚠️ {errMsg}
                          </div>
                        )}

                        {successMsg && (
                          <div
                            role="status"
                            className="p-2 rounded-lg text-xs bg-emerald-950/40 border border-emerald-800 text-emerald-400"
                          >
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
