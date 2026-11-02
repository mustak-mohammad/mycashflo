import { useState, useEffect } from 'react'
import { StatCard } from '../components/ui/StatCard'
import {
  getPlatformSummary,
  getPlatformTenants,
  createPlatformTenant,
  getPlatformUsers,
  updatePlatformUserRole,
  updatePlatformUserStatus,
  type PlatformSummary,
  type PlatformTenant,
  type PlatformUser,
} from '../api/platform'

export default function PlatformPage() {
  const [activeTab, setActiveTab] = useState<'tenants' | 'users'>('tenants')
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Tenant creation form state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [creatingTenant, setCreatingTenant] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, ten, usr] = await Promise.all([
        getPlatformSummary(),
        getPlatformTenants(),
        getPlatformUsers(),
      ])
      setSummary(sum)
      setTenants(ten)
      setUsers(usr)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load platform data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tenantName.trim() || !tenantSlug.trim()) return

    setCreatingTenant(true)
    setActionMessage(null)
    try {
      await createPlatformTenant({ name: tenantName.trim(), slug: tenantSlug.trim().toLowerCase() })
      setActionMessage({ type: 'success', text: `Tenant '${tenantName}' created successfully` })
      setTenantName('')
      setTenantSlug('')
      setShowCreateModal(false)
      await loadData()
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to create tenant',
      })
    } finally {
      setCreatingTenant(false)
    }
  }

  const handleRoleChange = async (userId: string, newRole: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT') => {
    setActionMessage(null)
    try {
      await updatePlatformUserRole(userId, newRole)
      setActionMessage({ type: 'success', text: 'User role updated successfully' })
      await loadData()
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to update user role',
      })
    }
  }

  const handleStatusToggle = async (userId: string, currentStatus: boolean) => {
    setActionMessage(null)
    try {
      await updatePlatformUserStatus(userId, !currentStatus)
      setActionMessage({
        type: 'success',
        text: `User ${!currentStatus ? 'activated' : 'deactivated'} successfully`,
      })
      await loadData()
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to update user status',
      })
    }
  }

  const formatCurrency = (amt: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              Platform Administration
            </h1>
            <span
              className="px-2.5 py-0.5 text-xs font-semibold rounded-full uppercase"
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
            >
              Super Admin Console
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Cross-tenant governance, provisioning, and platform-level telemetry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border transition-colors flex items-center gap-2"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          >
            <span>🔄</span> Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white shadow-sm flex items-center gap-2"
            style={{ background: 'var(--primary)' }}
          >
            <span>➕</span> Provision Tenant
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-lg text-sm flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border border-rose-800 text-rose-300'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            label="Total Tenants"
            value={summary.tenantsCount}
            subtext="Isolated workspaces"
            icon="🏢"
            color="#3b82f6"
          />
          <StatCard
            label="Active Users"
            value={summary.usersCount}
            subtext="Platform accounts"
            icon="👥"
            color="#8b5cf6"
          />
          <StatCard
            label="Total Invoiced"
            value={formatCurrency(summary.totalInvoiced)}
            subtext={`${summary.invoicesCount} invoices`}
            icon="🧾"
            color="#6366f1"
          />
          <StatCard
            label="Total Collected"
            value={formatCurrency(summary.totalCollected)}
            subtext={`${summary.completedPaymentsCount} payments`}
            icon="💳"
            color="#10b981"
          />
          <StatCard
            label="Total Outstanding"
            value={formatCurrency(summary.totalOutstanding)}
            subtext="Pending collection"
            icon="⏳"
            color="#f59e0b"
          />
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        className="flex items-center gap-4 border-b pb-2 text-sm font-medium"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => setActiveTab('tenants')}
          className={`pb-2 border-b-2 transition-colors ${
            activeTab === 'tenants'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          🏢 Tenants Directory ({tenants.length})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-2 border-b-2 transition-colors ${
            activeTab === 'users'
              ? 'border-indigo-500 text-white font-semibold'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          👥 Platform Users ({users.length})
        </button>
      </div>

      {/* Tenants Table */}
      {activeTab === 'tenants' && (
        <div
          className="rounded-xl overflow-hidden border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead
                className="text-xs uppercase border-b"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                <tr>
                  <th className="py-3 px-4">Tenant Name</th>
                  <th className="py-3 px-4">Slug / Identifier</th>
                  <th className="py-3 px-4 text-center">Users</th>
                  <th className="py-3 px-4 text-center">Customers</th>
                  <th className="py-3 px-4 text-center">Invoices</th>
                  <th className="py-3 px-4 text-center">Payments</th>
                  <th className="py-3 px-4">Provisioned</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 font-medium text-white">{t.name}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/10 text-gray-300">
                        {t.slug}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-300">
                      {t.stats?.userCount ?? 0}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-300">
                      {t.stats?.customerCount ?? 0}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-300">
                      {t.stats?.invoiceCount ?? 0}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-gray-300">
                      {t.stats?.paymentCount ?? 0}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      No tenants found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Table */}
      {activeTab === 'users' && (
        <div
          className="rounded-xl overflow-hidden border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead
                className="text-xs uppercase border-b"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                <tr>
                  <th className="py-3 px-4">Name & Email</th>
                  <th className="py-3 px-4">Tenant</th>
                  <th className="py-3 px-4">Current Role</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{u.name}</div>
                      <div className="text-xs text-gray-400">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-gray-200">{u.tenant?.name || 'N/A'}</div>
                      <span className="font-mono text-[10px] text-gray-400">
                        {u.tenant?.slug || u.tenantId}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChange(
                            u.id,
                            e.target.value as 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT',
                          )
                        }
                        className="text-xs rounded px-2 py-1 font-semibold border bg-transparent"
                        style={{
                          borderColor: 'var(--border)',
                          color:
                            u.role === 'SUPER_ADMIN'
                              ? '#ef4444'
                              : u.role === 'ADMIN'
                              ? '#3b82f6'
                              : u.role === 'MANAGER'
                              ? '#10b981'
                              : '#a855f7',
                        }}
                      >
                        <option value="SUPER_ADMIN" className="bg-gray-900 text-red-400">
                          SUPER_ADMIN
                        </option>
                        <option value="ADMIN" className="bg-gray-900 text-blue-400">
                          ADMIN
                        </option>
                        <option value="MANAGER" className="bg-gray-900 text-emerald-400">
                          MANAGER
                        </option>
                        <option value="AGENT" className="bg-gray-900 text-purple-400">
                          AGENT
                        </option>
                      </select>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                          u.isActive
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950/60 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleStatusToggle(u.id, u.isActive)}
                        className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                          u.isActive
                            ? 'border-rose-800/60 text-rose-400 hover:bg-rose-900/30'
                            : 'border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/30'
                        }`}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      No platform users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Provision Tenant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="rounded-xl border max-w-md w-full p-6 space-y-4 shadow-2xl"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Provision New Tenant</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Tenant Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Corporation"
                  value={tenantName}
                  onChange={(e) => {
                    setTenantName(e.target.value)
                    if (!tenantSlug) {
                      setTenantSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, ''),
                      )
                    }
                  }}
                  className="w-full text-sm px-3 py-2 rounded-lg border bg-black/30 text-white focus:outline-none focus:border-indigo-500"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Tenant Slug (Unique Subdomain / ID)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. acme-corp"
                  value={tenantSlug}
                  onChange={(e) =>
                    setTenantSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-_]/g, ''),
                    )
                  }
                  className="w-full text-sm px-3 py-2 rounded-lg border bg-black/30 text-white font-mono focus:outline-none focus:border-indigo-500"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm rounded-lg border text-gray-300 hover:text-white"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingTenant}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white"
                  style={{ background: 'var(--primary)' }}
                >
                  {creatingTenant ? 'Provisioning...' : 'Provision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
