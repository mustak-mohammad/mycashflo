import { useState, useEffect } from 'react'
import { onboardingApi, type CompanyProfile } from '../../api/onboarding'
import { remindersApi } from '../../api/reminders'
import { useAuth } from '../../store/AuthContext'
import { useToast } from '../../store/ToastContext'
import { extractSafeErrorMessage } from '../../utils/safeError'

export function BusinessProfileSection() {
  const { user } = useAuth()
  const toast = useToast()
  const isTenantAdmin = user?.role === 'ADMIN'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata')

  const [form, setForm] = useState<CompanyProfile>({
    legalName: '',
    gstin: '',
    pan: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    phone: '',
    contactEmail: '',
    currency: 'INR',
    defaultPaymentTermsDays: 30,
  })

  useEffect(() => {
    let mounted = true
    Promise.all([
      onboardingApi.getCompanyProfile().catch(() => null),
      remindersApi.getSettings().catch(() => null),
    ])
      .then(([companyRes, remRes]) => {
        if (!mounted) return
        if (companyRes) {
          setForm({
            legalName: companyRes.legalName || companyRes.companyName || '',
            gstin: companyRes.gstin || '',
            pan: companyRes.pan || '',
            address: companyRes.address || companyRes.billingAddress || '',
            city: companyRes.city || '',
            state: companyRes.state || '',
            postalCode: companyRes.postalCode || '',
            phone: companyRes.phone || '',
            contactEmail: companyRes.contactEmail || companyRes.email || '',
            currency: companyRes.currency || 'INR',
            defaultPaymentTermsDays: companyRes.defaultPaymentTermsDays || 30,
          })
        }
        if (remRes?.timezone) {
          setTimezone(remRes.timezone)
        }
      })
      .catch((err) => {
        if (!mounted) return
        setError(extractSafeErrorMessage(err, 'Failed to load business profile details.'))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isTenantAdmin) return

    setSaving(true)
    setError(null)
    setSuccessMsg(null)

    try {
      await onboardingApi.saveCompanyProfile({
        ...form,
        legalName: form.legalName?.trim() || undefined,
        gstin: form.gstin?.trim() || undefined,
        pan: form.pan?.trim() || undefined,
        address: form.address?.trim() || undefined,
        city: form.city?.trim() || undefined,
        state: form.state?.trim() || undefined,
        postalCode: form.postalCode?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        contactEmail: form.contactEmail?.trim() || undefined,
      })
      setSuccessMsg('Business profile details updated successfully.')
      toast.success('Business profile updated.')
      setTimeout(() => setSuccessMsg(null), 3500)
    } catch (err: unknown) {
      const msg = extractSafeErrorMessage(err, 'Failed to update business profile.')
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div
        className="rounded-2xl p-6 animate-pulse space-y-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="h-5 w-48 rounded bg-white/10" />
        <div className="h-4 w-72 rounded bg-white/5" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
          <div className="h-10 rounded bg-white/5" />
          <div className="h-10 rounded bg-white/5" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-white/5">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>🏢</span> Business &amp; Organization Profile
          </h2>
          <p className="text-xs text-white/50 mt-0.5">
            Legal identity, GSTIN/PAN tax registration, primary currency, and operating timezone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
            🕒 Timezone: {timezone}
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded font-bold uppercase"
            style={
              isTenantAdmin
                ? { background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
                : { background: 'rgba(255, 255, 255, 0.05)', color: 'rgba(255, 255, 255, 0.5)' }
            }
          >
            {isTenantAdmin ? 'Admin Managed' : 'Read Only'}
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 mb-4 rounded-xl text-xs bg-rose-950/40 border border-rose-800 text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {successMsg && (
        <div role="status" className="p-3 mb-4 rounded-xl text-xs bg-emerald-950/40 border border-emerald-800 text-emerald-300">
          ✅ {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Company Legal Name</label>
            <input
              type="text"
              disabled={!isTenantAdmin}
              value={form.legalName || ''}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              placeholder="e.g. Demo Corp Pvt Ltd"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Official Contact Email</label>
            <input
              type="email"
              disabled={!isTenantAdmin}
              value={form.contactEmail || ''}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              placeholder="billing@democorp.in"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">GSTIN / Tax ID</label>
            <input
              type="text"
              disabled={!isTenantAdmin}
              value={form.gstin || ''}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              placeholder="e.g. 29ABCDE1234F1Z5"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">PAN (Income Tax Number)</label>
            <input
              type="text"
              disabled={!isTenantAdmin}
              value={form.pan || ''}
              onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
              placeholder="e.g. ABCDE1234F"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-white/70 mb-1">Billing / Registered Address</label>
            <input
              type="text"
              disabled={!isTenantAdmin}
              value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="100 Industrial Tech Park, Electronic City"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">City</label>
              <input
                type="text"
                disabled={!isTenantAdmin}
                value={form.city || ''}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Bengaluru"
                className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">State</label>
              <input
                type="text"
                disabled={!isTenantAdmin}
                value={form.state || ''}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="Karnataka"
                className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Postal Code</label>
              <input
                type="text"
                disabled={!isTenantAdmin}
                value={form.postalCode || ''}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                placeholder="560100"
                className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Contact Phone</label>
            <input
              type="text"
              disabled={!isTenantAdmin}
              value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+919876543210"
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Default Payment Terms</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="365"
                disabled={!isTenantAdmin}
                value={form.defaultPaymentTermsDays ?? 30}
                onChange={(e) => setForm({ ...form, defaultPaymentTermsDays: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg text-xs text-white bg-black/40 border border-white/10 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <span className="text-xs text-white/60 shrink-0">Days</span>
            </div>
          </div>
        </div>

        {isTenantAdmin && (
          <div className="flex justify-end pt-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-sm cursor-pointer disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Business Profile'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
