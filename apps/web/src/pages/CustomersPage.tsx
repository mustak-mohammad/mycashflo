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
  const limit = 20

  const fetcher = useCallback(
    () => customersApi.list({ page, limit, search: search || undefined }),
    [page, search],
  )
  const { data, loading, error } = useApi(fetcher)

  const totalPages = data ? Math.ceil(data.total / limit) : 1

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Customers"
        subtitle={`${data?.total ?? '…'} total customer accounts`}
      />

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Search */}
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
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
                {['Name', 'Email', 'Phone', 'Outstanding', 'Status'].map((h) => (
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
                  <td colSpan={5} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {search ? `No customers match "${search}"` : 'No customers yet.'}
                  </td>
                </tr>
              ) : (
                data.data.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3.5 text-white font-medium">{c.name}</td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{c.email}</td>
                    <td className="px-5 py-3.5" style={{ color: 'var(--text-muted)' }}>{c.phone}</td>
                    <td className="px-5 py-3.5 text-white font-semibold">
                      {c.outstandingBalance > 0 ? fmt(c.outstandingBalance) : '—'}
                    </td>
                    <td className="px-5 py-3.5">{statusBadge(c.status)}</td>
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
    </div>
  )
}
