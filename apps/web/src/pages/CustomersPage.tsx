import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { customersApi } from '../api/customers'
import type { Customer } from '../types'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function statusBadge(status: Customer['status']) {
  const s = status === 'INACTIVE'
    ? { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: 'Inactive' }
    : { bg: 'rgba(16,185,129,0.12)',  color: 'var(--accent)',     label: 'Active' }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '70%' }} />
        </td>
      ))}
    </tr>
  )
}

export default function CustomersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const limit = 20

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formCompany, setFormCompany] = useState('')
  const [formReference, setFormReference] = useState('')
  const [formGstin, setFormGstin] = useState('')
  const [formAddress, setFormAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const fetcher = useCallback(
    () => customersApi.list({ page, limit, search: search || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, search, refreshKey],
  )
  const { data, loading, error } = useApi(fetcher)

  const totalPages = data ? Math.ceil(data.total / limit) : 1

  function handleOpenCreate() {
    setEditingCustomer(null)
    setFormName('')
    setFormPhone('')
    setFormEmail('')
    setFormCompany('')
    setFormReference('')
    setFormGstin('')
    setFormAddress('')
    setFormError(null)
    setIsModalOpen(true)
  }

  function handleOpenEdit(c: Customer) {
    setEditingCustomer(c)
    setFormName(c.name)
    setFormPhone(c.phone)
    setFormEmail(c.email || '')
    setFormCompany(c.company || '')
    setFormReference((c as any).customerReference || '')
    setFormGstin((c as any).gstNumber || '')
    setFormAddress((c as any).billingAddress || '')
    setFormError(null)
    setIsModalOpen(true)
  }

  async function handleSaveCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim() || !formPhone.trim()) {
      setFormError('Name and phone number are required.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (editingCustomer) {
        await customersApi.update(editingCustomer.id, {
          name: formName.trim(),
          phone: formPhone.trim(),
          email: formEmail.trim() || undefined,
          company: formCompany.trim() || undefined,
          customerReference: formReference.trim() || undefined,
          gstNumber: formGstin.trim().toUpperCase() || undefined,
          billingAddress: formAddress.trim() || undefined,
        })
      } else {
        await customersApi.create({
          name: formName.trim(),
          phone: formPhone.trim(),
          email: formEmail.trim() || undefined,
          company: formCompany.trim() || undefined,
          customerReference: formReference.trim() || undefined,
          gstNumber: formGstin.trim().toUpperCase() || undefined,
          billingAddress: formAddress.trim() || undefined,
        })
      }
      setIsModalOpen(false)
      setRefreshKey((k) => k + 1)
    } catch (err: any) {
      const msg = err.response?.data?.message
        ? Array.isArray(err.response.data.message)
          ? err.response.data.message.join(' • ')
          : String(err.response.data.message)
        : err.message || 'Failed to save customer.'
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Customers"
        subtitle={`${data?.total ?? '…'} total customer accounts`}
        action={
          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer"
          >
            + Add Customer
          </button>
        }
      />

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Search */}
        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <input
            type="search"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg text-sm text-white w-full max-w-xs outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
          {loading && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</span>}
        </div>

        {error && (
          <div className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>
            ⚠️ {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name & Ref', 'Contact Details', 'Company & GSTIN', 'Outstanding', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)
              ) : !data?.data?.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {search ? `No customers match "${search}"` : 'No customers yet.'}
                  </td>
                </tr>
              ) : (
                data.data.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3.5">
                      <div className="text-white font-medium">{c.name}</div>
                      {(c as any).customerReference && (
                        <div className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {(c as any).customerReference}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>
                      <div>{c.phone}</div>
                      {c.email && <div className="text-xs">{c.email}</div>}
                    </td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>
                      <div>{c.company || '—'}</div>
                      {(c as any).gstNumber && (
                        <div className="text-[10px] font-mono text-indigo-400">{(c as any).gstNumber}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-white font-semibold">
                      {c.outstandingBalance > 0 ? fmt(c.outstandingBalance) : '—'}
                    </td>
                    <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(c)}
                        className="px-2.5 py-1 text-xs rounded hover:bg-white/10 text-indigo-300 hover:text-white cursor-pointer"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > limit && (
          <div className="px-5 py-3 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <span>Page {page} of {totalPages} · {data.total} customers</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded text-xs disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >← Prev</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded text-xs disabled:opacity-40 cursor-pointer"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div
            className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}
          >
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  ⚠️ {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-white/70 mb-1">Customer / Business Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Apex Infotech"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="billing@apex.in"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Company / Organization</label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="Apex Group"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-white/70 mb-1">Customer Reference / Code</label>
                  <input
                    type="text"
                    value={formReference}
                    onChange={(e) => setFormReference(e.target.value)}
                    placeholder="CUST-APX-01"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-white/70 mb-1">GSTIN Number</label>
                  <input
                    type="text"
                    value={formGstin}
                    onChange={(e) => setFormGstin(e.target.value.toUpperCase())}
                    placeholder="27AABCU9603R1ZM"
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-white/70 mb-1">Billing Address</label>
                  <textarea
                    rows={2}
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="Plot 12, MIDC Industrial Area..."
                    className="w-full p-2.5 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
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
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
