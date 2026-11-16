import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'

/** Wraps protected routes. Blocks rendering until /auth/me validates any stored token. */
export function RequireAuth() {
  const { isAuthenticated, isValidating, sessionError, revalidateSession, logout } = useAuth()
  const location = useLocation()

  if (isValidating) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center min-h-screen gap-3 px-6 text-center"
        style={{ background: 'var(--bg)' }}
      >
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-300">Verifying your session…</p>
      </div>
    )
  }

  if (sessionError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-6 space-y-4 border border-amber-800/60"
          style={{ background: 'var(--surface)' }}
        >
          <div className="text-2xl">⚠️</div>
          <h1 className="text-lg font-semibold text-white">Unable to Verify Session</h1>
          <p className="text-sm text-slate-300">{sessionError}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={() => {
                void revalidateSession()
              }}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              type="button"
              onClick={() => {
                void logout()
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
