import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import apiClient from '../api/client'
import type { User } from '../types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User, token: string, refreshToken?: string) => void
  logout: () => Promise<void>
  updateUser: (updatedFields: Partial<User>) => void
}

const AuthContext = createContext<AuthState | null>(null)

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem('mcf_user')
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser)

  const login = useCallback((u: User, token: string, refreshToken?: string) => {
    localStorage.setItem('mcf_access_token', token)
    if (refreshToken) {
      localStorage.setItem('mcf_refresh_token', refreshToken)
    }
    localStorage.setItem('mcf_user', JSON.stringify(u))
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('mcf_refresh_token')
    try {
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken })
      } else {
        await apiClient.post('/auth/logout', {})
      }
    } catch (err) {
      console.warn('Server logout failed or API unavailable:', err)
    } finally {
      localStorage.removeItem('mcf_access_token')
      localStorage.removeItem('mcf_refresh_token')
      localStorage.removeItem('mcf_user')
      setUser(null)
    }
  }, [])

  const updateUser = useCallback((updatedFields: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null
      const updated = { ...prev, ...updatedFields }
      localStorage.setItem('mcf_user', JSON.stringify(updated))
      return updated
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
