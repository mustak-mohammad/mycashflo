import { useState, useEffect } from 'react'
import { usersApi, type UserItem } from '../../api/users'
import { useAuth } from '../../store/AuthContext'
import { PasswordInput } from '../ui/PasswordInput'

export function TeamUsersView() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'MANAGER' | 'AGENT'>('AGENT')
  const [submitting, setSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const loadUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await usersApi.list()
      setUsers(data)
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load tenant users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      setModalError('Name, email, and password are required.')
      return
    }
    setSubmitting(true)
    setModalError(null)
    try {
      await usersApi.create({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        role: newRole,
      })
      setIsModalOpen(false)
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setNewRole('AGENT')
      await loadUsers()
    } catch (err: any) {
      setModalError(err?.response?.data?.message || err.message || 'Failed to create user')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRoleChange = async (targetUser: UserItem, newRoleValue: 'ADMIN' | 'MANAGER' | 'AGENT') => {
    if (targetUser.role === newRoleValue) return
    try {
      await usersApi.update(targetUser.id, { role: newRoleValue })
      await loadUsers()
    } catch (err: any) {
      alert(`Failed to update role: ${err?.response?.data?.message || err.message}`)
    }
  }

  const handleToggleActive = async (targetUser: UserItem) => {
    try {
      await usersApi.update(targetUser.id, { isActive: !targetUser.isActive })
      await loadUsers()
    } catch (err: any) {
      alert(`Failed to update status: ${err?.response?.data?.message || err.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>👥</span> Tenant User & Role Management
            </h2>
            <p className="text-xs text-white/50 mt-1">
              Manage team members, roles, and access boundaries within your organization tenant.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setModalError(null)
              setIsModalOpen(true)
            }}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm cursor-pointer transition-colors"
          >
            + Invite User
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl text-xs bg-rose-950/40 border border-rose-800 text-rose-300">
            ⚠️ {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                {['User', 'Email', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left font-medium uppercase tracking-wider text-white/60"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-white/50">
                    Loading tenant users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-white/50">
                    No users found for this tenant.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3.5 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 flex items-center justify-center font-bold text-xs">
                          {u.name ? u.name.charAt(0).toUpperCase() : 'U'}
                        </span>
                        <div>
                          <div>{u.name}</div>
                          {u.id === currentUser?.id && (
                            <span className="text-[10px] text-emerald-400 font-mono">(You)</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-white/70">{u.email}</td>
                    <td className="px-5 py-3.5">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value as any)}
                        disabled={u.id === currentUser?.id}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="AGENT">AGENT</option>
                      </select>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          u.isActive
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-white/50">
                      {new Date(u.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.id !== currentUser?.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleActive(u)}
                          className="px-2.5 py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                        >
                          {u.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite/Create User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{
              background: 'var(--surface, #13141c)',
              border: '1px solid var(--border, rgba(255,255,255,0.1))',
            }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Add New Team Member</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  ⚠️ {modalError}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-white/70 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="ramesh@company.in"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Temporary Password *</label>
                  <PasswordInput
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters..."
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Role *</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="AGENT">AGENT (Collection Agent — Assigned Cases Only)</option>
                    <option value="MANAGER">MANAGER (Collections Manager — All Cases & Reminders)</option>
                    <option value="ADMIN">ADMIN (Tenant Administrator — Full Tenant Access)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  {submitting ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
