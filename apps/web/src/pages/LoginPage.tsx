import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../store/AuthContext'
import apiClient from '../api/client'
import type { LoginResponse } from '../types'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard'
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setServerError(null)
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', data)
      login(res.data.user, res.data.tokens.accessToken)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Please check your credentials.'
      setServerError(msg)
    }
  }

  return (
    <div
      className="flex min-h-screen"
      style={{ background: 'var(--bg)' }}
    >
      {/* Left — branding */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 w-[45%] shrink-0"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
        }}
      >
        <div>
          <div className="text-white font-bold text-2xl tracking-tight">myCashflo</div>
          <div className="text-indigo-200 text-sm mt-1">AI-Powered Collections Platform</div>
        </div>

        <div className="space-y-6">
          <h1 className="text-white text-4xl font-bold leading-tight">
            Recover revenue.<br />
            Automate follow-ups.<br />
            <span className="text-indigo-200">Close the gap.</span>
          </h1>
          <p className="text-indigo-100 text-base max-w-sm">
            myCashflo brings together AI voice calls, automated reminders, and real-time
            analytics so your team can focus on relationships — not spreadsheets.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { stat: '3.2×', label: 'Faster collection' },
            { stat: '94%', label: 'Promise kept rate' },
            { stat: '₹0', label: 'Setup cost' },
            { stat: '24/7', label: 'AI availability' },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-4"
              style={{ background: 'rgba(255,255,255,0.12)' }}
            >
              <div className="text-white font-bold text-xl">{s.stat}</div>
              <div className="text-indigo-200 text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <div className="text-white font-bold text-xl">myCashflo</div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              AI-Powered Collections Platform
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Welcome back</h2>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
            Sign in to your workspace
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="w-full px-4 py-3 rounded-lg text-sm text-white outline-none transition-all"
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${errors.email ? 'var(--danger)' : 'var(--border)'}`,
                }}
                placeholder="you@company.com"
              />
              {errors.email && (
                <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
                className="w-full px-4 py-3 rounded-lg text-sm text-white outline-none transition-all"
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${errors.password ? 'var(--danger)' : 'var(--border)'}`,
                }}
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                  {errors.password.message}
                </p>
              )}
            </div>

            {serverError && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                }}
              >
                {serverError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-lg text-white font-medium text-sm transition-all duration-150 cursor-pointer disabled:opacity-60"
              style={{ background: 'var(--primary)' }}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            🔒 Secure sign-in · myCashflo v0.2.0
          </p>
        </div>
      </div>
    </div>
  )
}
