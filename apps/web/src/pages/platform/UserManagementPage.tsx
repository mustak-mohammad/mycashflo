import { useState, useEffect } from 'react'
import {
  getPlatformUsers,
  getPlatformTenants,
  updatePlatformUserRole,
  updatePlatformUserStatus,
  type PlatformUser,
  type PlatformTenant,
} from '../../api/platform'

export default function UserManagementPage() {
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [tenantFilter, setTenantFilter] = useState('ALL')
  const [roleFilter, setRoleFilter] = useState('ALL')

  // Role Change Confirmation Modal
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    user: PlatformUser
    newRole: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT'
  } | null>(null)
  const [updatingRole, setUpdatingRole] = useState(false)

  // Status Change Confirmation Modal
  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    user: PlatformUser
    nextActive: boolean
  } | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [uList, tList] = await Promise.all([
        getPlatformUsers(),
        getPlatformTenants(),
      ])
      setUsers(uList)
      setTenants(tList)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load user directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const executeRoleChange = async () => {
    if (!roleChangeTarget) return
    setUpdatingRole(true)
    setActionMsg(null)
    try {
      await updatePlatformUserRole(roleChangeTarget.user.id, roleChangeTarget.newRole)
      setActionMsg({
        type: 'success',
        text: `Role for ${roleChangeTarget.user.email} updated to ${roleChangeTarget.newRole}`,
      })
      setRoleChangeTarget(null)
      await loadData()
    } catch (err: any) {
      setActionMsg({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to update user role',
      })
    } finally {
      setUpdatingRole(false)
    }
  }

  const executeStatusChange = async () => {
    if (!statusChangeTarget) return
    setUpdatingStatus(true)
    setActionMsg(null)
    try {
      await updatePlatformUserStatus(statusChangeTarget.user.id, statusChangeTarget.nextActive)
      setActionMsg({
        type: 'success',
        text: `User ${statusChangeTarget.user.email} ${
          statusChangeTarget.nextActive ? 'activated' : 'deactivated'
        } successfully`,
      })
      setStatusChangeTarget(null)
      await loadData()
    } catch (err: any) {
      setActionMsg({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to update user status',
      })
    } finally {
      setUpdatingStatus(false)
    }
  }

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.tenant?.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.tenant?.slug?.toLowerCase().includes(search.toLowerCase())

    const matchesTenant = tenantFilter === 'ALL' || u.tenantId === tenantFilter
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter

    return matchesSearch && matchesTenant && matchesRole
  })

  const totalUsers = users.length
  const activeUsers = users.filter((u) => u.isActive).length
  const superAdminCount = users.filter((u) => u.role === 'SUPER_ADMIN').length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            User Directory & Access Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Global cross-tenant user roster, role assignments, and account activation states.
          </p>
        </div>

        <button
          onClick={() => loadData()}
          disabled={loading}
          className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <span>🔄</span> Refresh Roster
        </button>
      </div>

      {actionMsg && (
        <div
          className={`p-4 rounded-lg text-xs sm:text-sm flex items-center justify-between ${
            actionMsg.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border border-rose-800 text-rose-300'
          }`}
        >
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="opacity-75 hover:opacity-100 text-xs">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Total Registered Users</div>
          <div className="text-2xl font-bold text-white mt-1">{totalUsers}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Across all organizations</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Active Credentials</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{activeUsers}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Currently enabled accounts</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Deactivated Accounts</div>
          <div className="text-2xl font-bold text-slate-400 mt-1">{totalUsers - activeUsers}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Access suspended</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Super Administrators</div>
          <div className="text-2xl font-bold text-sky-400 mt-1">{superAdminCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Global platform roots</div>
        </div>
      </div>

      {/* Users Table & Filters */}
      <div className="rounded-xl border border-slate-800 bg-[#111927] overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Search name, email, tenant..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 pl-9 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
            </div>

            {/* Tenant Filter */}
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="w-full sm:w-48 px-3 py-2 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All Tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </select>

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full sm:w-40 px-3 py-2 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All Roles</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MANAGER">MANAGER</option>
              <option value="AGENT">AGENT</option>
            </select>
          </div>

          <div className="text-xs text-slate-400 self-end md:self-auto">
            Showing <span className="font-semibold text-slate-200">{filteredUsers.length}</span> of{' '}
            <span className="font-semibold text-slate-200">{totalUsers}</span> users
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading platform user roster...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No accounts match your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Organization Tenant</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white">{u.name}</div>
                      <div className="text-slate-400 text-[11px] font-mono">{u.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-200 font-medium">{u.tenant?.name || 'Isolated'}</div>
                      <code className="text-sky-300 bg-sky-950/40 border border-sky-900/50 px-1.5 py-0.5 rounded text-[10px]">
                        {u.tenant?.slug || u.tenantId}
                      </code>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase inline-block"
                        style={
                          u.role === 'SUPER_ADMIN'
                            ? { background: 'rgba(14, 165, 233, 0.2)', color: '#38bdf8', border: '1px solid rgba(14, 165, 233, 0.35)' }
                            : u.role === 'ADMIN'
                            ? { background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
                            : u.role === 'MANAGER'
                            ? { background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }
                            : { background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }
                        }
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {u.isActive ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-950/80 border border-emerald-800 text-emerald-300">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-800 border border-slate-700 text-slate-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      {/* Change Role Trigger */}
                      <select
                        value={u.role}
                        onChange={(e) => {
                          const newRole = e.target.value as any
                          if (newRole !== u.role) {
                            setRoleChangeTarget({ user: u, newRole })
                          }
                        }}
                        className="px-2 py-1 rounded text-[11px] bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                      >
                        <option value="AGENT">AGENT</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                      </select>

                      {/* Status Toggle Trigger */}
                      <button
                        onClick={() =>
                          setStatusChangeTarget({ user: u, nextActive: !u.isActive })
                        }
                        className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] font-semibold ${
                          u.isActive
                            ? 'bg-rose-950/40 text-rose-300 border border-rose-800/60 hover:bg-rose-900/60'
                            : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/60 hover:bg-emerald-900/70'
                        }`}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Role Change Confirmation Modal */}
      {roleChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">⚠️</span>
              <h3 className="text-base font-bold text-white">Confirm Role Assignment</h3>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Are you sure you want to change the role for{' '}
              <span className="font-bold text-white">{roleChangeTarget.user.name}</span> (
              <span className="font-mono text-sky-400">{roleChangeTarget.user.email}</span>) from{' '}
              <span className="font-semibold text-amber-400">{roleChangeTarget.user.role}</span> to{' '}
              <span className="font-semibold text-emerald-400">{roleChangeTarget.newRole}</span>?
              {roleChangeTarget.newRole === 'SUPER_ADMIN' && (
                <span className="block mt-2 text-rose-300 bg-rose-950/40 p-2.5 rounded border border-rose-900 font-semibold">
                  Caution: This grants root platform-wide access across all tenants.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoleChangeTarget(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeRoleChange}
                disabled={updatingRole}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
              >
                {updatingRole ? 'Updating...' : 'Confirm Role Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Change Confirmation Modal */}
      {statusChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">
                {statusChangeTarget.nextActive ? '🟢' : '⚠️'}
              </span>
              <h3 className="text-base font-bold text-white">
                {statusChangeTarget.nextActive ? 'Activate Account' : 'Deactivate Account'}
              </h3>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Are you sure you want to {statusChangeTarget.nextActive ? 'activate' : 'deactivate'}{' '}
              account for{' '}
              <span className="font-bold text-white">{statusChangeTarget.user.name}</span> (
              <span className="font-mono text-sky-400">{statusChangeTarget.user.email}</span>)?
              {!statusChangeTarget.nextActive
                ? ' This user will be immediately rejected from logging in or making API requests.'
                : ' This user will regain the ability to log in with their credentials.'}
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStatusChangeTarget(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeStatusChange}
                disabled={updatingStatus}
                className={`px-4 py-2 text-xs font-bold rounded-lg text-white transition-colors cursor-pointer ${
                  statusChangeTarget.nextActive
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {updatingStatus
                  ? 'Updating...'
                  : statusChangeTarget.nextActive
                  ? 'Confirm Activation'
                  : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

