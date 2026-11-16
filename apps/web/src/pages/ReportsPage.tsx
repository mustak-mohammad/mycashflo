import { useState, useCallback, useEffect } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { useApi } from '../hooks/useApi'
import { reportsApi } from '../api/reports'
import { customersApi } from '../api/customers'
import { useToast } from '../store/ToastContext'
import { extractSafeApiError, extractSafeErrorMessage } from '../utils/safeError'
import type { Customer, LedgerResponse, LedgerEntry } from '../types'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDec(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className ?? ''}`} style={{ background: 'var(--surface-2, #1e293b)' }} />
}

export default function ReportsPage() {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'overview' | 'ledger'>('overview')

  // Overview stats fetchers
  const ageingFetcher = useCallback(() => reportsApi.getAgeing(), [])
  const summaryFetcher = useCallback(() => reportsApi.getSummary(), [])

  const { data: ageing, loading: ageingLoading, error: ageingError } = useApi(ageingFetcher)
  const { data: summary, loading: summaryLoading } = useApi(summaryFetcher)

  // Customer Ledger state
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customersError, setCustomersError] = useState<string | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [ledgerData, setLedgerData] = useState<LedgerResponse | null>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'xlsx' | null>(null)

  // Load customer options
  useEffect(() => {
    customersApi
      .list({ limit: 100 })
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data || []
        setCustomers(list)
        setCustomersError(null)
      })
      .catch((err) => {
        setCustomersError(extractSafeErrorMessage(err, 'Failed to load customer filter options.'))
      })
  }, [])

  // Fetch Ledger data
  const loadLedger = useCallback(async () => {
    try {
      setLedgerLoading(true)
      setLedgerError(null)
      const data = await reportsApi.getLedger({
        customerId: selectedCustomerId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      })
      setLedgerData(data)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to load customer general ledger.')
      setLedgerError(msg)
      toast.error(msg)
    } finally {
      setLedgerLoading(false)
    }
  }, [selectedCustomerId, startDate, endDate, toast])

  useEffect(() => {
    if (activeTab === 'ledger') {
      loadLedger()
    }
  }, [activeTab, loadLedger])

  const handleDownload = async (format: 'csv' | 'xlsx') => {
    try {
      setExportingFormat(format)
      setLedgerError(null)
      await reportsApi.downloadLedger({
        customerId: selectedCustomerId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        format,
      })
      toast.success(`Customer ledger exported as ${format.toUpperCase()}.`)
    } catch (err: unknown) {
      const msg = await extractSafeApiError(err, 'Failed to export ledger statement.')
      setLedgerError(msg)
      toast.error(msg)
    } finally {
      setExportingFormat(null)
    }
  }

  const handleResetFilters = () => {
    setSelectedCustomerId('')
    setStartDate('')
    setEndDate('')
  }

  const loading = ageingLoading || summaryLoading

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <PageHeader
          title="Financial Reports & Statements"
          subtitle="Receivables ageing, KPIs, and customer running-balance accounting ledgers"
        />

        {/* Tab Switcher */}
        <div
          className="flex p-1 rounded-xl shrink-0"
          style={{ background: 'var(--surface, #111827)', border: '1px solid var(--border)' }}
        >
          <button
            onClick={() => setActiveTab('overview')}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: activeTab === 'overview' ? 'var(--primary, #3b82f6)' : 'transparent',
              color: activeTab === 'overview' ? '#ffffff' : 'var(--text-muted, #94a3b8)',
            }}
          >
            📊 Performance & Ageing
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: activeTab === 'ledger' ? 'var(--primary, #3b82f6)' : 'transparent',
              color: activeTab === 'ledger' ? '#ffffff' : 'var(--text-muted, #94a3b8)',
            }}
          >
            📑 Customer Ledger & Downloads
          </button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
            ) : (
              <>
                <StatCard label="Total Billed" value={fmt(summary?.totalBilled ?? 0)} icon="📄" color="var(--primary)" />
                <StatCard label="Total Collected" value={fmt(summary?.totalCollected ?? 0)} icon="✅" color="var(--accent)" />
                <StatCard label="Total Overdue" value={fmt(summary?.totalOverdue ?? 0)} icon="⚠️" color="var(--danger)" />
                <StatCard label="Collection Rate" value={`${summary?.collectionRate ?? 0}%`} icon="📊" color="var(--warning)" />
              </>
            )}
          </div>

          {/* Ageing table */}
          <div className="rounded-xl overflow-hidden mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold text-white">Receivables Ageing</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Days past due — overdue invoices only</p>
            </div>

            {ageingError && (
              <div className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>⚠️ {ageingError}</div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['0–30 days', '31–60 days', '61–90 days', '90+ days', 'Total'].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {ageingLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <td key={i} className="px-5 py-3.5">
                          <div className="h-5 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '80px' }} />
                        </td>
                      ))
                    ) : (
                      [ageing?.d0_30, ageing?.d31_60, ageing?.d61_90, ageing?.d90plus, ageing?.total].map((v, i) => (
                        <td key={i} className="px-5 py-3.5 text-white font-semibold">{fmt(v ?? 0)}</td>
                      ))
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Extra summary stats */}
          {!summaryLoading && summary && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard label="Open Invoices" value={summary.openInvoices} icon="🧾" color="var(--primary)" />
              <StatCard label="Overdue Customers" value={summary.overdueCustomers} icon="👥" color="var(--danger)" />
              <StatCard label="This Month Received" value={fmt(summary.collectedThisMonth)} icon="💰" color="var(--accent)" />
            </div>
          )}
        </>
      )}

      {activeTab === 'ledger' && (
        <div>
          {(ledgerError || customersError) && (
            <div
              role="alert"
              className="rounded-lg px-4 py-3 text-sm mb-4 flex items-center justify-between gap-3"
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
              }}
            >
              <span>⚠️ {ledgerError || customersError}</span>
              {ledgerError && (
                <button
                  type="button"
                  onClick={loadLedger}
                  className="px-3 py-1 rounded text-xs font-semibold bg-rose-800 hover:bg-rose-700 text-white cursor-pointer"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Ledger Filters & Download Bar */}
          <div
            className="p-5 rounded-xl mb-6"
            style={{ background: 'var(--surface, #111827)', border: '1px solid var(--border)' }}
          >
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              {/* Filter controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    Filter Customer
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full text-xs rounded-lg px-3 py-2"
                    style={{
                      background: 'var(--surface-2, #1f2937)',
                      color: 'var(--text, #f9fafb)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <option value="">All Customers (Consolidated)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.company ? `(${c.company})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    From Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-xs rounded-lg px-3 py-2"
                    style={{
                      background: 'var(--surface-2, #1f2937)',
                      color: 'var(--text, #f9fafb)',
                      border: '1px solid var(--border)',
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    To Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full text-xs rounded-lg px-3 py-2"
                    style={{
                      background: 'var(--surface-2, #1f2937)',
                      color: 'var(--text, #f9fafb)',
                      border: '1px solid var(--border)',
                    }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {(selectedCustomerId || startDate || endDate) && (
                  <button
                    onClick={handleResetFilters}
                    className="px-3 py-2 rounded-lg text-xs font-medium"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  >
                    Reset
                  </button>
                )}
                <button
                  onClick={loadLedger}
                  disabled={ledgerLoading}
                  className="px-4 py-2 rounded-lg text-xs font-semibold"
                  style={{
                    background: 'var(--surface-2, #374151)',
                    color: '#ffffff',
                    border: '1px solid var(--border)',
                  }}
                >
                  {ledgerLoading ? 'Loading...' : '🔍 Filter'}
                </button>
                <button
                  onClick={() => handleDownload('csv')}
                  disabled={exportingFormat === 'csv'}
                  className="px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                  style={{
                    background: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    cursor: exportingFormat === 'csv' ? 'wait' : 'pointer',
                  }}
                >
                  <span>📥</span>
                  {exportingFormat === 'csv' ? 'Generating...' : 'Export CSV'}
                </button>
                <button
                  onClick={() => handleDownload('xlsx')}
                  disabled={exportingFormat === 'xlsx'}
                  className="px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    cursor: exportingFormat === 'xlsx' ? 'wait' : 'pointer',
                  }}
                >
                  <span>📊</span>
                  {exportingFormat === 'xlsx' ? 'Generating...' : 'Export Excel (.xls)'}
                </button>
              </div>
            </div>
          </div>

          {/* Ledger Financial Summary Cards */}
          {ledgerData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Opening Balance</span>
                <div className="text-base font-bold text-white mt-1">
                  {fmtDec(ledgerData.summary.openingBalance)}
                </div>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Invoiced (Debits)</span>
                <div className="text-base font-bold text-amber-400 mt-1">
                  +{fmtDec(ledgerData.summary.totalDebits)}
                </div>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Settled (Credits)</span>
                <div className="text-base font-bold text-emerald-400 mt-1">
                  -{fmtDec(ledgerData.summary.totalCredits)}
                </div>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Net Running Balance</span>
                <div className="text-base font-bold text-blue-400 mt-1">
                  {fmtDec(ledgerData.summary.netBalance)}
                </div>
              </div>
            </div>
          )}

          {/* Running Balance Timeline Table */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="text-sm font-semibold text-white">Customer General Ledger</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Chronological debits (invoices) and credits (receipts) with running balance calculation
                </p>
              </div>
              {ledgerData && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                  {ledgerData.summary.entryCount} entries
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <th className="px-4 py-3 font-semibold text-gray-400 uppercase">Date</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 uppercase">Reference</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 uppercase">Type</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 uppercase">Customer</th>
                    <th className="px-4 py-3 font-semibold text-gray-400 uppercase">Description</th>
                    <th className="px-4 py-3 font-semibold text-right text-gray-400 uppercase">Debit (₹)</th>
                    <th className="px-4 py-3 font-semibold text-right text-gray-400 uppercase">Credit (₹)</th>
                    <th className="px-4 py-3 font-semibold text-right text-gray-400 uppercase">Balance (₹)</th>
                    <th className="px-4 py-3 font-semibold text-center text-gray-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {ledgerLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={9} className="px-4 py-3">
                          <Skeleton className="h-6 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : !ledgerData || ledgerData.data.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                        No financial transactions found for the selected period or customer.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {ledgerData.summary.openingBalance !== 0 && (
                        <tr style={{ background: 'rgba(255, 255, 255, 0.015)' }}>
                          <td className="px-4 py-3 text-gray-400">{startDate || '—'}</td>
                          <td className="px-4 py-3 text-gray-400 font-mono">OPENING_BAL</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-800 text-gray-300">
                              BALANCE
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-300 font-medium">Brought Forward</td>
                          <td className="px-4 py-3 text-gray-400 italic">Balance prior to {startDate}</td>
                          <td className="px-4 py-3 text-right text-gray-400">—</td>
                          <td className="px-4 py-3 text-right text-gray-400">—</td>
                          <td className="px-4 py-3 text-right font-semibold text-white">
                            {fmtDec(ledgerData.summary.openingBalance)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-[10px] text-gray-400">SETTLED</span>
                          </td>
                        </tr>
                      )}
                      {ledgerData.data.map((item: LedgerEntry) => (
                        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{item.date.slice(0, 10)}</td>
                          <td className="px-4 py-3 font-mono text-gray-200">{item.ref}</td>
                          <td className="px-4 py-3">
                            {item.type === 'INVOICE' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                INVOICE
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                PAYMENT
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">{item.customerName}</td>
                          <td className="px-4 py-3 text-gray-400 max-w-xs truncate" title={item.description}>
                            {item.description}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-amber-400">
                            {item.debit > 0 ? fmtDec(item.debit) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-emerald-400">
                            {item.credit > 0 ? fmtDec(item.credit) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-white">
                            {fmtDec(item.runningBalance)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-[10px] text-gray-400 uppercase font-mono">{item.status}</span>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
