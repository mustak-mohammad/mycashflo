import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../store/AuthContext'

export default function SettingsPage() {
  const { user } = useAuth()

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader title="Settings" subtitle="Company configuration and user preferences" />

      <div className="space-y-4">
        {/* Profile */}
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white mb-4">Profile</h2>
          <div className="grid grid-cols-2 gap-4">
            {[['Name', user?.name ?? '—'], ['Email', user?.email ?? '—'], ['Role', user?.role ?? '—'], ['Tenant ID', user?.tenantId ?? '—']].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</dt>
                <dd className="text-sm text-white mt-0.5 font-medium">{v}</dd>
              </div>
            ))}
          </div>
        </div>

        {/* Company */}
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white mb-4">Company Settings</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Company name, branding, integrations, and team members will be configurable here after Phase 2 backend setup.
          </p>
        </div>

        {/* Security */}
        <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold text-white mb-4">Security</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Password change, two-factor authentication, and active session management coming in Phase 2.
          </p>
        </div>
      </div>
    </div>
  )
}
