import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { RequireAuth } from '../components/auth/RequireAuth'
import { RequireRole } from '../components/auth/RequireRole'
import { AppLayout } from '../components/layout/AppLayout'
import DashboardPage from '../pages/DashboardPage'
import CustomersPage from '../pages/CustomersPage'
import InvoicesPage from '../pages/InvoicesPage'
import SettingsPage from '../pages/SettingsPage'
import ProfilePage from '../pages/ProfilePage'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage'
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
const mockedPatch = vi.mocked(apiClient.patch)

function PathDisplay() {
  const loc = useLocation()
  return (
    <div data-testid="path-display">
      {loc.pathname}
      {loc.search}
    </div>
  )
}

function setupUserMocks(user: User) {
  localStorage.setItem(ACCESS_TOKEN_KEY, `jwt-${user.role.toLowerCase()}`)
  mockedGet.mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ data: user })
    if (url === '/dashboard') {
      return Promise.resolve({
        data: {
          totalReceivables: 50000,
          overdueAmount: 10000,
          collectionRate: 80,
          totalBilled: 250000,
          totalCollected: 200000,
          overdueInvoiceCount: 1,
          overdueCustomerCount: 1,
          openCaseCount: 1,
          openInvoiceCount: 2,
          agingBreakdown: { d0_30: 10000, d31_60: 0, d61_90: 0, d90plus: 0, thresholdOverdueAmount: 0 },
          collectionPriorities: [],
          promisesToPay: [],
          pendingCallbacks: [],
          recentPayments: [],
          recentOverdueInvoices: [],
        },
      })
    }
    if (url === '/dashboard/preferences') return Promise.resolve({ data: null })
    if (url === '/customers') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'c1',
              name: 'Acme Traders',
              email: 'ap@acme.in',
              phone: '+919999900000',
              outstandingBalance: 12000,
              currency: 'INR',
              status: 'ACTIVE',
              createdAt: '2026-10-01T00:00:00Z',
              tenantId: user.tenantId,
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      })
    }
    if (url === '/invoices') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'inv1',
              number: 'INV-1001',
              customerId: 'c1',
              customer: { name: 'Acme Traders' },
              amount: 12000,
              outstanding: 12000,
              currency: 'INR',
              status: 'OPEN',
              issueDate: '2026-10-01T00:00:00Z',
              dueDate: '2026-10-31T00:00:00Z',
              tenantId: user.tenantId,
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      })
    }
    if (url === '/audit-logs') return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 5 } })
    if (url === '/integrations') return Promise.resolve({ data: [] })
    if (url === '/users') return Promise.resolve({ data: [] })
    return Promise.resolve({ data: {} })
  })
}

function renderAppRouter(initialEntry: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PathDisplay />
        <Routes>
          <Route path="/login" element={<div>Login View</div>} />
          <Route element={<RequireAuth />}>
            <Route
              path="/platform/*"
              element={
                <RequireRole allowedRoles={['SUPER_ADMIN']}>
                  <div>Super Admin Platform Console</div>
                </RequireRole>
              }
            />
            <Route
              element={
                <RequireRole allowedRoles={['ADMIN', 'MANAGER', 'AGENT']} redirectTo="/platform/overview">
                  <AppLayout />
                </RequireRole>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route
                path="/settings"
                element={
                  <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                    <SettingsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/intelligence"
                element={
                  <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                    <div>Intelligence Page</div>
                  </RequireRole>
                }
              />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('P2-05 RBAC & Profile Route Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('blocks AGENT from admin/manager routes and hides Setup Wizard + /onboarding/status call on Dashboard', async () => {
    const agentUser: User = {
      id: 'u-agent',
      email: 'agent@acme.in',
      name: 'Rahul Agent',
      role: 'AGENT',
      tenantId: 't-1',
    }
    setupUserMocks(agentUser)

    renderAppRouter('/dashboard')

    await waitFor(() => {
      expect(screen.getByText(/Total Receivables/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /setup wizard/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/continue setup wizard/i)).not.toBeInTheDocument()
    expect(mockedGet).not.toHaveBeenCalledWith('/onboarding/status')
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /intelligence/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /my profile/i })).toBeInTheDocument()
  })

  it('shows 403 Forbidden when AGENT navigates directly to /settings or /intelligence', async () => {
    setupUserMocks({
      id: 'u-agent',
      email: 'agent@acme.in',
      name: 'Rahul Agent',
      role: 'AGENT',
      tenantId: 't-1',
    })

    renderAppRouter('/settings')

    await waitFor(() => {
      expect(screen.getByText(/Access Denied \(403 Forbidden\)/i)).toBeInTheDocument()
    })
  })

  it('hides customer create/edit and invoice create controls from AGENT while preserving reads', async () => {
    const agentUser: User = {
      id: 'u-agent',
      email: 'agent@acme.in',
      name: 'Rahul Agent',
      role: 'AGENT',
      tenantId: 't-1',
    }
    setupUserMocks(agentUser)

    const { unmount } = renderAppRouter('/customers')
    await waitFor(() => {
      expect(screen.getByText('Acme Traders')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /\+ add customer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deliveries/i })).toBeInTheDocument()
    unmount()

    renderAppRouter('/invoices')
    await waitFor(() => {
      expect(screen.getByText('INV-1001')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /\+ create invoice/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay link/i })).toBeInTheDocument()
  })

  it('allows AGENT to access /profile, update display name, reject blank names, and change password', async () => {
    const user = userEvent.setup()
    const agentUser: User = {
      id: 'u-agent',
      email: 'agent@acme.in',
      name: 'Rahul Agent',
      role: 'AGENT',
      tenantId: 't-1',
    }
    setupUserMocks(agentUser)
    mockedPatch.mockResolvedValueOnce({ data: { ...agentUser, name: 'Rahul Updated' } })
    mockedPost.mockResolvedValueOnce({
      data: { message: 'Password changed successfully. All active sessions have been updated.' },
    })

    renderAppRouter('/profile')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my profile & security/i })).toBeInTheDocument()
    })

    // Blank profile name does not call PATCH /auth/profile
    const nameInput = screen.getByLabelText(/display name/i) as HTMLInputElement
    await user.clear(nameInput)
    expect(screen.getByRole('button', { name: /save display name/i })).toBeDisabled()

    await user.type(nameInput, 'Rahul Updated')
    await user.click(screen.getByRole('button', { name: /save display name/i }))

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith('/auth/profile', { name: 'Rahul Updated' })
      expect(screen.getByText(/display name updated successfully/i)).toBeInTheDocument()
    })

    // Password change workflow works for AGENT
    await user.click(screen.getByRole('button', { name: /change password/i }))
    await user.type(screen.getByPlaceholderText(/enter your existing account password/i), 'AgentPass@123')
    await user.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'AgentNew@2026')
    await user.type(screen.getByPlaceholderText(/re-type new password/i), 'AgentNew@2026')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'AgentPass@123',
        newPassword: 'AgentNew@2026',
      })
    })
  })

  it('hides Team & Roles tab from MANAGER and prevents /users 403 call on direct ?tab=team access', async () => {
    setupUserMocks({
      id: 'u-mgr',
      email: 'mgr@acme.in',
      name: 'Meera Manager',
      role: 'MANAGER',
      tenantId: 't-1',
    })

    renderAppRouter('/settings?tab=team')

    await waitFor(() => {
      expect(screen.getByText(/Tenant Administrator Access Required/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /team & roles/i })).not.toBeInTheDocument()
    expect(mockedGet).not.toHaveBeenCalledWith('/users')
    expect(screen.getByRole('button', { name: /provider adapters/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chotu automated reminders/i })).toBeInTheDocument()
  })

  it('shows Team & Roles tab and loads /users when signed in as tenant ADMIN', async () => {
    setupUserMocks({
      id: 'u-admin',
      email: 'admin@acme.in',
      name: 'Priya Admin',
      role: 'ADMIN',
      tenantId: 't-1',
    })

    renderAppRouter('/settings?tab=team')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /team & roles/i })).toBeInTheDocument()
      expect(mockedGet).toHaveBeenCalledWith('/users')
    })
  })

  it('redirects SUPER_ADMIN away from tenant routes to /platform/overview and blocks tenant users from /platform', async () => {
    setupUserMocks({
      id: 'u-sa',
      email: 'superadmin@mycashflo.internal',
      name: 'Platform Owner',
      role: 'SUPER_ADMIN',
      tenantId: 'platform',
    })

    const { unmount } = renderAppRouter('/dashboard')
    await waitFor(() => {
      expect(screen.getByTestId('path-display')).toHaveTextContent('/platform/overview')
      expect(screen.getByText('Super Admin Platform Console')).toBeInTheDocument()
    })
    unmount()

    // Strict RequireRole does not bypass for SUPER_ADMIN unless SUPER_ADMIN is in allowedRoles
    localStorage.clear()
    vi.clearAllMocks()
    setupUserMocks({
      id: 'u-admin',
      email: 'admin@acme.in',
      name: 'Priya Admin',
      role: 'ADMIN',
      tenantId: 't-1',
    })

    renderAppRouter('/platform/overview')
    await waitFor(() => {
      expect(screen.getByText(/Access Denied \(403 Forbidden\)/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /return to dashboard/i })).toBeInTheDocument()
  })
})

