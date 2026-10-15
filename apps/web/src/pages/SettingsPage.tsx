import { useState, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../store/AuthContext'
import { getAuditLogs } from '../api/auditLogs'
import { Link } from 'react-router-dom'
import type { AuditLog } from '../../../../packages/shared-types'

export default function SettingsPage() {
  const { user } = useAuth()
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([])
  const [totalLogs, setTotalLogs] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAuditLogs({ limit: 5 })
      .then((res) => {
        setRecentLogs(res.data)
        setTotalLogs(res.total)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title="Settings & Compliance" subtitle="Tenant configuration, security, and audit trail" />

      <div className="space-y-4">
        {/* Profile */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white mb-4">User Profile</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['Name', user?.name ?? '—'],
              ['Email', user?.email ?? '—'],
              ['Role', user?.role ?? '—'],
              ['Tenant ID', user?.tenantId ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <dt className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</dt>
                <dd className="text-sm text-white mt-1 font-medium truncate">{v}</dd>
              </div>
            ))}
          </div>
        </div>

        {/* Phase 6: Compliance & Audit Logs */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>📜</span> Tenant Audit Trail & Compliance
              </h2>
              <p className="text-xs text-white/50 mt-1">
                Strict multi-tenant security log tracking all ledger mutations, AI proposals, and notification events.
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

        {/* Company Settings */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white mb-2">Multi-Channel Gateways</h2>
          <p className="text-xs text-white/50">
            WhatsApp Business API, Twilio SMS, and SMTP email endpoints are managed through the Collections Intelligence engine. External webhook and payment provider adapters are slated for Phase 7.
          </p>
        </div>
      </div>
    </div>
  )
}
