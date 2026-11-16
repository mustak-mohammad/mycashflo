import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import apiClient from '../api/client'
import { authApi } from '../api/auth'
import type { User } from '../types'
import {
  clearPostLoginRedirect,
  clearStoredAuth,
  clearStoredUser,
  getStoredAccessToken,
  getStoredRefreshToken,
  SESSION_EXPIRED_EVENT,
  setStoredTokens,
  setStoredUser,
} from '../utils/authStorage'

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isValidating: boolean
  sessionError: string | null
  login: (user: User, token: string, refreshToken?: string) => void
  logout: () => Promise<void>
  updateUser: (updatedFields: Partial<User>) => void
  revalidateSession: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// Deduplicates concurrent /auth/me requests for the same token (e.g. React StrictMode double-effects)
let inFlightValidation: { token: string; promise: Promise<User> } | null = null

function fetchVerifiedProfile(token: string, force = false): Promise<User> {
  if (!force && inFlightValidation && inFlightValidation.token === token) {
    return inFlightValidation.promise
  }

  const promise = authApi.getProfile().finally(() => {
    if (inFlightValidation?.promise === promise) {
      inFlightValidation = null
    }
  })

  inFlightValidation = { token, promise }
  return promise
}

function isAuthenticationRejection(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 401 || status === 403
}

function getNetworkErrorMessage(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (typeof status === 'number' && status >= 500) {
    return 'Authentication service is temporarily unavailable. Your session credentials are preserved—please retry.'
  }
  return 'Unable to reach the server to verify your session. Check your connection and retry.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isValidating, setIsValidating] = useState<boolean>(() => Boolean(getStoredAccessToken()))
  const [sessionError, setSessionError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const clearLocalSessionState = useCallback(() => {
    inFlightValidation = null
    clearStoredAuth()
    delete apiClient.defaults.headers.common.Authorization
    if (mountedRef.current) {
      setUser(null)
      setSessionError(null)
      setIsValidating(false)
    }
  }, [])

  const applyValidationResult = useCallback((verifiedUser: User) => {
    if (!getStoredAccessToken()) {
      setUser(null)
      setSessionError(null)
      setIsValidating(false)
      return
    }
    setStoredUser(verifiedUser)
    setUser(verifiedUser)
    setSessionError(null)
    setIsValidating(false)
  }, [])

  const applyValidationError = useCallback((err: unknown) => {
    if (isAuthenticationRejection(err)) {
      clearStoredAuth()
      delete apiClient.defaults.headers.common.Authorization
      setUser(null)
      setSessionError(null)
    } else {
      setUser(null)
      setSessionError(getNetworkErrorMessage(err))
    }
    setIsValidating(false)
  }, [])

  // Validate stored token against /auth/me on mount (never trust cached localStorage user)
  useEffect(() => {
    const token = getStoredAccessToken()
    if (!token) {
      clearStoredUser()
      delete apiClient.defaults.headers.common.Authorization
      return
    }

    let cancelled = false
    void fetchVerifiedProfile(token)
      .then((verifiedUser) => {
        if (!cancelled && mountedRef.current) {
          applyValidationResult(verifiedUser)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && mountedRef.current) {
          applyValidationError(err)
        }
      })

    return () => {
      cancelled = true
    }
  }, [applyValidationResult, applyValidationError])

  // Sync with client.ts when silent token refresh fails mid-session
  useEffect(() => {
    const handleSessionExpired = () => {
      clearLocalSessionState()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    }
  }, [clearLocalSessionState])

  const login = useCallback((u: User, token: string, refreshToken?: string) => {
    inFlightValidation = null
    setStoredTokens(token, refreshToken)
    setStoredUser(u)
    clearPostLoginRedirect()
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`
    setUser(u)
    setSessionError(null)
    setIsValidating(false)
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken()
    inFlightValidation = null
    try {
      if (getStoredAccessToken()) {
        if (refreshToken) {
          await apiClient.post('/auth/logout', { refreshToken })
        } else {
          await apiClient.post('/auth/logout', {})
        }
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = err instanceof Error ? err.message : 'Request failed'
      console.warn('Server logout failed or API unavailable', {
        status: status ?? null,
        message,
      })
    } finally {
      clearStoredAuth()
      clearPostLoginRedirect()
      delete apiClient.defaults.headers.common.Authorization
      if (mountedRef.current) {
        setUser(null)
        setSessionError(null)
        setIsValidating(false)
      }
    }
  }, [])

  const updateUser = useCallback((updatedFields: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null
      const updated = { ...prev, ...updatedFields }
      setStoredUser(updated)
      return updated
    })
  }, [])

  const revalidateSession = useCallback(async () => {
    const token = getStoredAccessToken()
    if (!token) {
      clearLocalSessionState()
      return
    }
    setIsValidating(true)
    setSessionError(null)
    try {
      const verifiedUser = await fetchVerifiedProfile(token, true)
      if (mountedRef.current) {
        applyValidationResult(verifiedUser)
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        applyValidationError(err)
      }
    }
  }, [clearLocalSessionState, applyValidationResult, applyValidationError])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isValidating,
        sessionError,
        login,
        logout,
        updateUser,
        revalidateSession,
      }}
    >
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
