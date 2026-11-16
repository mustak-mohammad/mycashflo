import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../store/AuthContext'
import apiClient from '../api/client'
import type { LoginResponse } from '../types'
import { PasswordInput } from '../components/ui/PasswordInput'
import type { DevDemoAccount } from '../utils/devDemoAccounts'
import { clearPostLoginRedirect, getPostLoginRedirect } from '../utils/authStorage'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const requestedFrom =
    (location.state as { from?: { pathname: string } })?.from?.pathname ??
    getPostLoginRedirect() ??
    undefined
  const [serverError, setServerError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState<boolean>(false)
  const [showRegistrationNotice, setShowRegistrationNotice] = useState<boolean>(false)
  const [demoAccounts, setDemoAccounts] = useState<DevDemoAccount[]>([])

  useEffect(() => {
    if (!(import.meta.env.DEV && !import.meta.env.PROD)) {
      return
    }
    let active = true
    import('../utils/devDemoAccounts')
      .then((mod) => {
        if (active) {
          setDemoAccounts(mod.DEV_DEMO_ACCOUNTS)
        }
      })
      .catch(() => {
        if (active) setDemoAccounts([])
      })
    return () => {
      active = false
    }
  }, [])

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  function getRedirectDestination(userRole?: string): string {
    if (requestedFrom && requestedFrom !== '/' && requestedFrom !== '/login') {
      return requestedFrom
    }
    return userRole === 'SUPER_ADMIN' ? '/platform/overview' : '/dashboard'
  }

  async function onSubmit(data: FormData) {
    setServerError(null)
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', data)
      clearPostLoginRedirect()
      login(res.data.user, res.data.tokens.accessToken, res.data.tokens.refreshToken)
      navigate(getRedirectDestination(res.data.user.role), { replace: true })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Authentication failed. Please check your credentials.'
      setServerError(msg)
    }
  }

  async function handleGoogleAuth() {
    setServerError(null)
    setGoogleLoading(true)

    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    const hasValidGoogleId =
      googleClientId &&
      !googleClientId.includes('your_google_client_id') &&
      googleClientId.trim().length > 10

    const authenticateWithToken = async (idToken: string, email?: string, name?: string) => {
      const res = await apiClient.post<LoginResponse>('/auth/google', {
        idToken,
        email,
        name,
      })
      clearPostLoginRedirect()
      login(res.data.user, res.data.tokens.accessToken, res.data.tokens.refreshToken)
      navigate(getRedirectDestination(res.data.user.role), { replace: true })
    }

    const tryDevMockFallback = (finish?: (fn: () => void) => void, resolve?: () => void, reject?: (e: unknown) => void) => {
      if (!(import.meta.env.DEV && !import.meta.env.PROD && import.meta.env.VITE_ALLOW_DEV_MOCK_AUTH === 'true')) {
        const err = new Error(
          'Google Sign-In is not configured for this environment. Please sign in with your work email and password.',
        )
        if (finish && reject) {
          finish(() => reject(err))
          return
        }
        throw err
      }

      const executeMockAuth = () =>
        import('../utils/devDemoAccounts').then((mod) => {
          const payload = mod.createDevMockGooglePayload()
          return authenticateWithToken(payload.idToken, payload.email, payload.name)
        })

      if (finish && resolve && reject) {
        executeMockAuth()
          .then(() => finish(resolve))
          .catch((e) => finish(() => reject(e)))
        return
      }
      return executeMockAuth()
    }

    try {
      if (hasValidGoogleId && typeof window !== 'undefined' && (window as unknown as { google?: { accounts?: { id?: any } } }).google?.accounts?.id) {
        const googleAccountsId = (window as unknown as { google: { accounts: { id: any } } }).google.accounts.id
        await new Promise<void>((resolve, reject) => {
          let resolved = false
          const finish = (fn: () => void) => {
            if (!resolved) {
              resolved = true
              fn()
            }
          }

          try {
            googleAccountsId.initialize({
              client_id: googleClientId,
              callback: async (response: { credential?: string }) => {
                if (response.credential) {
                  try {
                    await authenticateWithToken(response.credential)
                    finish(resolve)
                  } catch (err) {
                    finish(() => reject(err))
                  }
                } else {
                  finish(() => reject(new Error('No Google credential returned')))
                }
              },
              auto_select: false,
              cancel_on_tap_outside: true,
            })

            googleAccountsId.prompt((notification: any) => {
              if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
                tryDevMockFallback(finish, resolve, reject)
              }
            })
          } catch {
            tryDevMockFallback(finish, resolve, reject)
          }
        })
      } else {
        await tryDevMockFallback()
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'Google authentication failed. Please verify Google OAuth configuration.'
      setServerError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
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

          <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Sign in to access your receivables dashboard
          </p>

          {/* Google Sign In Button */}
          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl text-sm font-semibold text-white transition-all duration-150 cursor-pointer hover:bg-slate-800 disabled:opacity-60 shadow-xs"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>{googleLoading ? 'Connecting with Google…' : 'Continue with Google'}</span>
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" style={{ borderColor: 'var(--border)' }}></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="px-3 text-slate-400" style={{ background: 'var(--bg)' }}>
                Or with work email
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Work email address
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
              <PasswordInput
                id="password"
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
              {isSubmitting ? 'Signing in…' : 'Sign in to Workspace'}
            </button>
          </form>

          {/* Quick Demo Switcher (strictly stripped from production builds) */}
          {import.meta.env.DEV && !import.meta.env.PROD && demoAccounts.length > 0 && (
            <div className="mt-5 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
              <div className="text-slate-400 font-medium mb-2 flex items-center justify-between">
                <span>Quick Demo Accounts (Dev Only):</span>
                <span className="text-[10px] text-slate-500">Includes seeded demo data</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setValue('email', acc.email)
                      setValue('password', acc.password)
                    }}
                    className={
                      acc.variant === 'primary'
                        ? 'p-2 rounded-lg bg-indigo-950/60 border border-indigo-800/60 text-indigo-200 hover:bg-indigo-900/80 text-left transition-colors cursor-pointer'
                        : 'p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-left transition-colors cursor-pointer'
                    }
                  >
                    <div className="font-semibold text-white">{acc.label}</div>
                    <div
                      className={`text-[10px] ${acc.variant === 'primary' ? 'text-indigo-300' : 'text-slate-400'}`}
                    >
                      {acc.roleSubtitle}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Account access / registration notice */}
          <div className="mt-6 text-center text-xs">
            <span style={{ color: 'var(--text-muted)' }}>Don&apos;t have an account yet? </span>
            <button
              type="button"
              onClick={() => setShowRegistrationNotice((prev) => !prev)}
              aria-expanded={showRegistrationNotice}
              className="text-indigo-400 font-semibold hover:underline cursor-pointer"
            >
              Request access
            </button>
            {showRegistrationNotice && (
              <div
                role="note"
                className="mt-3 rounded-lg px-3 py-2.5 text-left text-xs text-slate-300 bg-slate-900/70 border border-slate-800"
              >
                Self-service email/password registration is not supported. Contact your workspace
                administrator for an invitation, or use <strong>Continue with Google</strong> if
                enabled for your organization.
              </div>
            )}
          </div>

          <p className="mt-8 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            🔒 Secure OAuth 2.0 & JWT Authentication · myCashflo v0.2.0
          </p>
        </div>
      </div>
    </div>
  )
}
