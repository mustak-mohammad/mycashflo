import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  clearStoredAuth,
  getStoredAccessToken,
  getStoredRefreshToken,
  notifySessionExpired,
  savePostLoginRedirect,
  setStoredTokens,
} from '../utils/authStorage'

/**
 * Central Axios instance.
 * Reads the base URL from the Vite env variable VITE_API_URL.
 * Falls back to '/api' so the Vite dev-proxy handles it in development.
 */
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// Attach bearer token from localStorage on every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Concurrency queue and state for transparent token refresh
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error)
    } else if (token) {
      promise.resolve(token)
    }
  })
  failedQueue = []
}

function expireSessionAndPreserveRoute() {
  clearStoredAuth()
  delete apiClient.defaults.headers.common.Authorization
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    savePostLoginRedirect(window.location.pathname + window.location.search)
  }
  notifySessionExpired()
}

// Handle 401 responses: attempt silent refresh with token rotation and loop prevention
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    // Only intercept 401 Unauthorized errors
    if (!error.response || error.response.status !== 401 || !originalRequest) {
      return Promise.reject(error)
    }

    const requestUrl = originalRequest.url || ''
    const isAuthRoute =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/refresh') ||
      requestUrl.includes('/auth/google')

    // If 401 happened on an authentication endpoint or request was already retried, do not loop
    if (isAuthRoute || originalRequest._retry) {
      if (isAuthRoute && !requestUrl.includes('/auth/login')) {
        expireSessionAndPreserveRoute()
      }
      return Promise.reject(error)
    }

    const refreshToken = getStoredRefreshToken()
    if (!refreshToken) {
      expireSessionAndPreserveRoute()
      return Promise.reject(error)
    }

    // If another refresh is already in-flight, queue this request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      })
        .then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          return apiClient(originalRequest)
        })
        .catch((err) => Promise.reject(err))
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      // Use clean standalone axios instance to avoid recursive interceptor loops
      const refreshUrl = `${apiClient.defaults.baseURL}/auth/refresh`
      const res = await axios.post<{
        tokens: { accessToken: string; refreshToken: string; expiresIn: number }
      }>(refreshUrl, { refreshToken })

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = res.data.tokens

      setStoredTokens(newAccessToken, newRefreshToken)

      apiClient.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`
      originalRequest.headers.Authorization = `Bearer ${newTokenOrDefault(newAccessToken)}`

      processQueue(null, newAccessToken)
      return apiClient(originalRequest)
    } catch (refreshErr) {
      processQueue(refreshErr, null)
      expireSessionAndPreserveRoute()
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
  },
)

function newTokenOrDefault(token: string): string {
  return token
}

export default apiClient
