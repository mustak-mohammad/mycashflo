import { useState, useCallback } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useApi } from '../hooks/useApi'
import { customersApi } from '../api/customers'
import { callsApi } from '../api/calls'
import { voiceApi } from '../api/voice'
import { invoicesApi } from '../api/invoices'
import { useAuth } from '../store/AuthContext'
import { useToast } from '../store/ToastContext'
import { extractSafeApiError, extractSafeErrorMessage } from '../utils/safeError'
import type { Customer, DocumentDeliveryRequest, ConsentState } from '../types'

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

function consentBadge(channel: 'Email' | 'WhatsApp' | 'SMS' | 'Voice', consent?: ConsentState) {
  if (consent === 'OPTED_IN') {
    return (
      <span
        key={channel}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/80"
        title={`${channel}: Opted in (Consent granted)`}
      >
        <span className="text-[9px]">✓</span> {channel}
      </span>
    )
  }
  if (consent === 'OPTED_OUT') {
    return (
      <span
        key={channel}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-950/70 text-rose-300 border border-rose-800/80"
        title={`${channel}: Opted out (Cease contact)`}
      >
        <span className="text-[9px]">✕</span> {channel}
      </span>
    )
  }
  return (
    <span
      key={channel}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700/80"
      title={`${channel}: Unknown consent (Outreach suppressed)`}
    >
      <span className="text-[9px]">?</span> {channel}
    </span>
  )
}

function Skeleton() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded animate-pulse" style={{ background: 'var(--surface-2)', width: '70%' }} />
        </td>
      ))}
    </tr>
  )
}

export default function CustomersPage() {
  const { user } = useAuth()
  const canManageCustomers = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
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
  const [formEmailConsent, setFormEmailConsent] = useState<ConsentState>('UNKNOWN')
  const [formWhatsappConsent, setFormWhatsappConsent] = useState<ConsentState>('UNKNOWN')
  const [formSmsConsent, setFormSmsConsent] = useState<ConsentState>('UNKNOWN')
  const [formVoiceConsent, setFormVoiceConsent] = useState<ConsentState>('UNKNOWN')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Customer Document Deliveries Modal State
  const [activeDeliveriesCustomer, setActiveDeliveriesCustomer] = useState<Customer | null>(null)
  const [customerDeliveryRequests, setCustomerDeliveryRequests] = useState<DocumentDeliveryRequest[]>([])
  const [loadingCustomerDeliveries, setLoadingCustomerDeliveries] = useState(false)
  const [customerDeliveriesError, setCustomerDeliveriesError] = useState<string | null>(null)
  const [copiedCustomerLinkId, setCopiedCustomerLinkId] = useState<string | null>(null)
  const [downloadingCustPdfId, setDownloadingCustPdfId] = useState<string | null>(null)
  const [callTarget, setCallTarget] = useState<Customer | null>(null)
  const [callReason, setCallReason] = useState('Payment follow-up')
  const [callSubmitting, setCallSubmitting] = useState(false)
  const [callFeedback, setCallFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const handleOpenCustomerDeliveries = async (customer: Customer) => {
    setActiveDeliveriesCustomer(customer)
    setLoadingCustomerDeliveries(true)
    setCustomerDeliveriesError(null)
    try {
      const res = await voiceApi.getDocumentDeliveryRequests({ customerId: customer.id })
      setCustomerDeliveryRequests(res.data || [])
    } catch (err: any) {
      setCustomerDeliveriesError(err?.message || 'Failed to load customer delivery activity')
    } finally {
      setLoadingCustomerDeliveries(false)
    }
  }

  function handleOpenCall(customer: Customer) {
    setCallTarget(customer)
    setCallReason('Payment follow-up')
    setCallFeedback(null)
  }

  async function handleStartSimulatedCall() {
    if (!callTarget) return
    setCallSubmitting(true)
    setCallFeedback(null)
    try {
      const result = await callsApi.initiateOutbound({
        customerId: callTarget.id,
        reason: callReason.trim() || 'Payment follow-up',
      })
      const session = result.sessionId ? ` Session ${String(result.sessionId).slice(0, 8)} was created.` : ''
      setCallFeedback({
        kind: 'success',
        message: result.isSimulated
          ? `Chotu simulation started for ${callTarget.name}.${session} No customer was called.`
          : `Call request accepted for ${callTarget.name}.${session}`,
      })
      setRefreshKey((key) => key + 1)
    } catch (err: any) {
      const message = err.response?.data?.message
      setCallFeedback({
        kind: 'error',
        message: Array.isArray(message)
          ? message.join(' • ')
          : String(message || err.message || 'Unable to start the call simulation.'),
      })
    } finally {
      setCallSubmitting(false)
    }
  }

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
    setFormEmailConsent('UNKNOWN')
    setFormWhatsappConsent('UNKNOWN')
    setFormSmsConsent('UNKNOWN')
    setFormVoiceConsent('UNKNOWN')
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
    setFormEmailConsent(c.emailConsent || 'UNKNOWN')
    setFormWhatsappConsent(c.whatsappConsent || 'UNKNOWN')
    setFormSmsConsent(c.smsConsent || 'UNKNOWN')
    setFormVoiceConsent(c.voiceConsent || 'UNKNOWN')
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
        const consentPayload: any = {}
        if (formEmailConsent !== (editingCustomer.emailConsent || 'UNKNOWN')) {
          consentPayload.emailConsent = formEmailConsent
        }
        if (formWhatsappConsent !== (editingCustomer.whatsappConsent || 'UNKNOWN')) {
          consentPayload.whatsappConsent = formWhatsappConsent
        }
        if (formSmsConsent !== (editingCustomer.smsConsent || 'UNKNOWN')) {
          consentPayload.smsConsent = formSmsConsent
        }
        if (formVoiceConsent !== (editingCustomer.voiceConsent || 'UNKNOWN')) {
          consentPayload.voiceConsent = formVoiceConsent
        }

        await customersApi.update(editingCustomer.id, {
          name: formName.trim(),
          phone: formPhone.trim(),
          email: formEmail.trim() || undefined,
          company: formCompany.trim() || undefined,
          customerReference: formReference.trim() || undefined,
          gstNumber: formGstin.trim().toUpperCase() || undefined,
          billingAddress: formAddress.trim() || undefined,
          ...consentPayload,
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
          emailConsent: formEmailConsent,
          whatsappConsent: formWhatsappConsent,
          smsConsent: formSmsConsent,
          voiceConsent: formVoiceConsent,
        })
      }
      toast.success(editingCustomer ? 'Customer updated.' : 'Customer added.')
      setIsModalOpen(false)
      setRefreshKey((k) => k + 1)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to save customer.')
      setFormError(msg)
      toast.error(msg)
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
          canManageCustomers ? (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm transition-colors cursor-pointer"
            >
              + Add Customer
            </button>
          ) : undefined
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

        {(error || actionError) && (
          <div role="alert" className="px-5 py-3 text-sm" style={{ color: 'var(--danger)' }}>
            ⚠️ {actionError || error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name & Ref', 'Contact Details', 'Consent Preferences', 'Company & GSTIN', 'Outstanding', 'Status', 'Actions'].map((h) => (
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
                  <td colSpan={7} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
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
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1 items-center">
                        {consentBadge('Email', c.emailConsent)}
                        {consentBadge('WhatsApp', c.whatsappConsent)}
                        {consentBadge('SMS', c.smsConsent)}
                        {consentBadge('Voice', c.voiceConsent)}
                      </div>
                      {c.notes && (c.notes.includes('DND') || c.notes.includes('NO_CONTACT') || c.notes.includes('OPT_OUT')) && (
                        <div className="mt-1">
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-950/60 text-amber-300 border border-amber-800/60"
                            title={c.notes}
                          >
                            Legacy DND
                          </span>
                        </div>
                      )}
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
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenCall(c)}
                          disabled={c.status === 'INACTIVE' || c.voiceConsent !== 'OPTED_IN'}
                          title={c.voiceConsent !== 'OPTED_IN'
                            ? 'Voice consent is required before initiating an outbound call'
                            : c.status === 'INACTIVE'
                              ? 'Inactive customers cannot be called'
                              : `Start Chotu simulation for ${c.name}`}
                          className="px-2.5 py-1 text-xs rounded font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        >
                          ☎ Call Chotu
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCustomerDeliveries(c)}
                          title="View customer invoice & payment-link delivery history"
                          className="px-2.5 py-1 text-xs rounded font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer flex items-center gap-1 transition-colors"
                        >
                          <span>📬</span> Deliveries
                        </button>
                        {canManageCustomers && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(c)}
                            className="px-2.5 py-1 text-xs rounded hover:bg-white/10 text-indigo-300 hover:text-white cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                      </div>
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
      {canManageCustomers && isModalOpen && (
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

                <div className="col-span-2 pt-3 border-t border-white/10">
                  <div className="text-white/90 font-medium mb-1 flex items-center justify-between">
                    <span>Communication Channel Consent</span>
                    <span className="text-[10px] text-amber-400 font-normal">
                      Role-restricted (Admin/Manager)
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 mb-3">
                    Outreach is suppressed when state is <strong>UNKNOWN</strong> or <strong>OPTED_OUT</strong>. Explicit opt-in is required for outreach.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className="block text-white/70 mb-1">Email Consent</label>
                      <select
                        value={formEmailConsent}
                        onChange={(e) => setFormEmailConsent(e.target.value as ConsentState)}
                        className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN (Suppressed)</option>
                        <option value="OPTED_IN">OPTED_IN (Consent Granted)</option>
                        <option value="OPTED_OUT">OPTED_OUT (Cease Contact)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-white/70 mb-1">WhatsApp Consent</label>
                      <select
                        value={formWhatsappConsent}
                        onChange={(e) => setFormWhatsappConsent(e.target.value as ConsentState)}
                        className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN (Suppressed)</option>
                        <option value="OPTED_IN">OPTED_IN (Consent Granted)</option>
                        <option value="OPTED_OUT">OPTED_OUT (Cease Contact)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-white/70 mb-1">SMS Consent</label>
                      <select
                        value={formSmsConsent}
                        onChange={(e) => setFormSmsConsent(e.target.value as ConsentState)}
                        className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN (Suppressed)</option>
                        <option value="OPTED_IN">OPTED_IN (Consent Granted)</option>
                        <option value="OPTED_OUT">OPTED_OUT (Cease Contact)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-white/70 mb-1">Voice Consent</label>
                      <select
                        value={formVoiceConsent}
                        onChange={(e) => setFormVoiceConsent(e.target.value as ConsentState)}
                        className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:border-indigo-500 text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN (Suppressed)</option>
                        <option value="OPTED_IN">OPTED_IN (Consent Granted)</option>
                        <option value="OPTED_OUT">OPTED_OUT (Cease Contact)</option>
                      </select>
                    </div>
                  </div>
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

      {/* Customer Document Delivery Activity Modal */}
      {activeDeliveriesCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>📬</span> Document Delivery Activity: {activeDeliveriesCustomer.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Phone: <strong className="text-white font-mono">{activeDeliveriesCustomer.phone}</strong> • Email: <strong className="text-white">{activeDeliveriesCustomer.email || '—'}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                  <span>🧪</span> Simulation Mode
                </span>
                <button
                  onClick={() => setActiveDeliveriesCustomer(null)}
                  className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300">
              {customerDeliveriesError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300">
                  ⚠️ {customerDeliveriesError}
                </div>
              )}

              {loadingCustomerDeliveries ? (
                <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
                  <div className="animate-spin text-2xl">⏳</div>
                  <div>Loading customer delivery activity…</div>
                </div>
              ) : customerDeliveryRequests.length === 0 ? (
                <div className="py-10 text-center text-slate-400 bg-slate-950/40 rounded-xl border border-slate-800 p-6">
                  <div className="text-2xl mb-2">📭</div>
                  <div className="font-semibold text-slate-300">No document delivery records found</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    When this customer requests an invoice or payment link during a Chotu voice session, records of those requests and delivery attempts will appear here.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {customerDeliveryRequests.map((req) => (
                    <div key={req.id} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                            {req.requestType === 'BOTH' ? 'Invoice & Payment Link' : req.requestType === 'PAYMENT_LINK' ? 'Payment Link' : 'Invoice Copy'}
                          </span>
                          {req.invoice && (
                            <span className="font-mono text-white text-[11px] font-medium">
                              ({req.invoice.number})
                            </span>
                          )}
                          <span className="text-slate-400 text-[11px]">
                            by <span className="text-slate-200 font-mono">{req.requestedBy}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-[11px] font-mono">
                            {new Date(req.requestedAt).toLocaleString()}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            req.status === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : req.status === 'PARTIAL_SUCCESS'
                              ? 'bg-amber-950 text-amber-300 border-amber-800'
                              : req.status === 'FAILED'
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {req.status}
                          </span>
                        </div>
                      </div>

                      {/* Delivery attempts */}
                      {req.attempts && req.attempts.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Channel Attempts:
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {req.attempts.map((att) => (
                              <div key={att.id} className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span>{att.channel === 'WHATSAPP' ? '💬' : '✉️'}</span>
                                  <span className="font-semibold text-slate-200">{att.channel}</span>
                                  <span className="text-slate-400 font-mono text-[10px]">({att.destinationMasked})</span>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  att.status === 'SIMULATED'
                                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                                    : att.status === 'DELIVERED' || att.status === 'SENT'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : att.status === 'FAILED'
                                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                                    : 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}>
                                  {att.status === 'SIMULATED' ? '🧪 Sim' : att.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action buttons inside delivery card */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                        {req.invoiceId && (
                          <button
                            onClick={async () => {
                              try {
                                setDownloadingCustPdfId(req.invoiceId)
                                setCustomerDeliveriesError(null)
                                await invoicesApi.downloadPdf(req.invoiceId, req.invoice?.number || req.invoiceId)
                              } catch (err: unknown) {
                                const msg = await extractSafeApiError(err, 'Failed to download invoice PDF.')
                                setCustomerDeliveriesError(msg)
                                setActionError(msg)
                                toast.error(msg)
                              } finally {
                                setDownloadingCustPdfId(null)
                              }
                            }}
                            disabled={downloadingCustPdfId === req.invoiceId}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                          >
                            <span>📄</span>
                            {downloadingCustPdfId === req.invoiceId ? 'Downloading...' : 'Download Invoice PDF'}
                          </button>
                        )}
                        {req.metadata?.paymentLinkUrl && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(req.metadata!.paymentLinkUrl!)
                              setCopiedCustomerLinkId(req.id)
                              setTimeout(() => setCopiedCustomerLinkId(null), 2000)
                            }}
                            className="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 cursor-pointer flex items-center gap-1"
                          >
                            <span>💳</span> {copiedCustomerLinkId === req.id ? '✓ Link Copied!' : 'Copy Payment Link'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-800 flex justify-end bg-slate-950">
              <button
                onClick={() => setActiveDeliveriesCustomer(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {callTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl shadow-2xl" style={{ background: 'var(--surface, #13141c)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }}>
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Call with Chotu</h3>
                <p className="mt-0.5 text-xs text-white/50">Safe local simulation</p>
              </div>
              <button type="button" onClick={() => setCallTarget(null)} disabled={callSubmitting} className="text-white/60 hover:text-white disabled:opacity-40" aria-label="Close call simulation">✕</button>
            </div>
            <div className="space-y-4 p-6 text-sm">
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                <strong>Simulation only.</strong> This creates a CRM call session and checks normal safety rules. It does not dial or contact {callTarget.name}.
              </div>
              <div className="space-y-1 rounded-lg bg-black/20 p-3 text-xs text-white/70">
                <div><span className="text-white/45">Customer:</span> {callTarget.name}</div>
                <div><span className="text-white/45">Number:</span> {callTarget.phone}</div>
                <div><span className="text-white/45">Outstanding:</span> {callTarget.outstandingBalance > 0 ? fmt(callTarget.outstandingBalance) : 'No outstanding balance'}</div>
              </div>
              <div>
                <label htmlFor="call-reason" className="mb-1 block text-xs text-white/70">Reason for outreach</label>
                <input id="call-reason" type="text" value={callReason} onChange={(event) => setCallReason(event.target.value)} placeholder="Payment follow-up" className="w-full rounded-lg border border-white/10 bg-black/40 p-2.5 text-sm text-white outline-none focus:border-indigo-500" />
              </div>
              {callFeedback && (
                <div className={`rounded-lg border p-3 text-xs ${callFeedback.kind === 'success' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/20 bg-rose-400/10 text-rose-200'}`}>
                  {callFeedback.kind === 'success' ? '✓' : '⚠️'} {callFeedback.message}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button type="button" onClick={() => setCallTarget(null)} disabled={callSubmitting} className="rounded-lg bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40">Close</button>
              <button type="button" onClick={handleStartSimulatedCall} disabled={callSubmitting || callFeedback?.kind === 'success'} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                {callSubmitting ? 'Starting simulation…' : 'Start Chotu simulation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
