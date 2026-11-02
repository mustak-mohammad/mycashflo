import type { ReactNode } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'

interface RequireRoleProps {
  children?: ReactNode
  allowedRoles: Array<'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT'>
}

export function RequireRole({ children, allowedRoles }: RequireRoleProps) {
  const { user, isAuthenticated } = useAuth()

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />
  }

  const role = user.role || 'AGENT'
  const isAllowed = allowedRoles.includes(role as any) || role === 'SUPER_ADMIN'
  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
          style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)' }}
        >
          🔒
        </div>
        <h1 className="text-2xl font-bold mb-2 text-white">Access Denied (403 Forbidden)</h1>
        <p className="text-sm max-w-md mb-6" style={{ color: 'var(--text-muted)' }}>
          Your account role (<span className="font-semibold text-amber-400">{role}</span>) does not have
          permission to access this section. This administrative area requires authorization.
        </p>
        <Link
          to="/dashboard"
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors no-underline shadow-md"
        >
          ← Return to Dashboard
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
