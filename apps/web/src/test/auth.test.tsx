import { StrictMode, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider, useAuth } from '../store/AuthContext'
import { RequireAuth } from '../components/auth/RequireAuth'
import LoginPage from '../pages/LoginPage'
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
} from '../utils/authStorage'
import type { User } from '../types'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
  },
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)

function ProtectedDashboardMock({ onRender }: { onRender?: () => void }) {
  const { user, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  onRender?.()

  return (
    <div>
      <h1>Protected Dashboard</h1>
      <p data-testid="verified-user-name">{user?.name}</p>
      <p data-testid="verified-user-role">{user?.role}</p>
      <button
        type="button"
        disabled={loggingOut}
        onClick={async () => {
          setLoggingOut(true)
          await logout()
        }}
      >
        Sign out
      </button>
    </div>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="current-path">{location.pathname}</div>
}

function renderWithAuthRoutes(initialPath = '/dashboard', onProtectedRender?: () => void) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route
              path="/dashboard"
              element={<ProtectedDashboardMock onRender={onProtectedRender} />}
            />
            <Route
              path="/platform/overview"
              element={<div>Platform Console</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Authentication, Login & /auth/me Session Restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    delete apiClient.defaults.headers.common.Authorization
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders login page with email/password form and functional login submission', async () => {
    const user = userEvent.setup()
    const validUser: User = {
      id: 'user-1',
      email: 'priya@acme.in',
      name: 'Priya Admin',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    }
    mockedPost.mockResolvedValueOnce({
      data: {
        user: validUser,
        tokens: { accessToken: 'jwt-access-1', refreshToken: 'jwt-refresh-1', expiresIn: 3600 },
      },
    })

    renderWithAuthRoutes('/login')

    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/work email address/i), 'priya@acme.in')
    await user.type(screen.getByLabelText(/^password$/i), 'StrongPass!123')
    await user.click(screen.getByRole('button', { name: /sign in to workspace/i }))

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
        email: 'priya@acme.in',
        password: 'StrongPass!123',
      })
      expect(screen.getByRole('heading', { name: 'Protected Dashboard' })).toBeInTheDocument()
    })
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('jwt-access-1')
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('jwt-refresh-1')
  })

  it('does not expose misleading email sign-up mode and clearly states registration is unsupported', async () => {
    const user = userEvent.setup()
    renderWithAuthRoutes('/login')

    expect(screen.queryByRole('button', { name: /create workspace account/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/create your workspace/i)).not.toBeInTheDocument()

    const requestAccessBtn = screen.getByRole('button', { name: /request access/i })
    await user.click(requestAccessBtn)

    expect(screen.getByRole('note')).toHaveTextContent(
      /self-service email\/password registration is not supported/i,
    )
    expect(screen.getByRole('button', { name: /sign in to workspace/i })).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('excludes demo-login controls and credentials in production mode', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>,
    )

    // Allow microtasks to settle in case any dynamic import would have occurred
    await new Promise((r) => setTimeout(r, 20))

    expect(screen.queryByText(/quick demo accounts/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Priya Sharma/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rahul Verma/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/democorp\.in/i)).not.toBeInTheDocument()
  })

  it('prevents protected routes from rendering before /auth/me validation completes', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'valid-token-pending')
    let resolveProfile!: (val: { data: User }) => void
    mockedGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve as (val: { data: User }) => void
        }),
    )

    const onProtectedRender = vi.fn()
    renderWithAuthRoutes('/dashboard', onProtectedRender)

    expect(screen.getByRole('status')).toHaveTextContent(/verifying your session/i)
    expect(onProtectedRender).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Protected Dashboard' })).not.toBeInTheDocument()

    resolveProfile({
      data: {
        id: 'u-verified',
        email: 'verified@company.in',
        name: 'Verified User',
        role: 'MANAGER',
        tenantId: 't-1',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Protected Dashboard' })).toBeInTheDocument()
    })
    expect(onProtectedRender).toHaveBeenCalled()
  })

  it('validates stored token via /auth/me and trusts backend user over tampered localStorage user', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'valid-jwt-token')
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: 'spoofed',
        email: 'spoofed@evil.com',
        name: 'Spoofed Super Admin',
        role: 'SUPER_ADMIN',
        tenantId: 'spoof',
      }),
    )

    const backendUser: User = {
      id: 'real-agent-id',
      email: 'agent@company.in',
      name: 'Backend Agent',
      role: 'AGENT',
      tenantId: 'tenant-real',
    }
    mockedGet.mockResolvedValueOnce({ data: backendUser })

    renderWithAuthRoutes('/dashboard')

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/auth/me')
      expect(screen.getByTestId('verified-user-name')).toHaveTextContent('Backend Agent')
      expect(screen.getByTestId('verified-user-role')).toHaveTextContent('AGENT')
    })
    expect(JSON.parse(localStorage.getItem(USER_KEY) || '{}').role).toBe('AGENT')
  })

  it('deduplicates concurrent /auth/me requests in React StrictMode', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'strict-mode-token')
    mockedGet.mockResolvedValue({
      data: {
        id: 'u-strict',
        email: 'strict@company.in',
        name: 'Strict User',
        role: 'ADMIN',
        tenantId: 't-1',
      },
    })

    render(
      <StrictMode>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/dashboard" element={<ProtectedDashboardMock />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </StrictMode>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('verified-user-name')).toHaveTextContent('Strict User')
    })
    expect(mockedGet).toHaveBeenCalledTimes(1)
  })

  it('clears invalid/rejected token on 401 from /auth/me and redirects to /login', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'expired-or-revoked-token')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'revoked-refresh-token')
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({ id: 'u1', email: 'a@b.com', name: 'Old User', role: 'ADMIN', tenantId: 't1' }),
    )

    mockedGet.mockRejectedValueOnce({ response: { status: 401 } })

    renderWithAuthRoutes('/dashboard')

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/login')
    })
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(USER_KEY)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Protected Dashboard' })).not.toBeInTheDocument()
  })

  it('handles backend/network unavailability safely without trusting cached user or clearing tokens', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'stored-token-during-outage')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh-during-outage')
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: 'cached-id',
        email: 'cached@company.in',
        name: 'Untrusted Cached User',
        role: 'ADMIN',
        tenantId: 't1',
      }),
    )

    // Network failure (no response object)
    mockedGet.mockRejectedValueOnce(new Error('Network Error'))

    renderWithAuthRoutes('/dashboard')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/unable to verify session/i)
    })

    // Must not trust cached user, must not get stuck loading, and must preserve tokens
    expect(screen.queryByRole('heading', { name: 'Protected Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByText('Untrusted Cached User')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('stored-token-during-outage')
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh-during-outage')

    // Retry when backend recovers
    mockedGet.mockResolvedValueOnce({
      data: {
        id: 'recovered-id',
        email: 'recovered@company.in',
        name: 'Recovered User',
        role: 'ADMIN',
        tenantId: 't1',
      },
    })

    await user.click(screen.getByRole('button', { name: /retry connection/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Protected Dashboard' })).toBeInTheDocument()
      expect(screen.getByTestId('verified-user-name')).toHaveTextContent('Recovered User')
    })
  })

  it('clears session on logout and returns user to /login', async () => {
    const user = userEvent.setup()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'active-token')
    localStorage.setItem(REFRESH_TOKEN_KEY, 'active-refresh')

    mockedGet.mockResolvedValueOnce({
      data: {
        id: 'u-logout',
        email: 'user@company.in',
        name: 'Active User',
        role: 'MANAGER',
        tenantId: 't-1',
      },
    })
    mockedPost.mockResolvedValueOnce({ data: { message: 'Logged out' } })

    renderWithAuthRoutes('/dashboard')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Protected Dashboard' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'active-refresh' })
      expect(screen.getByTestId('current-path')).toHaveTextContent('/login')
    })

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(USER_KEY)).toBeNull()
  })

  it('sanitizes logout error logging and never logs tokens, refresh tokens, or authorization headers', async () => {
    const user = userEvent.setup()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, 'secret-access-token-xyz')
      localStorage.setItem(REFRESH_TOKEN_KEY, 'secret-refresh-token-abc')

      mockedGet.mockResolvedValueOnce({
        data: {
          id: 'u-sanitized',
          email: 'user@company.in',
          name: 'Sanitized User',
          role: 'ADMIN',
          tenantId: 't-1',
        },
      })

      const sensitiveAxiosError = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 },
        config: {
          headers: { Authorization: 'Bearer secret-access-token-xyz' },
          data: JSON.stringify({ refreshToken: 'secret-refresh-token-abc' }),
        },
      })
      mockedPost.mockRejectedValueOnce(sensitiveAxiosError)

      renderWithAuthRoutes('/dashboard')
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Protected Dashboard' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /sign out/i }))

      await waitFor(() => {
        expect(screen.getByTestId('current-path')).toHaveTextContent('/login')
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const serializedWarn = JSON.stringify(warnSpy.mock.calls[0])
      expect(serializedWarn).toContain('503')
      expect(serializedWarn).toContain('Service Unavailable')
      expect(serializedWarn).not.toContain('secret-access-token-xyz')
      expect(serializedWarn).not.toContain('secret-refresh-token-abc')
      expect(serializedWarn).not.toContain('Authorization')
      expect(serializedWarn).not.toContain('Bearer')
      expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

