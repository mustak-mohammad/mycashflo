import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

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
  const token = localStorage.getItem('mcf_access_token')
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
        localStorage.removeItem('mcf_access_token')
        localStorage.removeItem('mcf_refresh_token')
        localStorage.removeItem('mcf_user')
        if (window.location.pathname !== '/login') {
          sessionStorage.setItem('mcf_redirect_after_login', window.location.pathname + window.location.search)
          window.location.href = '/login'
        }
      }
      return Promise.reject(error)
    }

    const refreshToken = localStorage.getItem('mcf_refresh_token')
    if (!refreshToken) {
      localStorage.removeItem('mcf_access_token')
      localStorage.removeItem('mcf_user')
      if (window.location.pathname !== '/login') {
        sessionStorage.setItem('mcf_redirect_after_login', window.location.pathname + window.location.search)
        window.location.href = '/login'
      }
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

      localStorage.setItem('mcf_access_token', newAccessToken)
      localStorage.setItem('mcf_refresh_token', newRefreshToken)

      apiClient.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`

      processQueue(null, newAccessToken)
      return apiClient(originalRequest)
    } catch (refreshErr) {
      processQueue(refreshErr, null)
      localStorage.removeItem('mcf_access_token')
      localStorage.removeItem('mcf_refresh_token')
      localStorage.removeItem('mcf_user')

      // Preserve current location / form state so user can return after logging in
      if (window.location.pathname !== '/login') {
        sessionStorage.setItem('mcf_redirect_after_login', window.location.pathname + window.location.search)
        window.location.href = '/login'
      }
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
  },
)

export default apiClient
