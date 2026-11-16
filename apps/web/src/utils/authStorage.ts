import type { User } from '../types'

export const ACCESS_TOKEN_KEY = 'mcf_access_token'
export const REFRESH_TOKEN_KEY = 'mcf_refresh_token'
export const USER_KEY = 'mcf_user'
export const REDIRECT_AFTER_LOGIN_KEY = 'mcf_redirect_after_login'
export const SESSION_EXPIRED_EVENT = 'mcf:session-expired'

export function getStoredAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setStoredTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  }
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY)
}

export function clearStoredAuth(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getPostLoginRedirect(): string | null {
  return sessionStorage.getItem(REDIRECT_AFTER_LOGIN_KEY)
}

export function savePostLoginRedirect(path: string): void {
  sessionStorage.setItem(REDIRECT_AFTER_LOGIN_KEY, path)
}

export function clearPostLoginRedirect(): void {
  sessionStorage.removeItem(REDIRECT_AFTER_LOGIN_KEY)
}

export function notifySessionExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }
}

