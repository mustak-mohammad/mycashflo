import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'

/** Wraps protected routes. Redirects unauthenticated users to /login. */
export function RequireAuth() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
