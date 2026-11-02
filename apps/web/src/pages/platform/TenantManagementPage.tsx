import { useState, useEffect } from 'react'
import {
  getPlatformTenants,
  createPlatformTenant,
  updatePlatformTenantStatus,
  type PlatformTenant,
} from '../../api/platform'

export default function TenantManagementPage() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Provisioning Modal State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Confirmation Modal State (Suspend / Activate)
  const [confirmTarget, setConfirmTarget] = useState<{
    tenant: PlatformTenant
    nextState: boolean
  } | null>(null)
  const [processingStatus, setProcessingStatus] = useState(false)

  // Details Modal
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenant | null>(null)

  const loadTenants = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPlatformTenants()
      setTenants(data)
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load tenant directory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTenants()
  }, [])

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || !newSlug.trim()) return

    setSubmitting(true)
    setActionMsg(null)
    try {
      await createPlatformTenant({
        name: newName.trim(),
        slug: newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      })
      setActionMsg({ type: 'success', text: `Tenant '${newName}' provisioned successfully` })
      setNewName('')
      setNewSlug('')
      setShowCreateModal(false)
      await loadTenants()
    } catch (err: any) {
      setActionMsg({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to provision tenant',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async () => {
    if (!confirmTarget) return

    setProcessingStatus(true)
    setActionMsg(null)
    try {
      await updatePlatformTenantStatus(confirmTarget.tenant.id, confirmTarget.nextState)
      setActionMsg({
        type: 'success',
        text: `Tenant '${confirmTarget.tenant.name}' ${
          confirmTarget.nextState ? 'activated' : 'suspended'
        } successfully`,
      })
      setConfirmTarget(null)
      await loadTenants()
    } catch (err: any) {
      setActionMsg({
        type: 'error',
        text: err?.response?.data?.message || err?.message || 'Failed to update tenant status',
      })
    } finally {
      setProcessingStatus(false)
    }
  }

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()),
  )

  const totalTenants = tenants.length
  const activeTenants = tenants.filter((t) => (t.stats.activeUserCount ?? 1) > 0).length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Tenant Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Provision, monitor, and govern isolated enterprise tenant workspaces.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadTenants()}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span>🔄</span> Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-md flex items-center gap-2 cursor-pointer"
          >
            <span>➕</span> Provision New Tenant
          </button>
        </div>
      </div>

      {/* Action alerts */}
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Total Workspaces</div>
          <div className="text-2xl font-bold text-white mt-1">{totalTenants}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Isolated schemas & tenants</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Active Tenants</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{activeTenants}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">With active user credentials</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111927]">
          <div className="text-xs text-slate-400 font-medium">Suspended / Inactive</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{totalTenants - activeTenants}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Suspended or unprovisioned</div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111927] overflow-hidden">
        {/* Search & Filters */}
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search by company or slug..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 pl-9 rounded-lg text-xs bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
            <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
          </div>
          <div className="text-xs text-slate-400">
            Showing <span className="font-semibold text-slate-200">{filteredTenants.length}</span> of{' '}
            <span className="font-semibold text-slate-200">{totalTenants}</span> tenants
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">
            <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading tenant directory...
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No tenants match your search filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Organization</th>
                  <th className="py-3 px-4">Slug Identifier</th>
                  <th className="py-3 px-4">Users</th>
                  <th className="py-3 px-4">Activity (Invoices/Payments)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Provisioned</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {filteredTenants.map((t) => {
                  const isSuspended =
                    t.stats.userCount > 0 && (t.stats.activeUserCount ?? 1) === 0
                  const hasNoUsers = t.stats.userCount === 0

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-white">
                        {t.name}
                      </td>
                      <td className="py-3.5 px-4">
                        <code className="text-sky-300 bg-sky-950/40 border border-sky-900/50 px-1.5 py-0.5 rounded font-mono text-[11px]">
                          {t.slug}
                        </code>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-slate-200">
                          {t.stats.activeUserCount ?? t.stats.userCount}
                        </span>
                        <span className="text-slate-500"> / {t.stats.userCount} active</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {t.stats.invoiceCount} invoices · {t.stats.paymentCount} payments
                      </td>
                      <td className="py-3.5 px-4">
                        {isSuspended ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-950/80 border border-rose-800 text-rose-300">
                            Suspended
                          </span>
                        ) : hasNoUsers ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-800 text-slate-400">
                            Provisioned
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-950/80 border border-emerald-800 text-emerald-300">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => setSelectedTenant(t)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer text-[11px]"
                        >
                          Inspect
                        </button>
                        {!hasNoUsers && (
                          <button
                            onClick={() =>
                              setConfirmTarget({
                                tenant: t,
                                nextState: isSuspended ? true : false,
                              })
                            }
                            className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] font-semibold ${
                              isSuspended
                                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/60 hover:bg-emerald-900/70'
                                : 'bg-rose-950/40 text-rose-300 border border-rose-800/60 hover:bg-rose-900/60'
                            }`}
                          >
                            {isSuspended ? 'Activate' : 'Suspend'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Provisioning Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white">Provision New Organization</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Logistics India"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value)
                    if (!newSlug || newSlug === newName.toLowerCase().replace(/[^a-z0-9]/g, '')) {
                      setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tenant Slug (Unique Subdomain / ID)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. acme-logistics"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-900 border border-slate-700 text-sky-400 focus:outline-none focus:border-sky-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Used for tenant scoping and subdomains. Lowercase letters, numbers, hyphens.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
                >
                  {submitting ? 'Provisioning...' : 'Provision Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog (Suspend / Activate) */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">
                {confirmTarget.nextState ? '🟢' : '⚠️'}
              </span>
              <h3 className="text-base font-bold text-white">
                {confirmTarget.nextState ? 'Activate Tenant Access' : 'Suspend Tenant Access'}
              </h3>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Are you sure you want to {confirmTarget.nextState ? 'activate' : 'suspend'}{' '}
              <span className="font-bold text-white">{confirmTarget.tenant.name}</span> (slug:{' '}
              <code className="text-red-400">{confirmTarget.tenant.slug}</code>)?
              {!confirmTarget.nextState
                ? ' All users in this tenant will have their credentials deactivated immediately. Historical data and invoices remain safe.'
                : ' All user accounts associated with this tenant will be reactivated.'}
            </p>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={processingStatus}
                className={`px-4 py-2 text-xs font-bold rounded-lg text-white transition-colors cursor-pointer ${
                  confirmTarget.nextState
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {processingStatus
                  ? 'Updating...'
                  : confirmTarget.nextState
                  ? 'Confirm Activation'
                  : 'Confirm Suspension'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Tenant Details Drawer / Modal */}
      {selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111927] border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{selectedTenant.name}</h3>
                <div className="text-xs text-slate-400 font-mono">ID: {selectedTenant.id}</div>
              </div>
              <button
                onClick={() => setSelectedTenant(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Total Users</div>
                  <div className="text-lg font-bold text-white mt-1">
                    {selectedTenant.stats.userCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Total Customers</div>
                  <div className="text-lg font-bold text-white mt-1">
                    {selectedTenant.stats.customerCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Invoices Generated</div>
                  <div className="text-lg font-bold text-white mt-1">
                    {selectedTenant.stats.invoiceCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Recorded Payments</div>
                  <div className="text-lg font-bold text-white mt-1">
                    {selectedTenant.stats.paymentCount}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <div className="text-slate-400 mb-1">Provisioning Timestamp</div>
                <div className="text-slate-200">
                  {new Date(selectedTenant.createdAt).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedTenant(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

