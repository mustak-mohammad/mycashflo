import { useState, useEffect } from 'react'
import { useAuth } from '../../store/AuthContext'
import { authApi } from '../../api/auth'
import { getDisplayName } from '../../utils/user'
import { ChangePasswordCard } from './ChangePasswordCard'

export function ProfileSecuritySection() {
  const { user, updateUser } = useAuth()
  const [profileName, setProfileName] = useState(user?.name || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  useEffect(() => {
    if (user?.name !== undefined) {
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
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Failed to update display name.')
      setProfileMessage({
        type: 'error',
        text: typeof msg === 'string' ? msg : 'Failed to update display name.',
      })
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">User Profile &amp; Identity</h2>
            <p className="text-xs text-white/50 mt-0.5">
              Manage your personal profile display name and credentials.
            </p>
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
            role={profileMessage.type === 'error' ? 'alert' : 'status'}
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
              <label htmlFor="profile-display-name" className="block text-xs font-medium mb-1 text-white/70">
                Display Name
              </label>
              <input
                id="profile-display-name"
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
              <label htmlFor="profile-email" className="block text-xs font-medium mb-1 text-white/70">
                Email Address (Read-only)
              </label>
              <input
                id="profile-email"
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

      <ChangePasswordCard userRole={user?.role} />
    </div>
  )
}

