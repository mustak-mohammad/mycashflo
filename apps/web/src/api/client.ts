import axios from 'axios'

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
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('mcf_access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 globally — clear token and redirect to login
apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('mcf_access_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export default apiClient
