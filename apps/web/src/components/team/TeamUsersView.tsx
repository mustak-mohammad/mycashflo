import { useState, useEffect, useRef } from 'react'
import { usersApi, type UserItem } from '../../api/users'
import { useAuth } from '../../store/AuthContext'
import { useToast } from '../../store/ToastContext'
import { PasswordInput } from '../ui/PasswordInput'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { evaluatePasswordPolicy } from '../../utils/passwordPolicy'
import { extractSafeErrorMessage } from '../../utils/safeError'

export function TeamUsersView() {
  const { user: currentUser } = useAuth()
  const toast = useToast()
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

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: UserItem
    nextRole: 'ADMIN' | 'MANAGER' | 'AGENT'
  } | null>(null)
  const [pendingStatusToggle, setPendingStatusToggle] = useState<UserItem | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const actionInFlightRef = useRef(false)

  const isTenantAdmin = currentUser?.role === 'ADMIN'

  const loadUsers = async () => {
    if (!isTenantAdmin) {
      setError('User management is restricted to Tenant Administrators (ADMIN).')
      setLoading(false)
      return
    }
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
    if (isTenantAdmin) {
      loadUsers()
    } else {
      setLoading(false)
    }
  }, [isTenantAdmin])

  const passwordPolicy = evaluatePasswordPolicy(newPassword)

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newEmail.trim() || !newPassword) {
      setModalError('Name, email, and password are required.')
      return
    }
    if (passwordPolicy.errorMessage) {
      setModalError(passwordPolicy.errorMessage)
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
      toast.success(`Team member ${newName.trim()} created (${newRole}).`)
      setIsModalOpen(false)
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setNewRole('AGENT')
      await loadUsers()
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to create user')
      setModalError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestRoleChange = (targetUser: UserItem, nextRole: 'ADMIN' | 'MANAGER' | 'AGENT') => {
    if (targetUser.role === nextRole) return
    setConfirmError(null)
    setPendingRoleChange({ user: targetUser, nextRole })
  }

  const handleConfirmRoleChange = async () => {
    if (!pendingRoleChange || actionInFlightRef.current) return
    actionInFlightRef.current = true
    setConfirmingAction(true)
    setConfirmError(null)
    try {
      await usersApi.update(pendingRoleChange.user.id, { role: pendingRoleChange.nextRole })
      toast.success(
        `Updated ${pendingRoleChange.user.name}'s role to ${pendingRoleChange.nextRole}.`,
      )
      setPendingRoleChange(null)
      await loadUsers()
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to update role.')
      setConfirmError(msg)
      toast.error(msg)
    } finally {
      setConfirmingAction(false)
      actionInFlightRef.current = false
    }
  }

  const handleConfirmToggleActive = async () => {
    if (!pendingStatusToggle || actionInFlightRef.current) return
    actionInFlightRef.current = true
    setConfirmingAction(true)
    setConfirmError(null)
    const nextActive = !pendingStatusToggle.isActive
    try {
      await usersApi.update(pendingStatusToggle.id, { isActive: nextActive })
      toast.success(
        nextActive
          ? `Reactivated ${pendingStatusToggle.name}.`
          : `Deactivated ${pendingStatusToggle.name}.`,
      )
      setPendingStatusToggle(null)
      await loadUsers()
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to update user status.')
      setConfirmError(msg)
      toast.error(msg)
    } finally {
      setConfirmingAction(false)
      actionInFlightRef.current = false
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
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        onChange={(e) =>
                          handleRequestRoleChange(u, e.target.value as 'ADMIN' | 'MANAGER' | 'AGENT')
                        }
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
                          onClick={() => {
                            setConfirmError(null)
                            setPendingStatusToggle(u)
                          }}
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
                  <label htmlFor="invite-temp-password" className="block text-white/70 mb-1">
                    Temporary Password *
                  </label>
                  <PasswordInput
                    id="invite-temp-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, upper, lower, number/symbol"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                  {newPassword.length > 0 && (
                    <div className="mt-2 p-2.5 rounded-lg bg-black/30 border border-white/10 text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className={passwordPolicy.hasMinLength ? 'text-emerald-400' : 'text-slate-500'}>
                          {passwordPolicy.hasMinLength ? '✓' : '○'}
                        </span>
                        <span className={passwordPolicy.hasMinLength ? 'text-slate-200' : 'text-slate-400'}>
                          At least 8 characters
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={passwordPolicy.hasMixedCase ? 'text-emerald-400' : 'text-slate-500'}>
                          {passwordPolicy.hasMixedCase ? '✓' : '○'}
                        </span>
                        <span className={passwordPolicy.hasMixedCase ? 'text-slate-200' : 'text-slate-400'}>
                          Uppercase and lowercase letters
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={passwordPolicy.hasNumberOrSymbol ? 'text-emerald-400' : 'text-slate-500'}>
                          {passwordPolicy.hasNumberOrSymbol ? '✓' : '○'}
                        </span>
                        <span className={passwordPolicy.hasNumberOrSymbol ? 'text-slate-200' : 'text-slate-400'}>
                          At least one number or special symbol
                        </span>
                      </div>
                    </div>
                  )}
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
                  disabled={submitting || !passwordPolicy.isValid}
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  {submitting ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Role Change Dialog */}
      <ConfirmDialog
        open={Boolean(pendingRoleChange)}
        title="Confirm Role Change"
        description={
          pendingRoleChange
            ? `Change access role for ${pendingRoleChange.user.name} (${pendingRoleChange.user.email}) from ${pendingRoleChange.user.role} to ${pendingRoleChange.nextRole}?`
            : ''
        }
        confirmLabel="Confirm Role Change"
        variant="warning"
        loading={confirmingAction}
        errorMessage={confirmError}
        onCancel={() => {
          setPendingRoleChange(null)
          setConfirmError(null)
        }}
        onConfirm={handleConfirmRoleChange}
      />

      {/* Confirm Activate / Deactivate Dialog */}
      <ConfirmDialog
        open={Boolean(pendingStatusToggle)}
        title={pendingStatusToggle?.isActive ? 'Deactivate Team Member' : 'Reactivate Team Member'}
        description={
          pendingStatusToggle
            ? pendingStatusToggle.isActive
              ? `Are you sure you want to deactivate ${pendingStatusToggle.name} (${pendingStatusToggle.email})? They will immediately lose access to sign in.`
              : `Are you sure you want to reactivate ${pendingStatusToggle.name} (${pendingStatusToggle.email})?`
            : ''
        }
        confirmLabel={pendingStatusToggle?.isActive ? 'Deactivate User' : 'Reactivate User'}
        variant={pendingStatusToggle?.isActive ? 'danger' : 'primary'}
        loading={confirmingAction}
        errorMessage={confirmError}
        onCancel={() => {
          setPendingStatusToggle(null)
          setConfirmError(null)
        }}
        onConfirm={handleConfirmToggleActive}
      />
    </div>
  )
}
