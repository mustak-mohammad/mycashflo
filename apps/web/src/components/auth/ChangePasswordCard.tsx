import { useState } from 'react'
import { PasswordInput } from '../ui/PasswordInput'
import { authApi } from '../../api/auth'
import { evaluatePasswordPolicy } from '../../utils/passwordPolicy'

interface ChangePasswordCardProps {
  onSuccess?: () => void
  userRole?: string
  className?: string
}

export function ChangePasswordCard({ onSuccess, userRole, className = '' }: ChangePasswordCardProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  // Policy checks (aligned with backend ChangePasswordDto)
  const policy = evaluatePasswordPolicy(newPassword)
  const { hasMinLength, hasMixedCase, hasNumberOrSymbol } = policy
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword
  const isDifferentFromCurrent = currentPassword.length > 0 && newPassword.length > 0 && currentPassword !== newPassword

  const isFormValid =
    currentPassword.trim().length > 0 &&
    policy.isValid &&
    isMatch &&
    isDifferentFromCurrent

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!currentPassword) {
      setErrorMsg('Please enter your current password.')
      return
    }

    if (policy.errorMessage) {
      setErrorMsg(policy.errorMessage)
      return
    }

    if (!isMatch) {
      setErrorMsg('New password and confirmation do not match.')
      return
    }

    if (currentPassword === newPassword) {
      setErrorMsg('New password must be different from current password.')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.changePassword({
        currentPassword,
        newPassword,
      })

      // Immediate credential cleanup from memory
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')

      setSuccessMsg(res.message || 'Password changed successfully! All active sessions have been updated.')
      if (onSuccess) onSuccess()
      setTimeout(() => setSuccessMsg(null), 5000)
    } catch (err: any) {
      setErrorMsg(
        err?.response?.data?.message ||
          err?.message ||
          'Failed to change password. Please check your current password and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrorMsg(null)
    setSuccessMsg(null)
    setIsExpanded(false)
  }

  return (
    <div
      className={`rounded-xl border border-slate-800 bg-[#111927] p-5 shadow-sm transition-all ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-lg">
            🔒
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">Password Security & Credential Rotation</h2>
              {userRole === 'SUPER_ADMIN' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-red-950/80 text-red-300 border border-red-800">
                  Master Privileges
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Secure self-service password alteration. Session refresh tokens are automatically invalidated upon rotation.
            </p>
          </div>
        </div>

        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-700/60 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 transition-colors cursor-pointer self-start sm:self-auto flex items-center gap-1.5"
          >
            <span>🔑</span> Change Password
          </button>
        )}
      </div>

      {successMsg && (
        <div className="mt-4 p-3 rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2">
          <span>✅</span> {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
          <span>⚠️</span> {errorMsg}
        </div>
      )}

      {isExpanded && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4 max-w-xl text-xs">
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
              Current Password <span className="text-rose-400">*</span>
            </label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter your existing account password"
              disabled={loading}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              autoComplete="current-password"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                New Password <span className="text-rose-400">*</span>
              </label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                disabled={loading}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                Confirm New Password <span className="text-rose-400">*</span>
              </label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                disabled={loading}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                autoComplete="new-password"
              />
            </div>
          </div>

          {/* Real-time Policy Check Checklist */}
          {newPassword.length > 0 && (
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] space-y-1.5">
              <span className="font-semibold text-slate-300 block mb-1">Password Requirements:</span>
              <div className="flex items-center gap-2">
                <span className={hasMinLength ? 'text-emerald-400' : 'text-slate-500'}>
                  {hasMinLength ? '✓' : '○'}
                </span>
                <span className={hasMinLength ? 'text-slate-200' : 'text-slate-400'}>
                  At least 8 characters
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={hasMixedCase ? 'text-emerald-400' : 'text-slate-500'}>
                  {hasMixedCase ? '✓' : '○'}
                </span>
                <span className={hasMixedCase ? 'text-slate-200' : 'text-slate-400'}>
                  Uppercase and lowercase letters
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={hasNumberOrSymbol ? 'text-emerald-400' : 'text-slate-500'}>
                  {hasNumberOrSymbol ? '✓' : '○'}
                </span>
                <span className={hasNumberOrSymbol ? 'text-slate-200' : 'text-slate-400'}>
                  At least one number or special symbol
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={isMatch ? 'text-emerald-400' : 'text-slate-500'}>
                  {isMatch ? '✓' : '○'}
                </span>
                <span className={isMatch ? 'text-slate-200' : 'text-slate-400'}>
                  Passwords match
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading || !isFormValid}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-md"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Updating Password...</span>
                </>
              ) : (
                <>
                  <span>🔒</span>
                  <span>Update Password</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

