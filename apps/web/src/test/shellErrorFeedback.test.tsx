import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { ToastProvider, useToast } from '../store/ToastContext'
import { AppLayout } from '../components/layout/AppLayout'
import { SuperAdminLayout } from '../components/layout/SuperAdminLayout'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import FollowUpPage from '../pages/FollowUpPage'
import InvoicesPage from '../pages/InvoicesPage'
import PaymentsPage from '../pages/PaymentsPage'
import ReportsPage from '../pages/ReportsPage'
import { TeamUsersView } from '../components/team/TeamUsersView'
import { AutomatedRemindersView } from '../components/reminders/AutomatedRemindersView'
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
const mockedPut = vi.mocked(apiClient.put)
const mockedDelete = vi.mocked(apiClient.delete)

const adminUser: User = {
  id: 'u-admin',
  email: 'admin@acme.in',
  name: 'Anita Admin',
  role: 'ADMIN',
  tenantId: 't-1',
}

const agentUser: User = {
  id: 'u-agent',
  email: 'agent@acme.in',
  name: 'Arjun Agent',
  role: 'AGENT',
  tenantId: 't-1',
}

const superAdminUser: User = {
  id: 'u-sa',
  email: 'root@mycashflo.in',
  name: 'Siddharth Root',
  role: 'SUPER_ADMIN',
  tenantId: '',
}

function PathTracker() {
  const loc = useLocation()
  return <div data-testid="path-tracker">{loc.pathname}</div>
}

function setupAuthMock(user: User) {
  localStorage.setItem(ACCESS_TOKEN_KEY, `jwt-${user.role.toLowerCase()}`)
  mockedGet.mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ data: user })
    if (url === '/customers') return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 20 } })
    return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 20 } })
  })
}

describe('P2-07: Responsive Web Shell, Toast, ConfirmDialog, ErrorBoundary & Error Feedback', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Responsive navigation & role filtering', () => {
    it('opens/closes AppLayout mobile drawer, filters items by AGENT role, closes on navigation and Escape', async () => {
      const user = userEvent.setup()
      setupAuthMock(agentUser)

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/dashboard']}>
              <PathTracker />
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<div>Dashboard View</div>} />
                  <Route path="/customers" element={<div>Customers View</div>} />
                  <Route path="/profile" element={<div>Profile View</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      const toggleBtn = await screen.findByRole('button', { name: /Open navigation menu/i })
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')

      await user.click(toggleBtn)
      const drawer = screen.getByRole('dialog', { name: /Mobile navigation/i })
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')

      const drawerScope = within(drawer)
      expect(drawerScope.getByText('Dashboard')).toBeInTheDocument()
      expect(drawerScope.getByText('Customers')).toBeInTheDocument()
      expect(drawerScope.getByText('My Profile')).toBeInTheDocument()
      // Role-restricted items must stay hidden from AGENT
      expect(drawerScope.queryByText('Intelligence')).not.toBeInTheDocument()
      expect(drawerScope.queryByText('Reminders')).not.toBeInTheDocument()
      expect(drawerScope.queryByText('Voice Prompts')).not.toBeInTheDocument()
      expect(drawerScope.queryByText('Settings')).not.toBeInTheDocument()

      // Pressing Escape closes drawer and returns focus to menu toggle
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: /Mobile navigation/i })).not.toBeInTheDocument()
      expect(toggleBtn).toHaveFocus()

      // Reopen and navigate -> drawer automatically closes after navigation
      await user.click(toggleBtn)
      const reopenedDrawer = screen.getByRole('dialog', { name: /Mobile navigation/i })
      await user.click(within(reopenedDrawer).getByRole('link', { name: /Customers/i }))

      expect(screen.getByTestId('path-tracker')).toHaveTextContent('/customers')
      expect(screen.queryByRole('dialog', { name: /Mobile navigation/i })).not.toBeInTheDocument()
    })

    it('exposes admin/manager links in AppLayout drawer for ADMIN and supports SuperAdminLayout mobile drawer', async () => {
      const user = userEvent.setup()
      setupAuthMock(adminUser)

      const { unmount } = render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/dashboard']}>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<div>Dashboard View</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      await user.click(await screen.findByRole('button', { name: /Open navigation menu/i }))
      const drawerScope = within(screen.getByRole('dialog', { name: /Mobile navigation/i }))
      expect(drawerScope.getByText('Intelligence')).toBeInTheDocument()
      expect(drawerScope.getByText('Reminders')).toBeInTheDocument()
      expect(drawerScope.getByText('Voice Prompts')).toBeInTheDocument()
      expect(drawerScope.getByText('Settings')).toBeInTheDocument()
      await user.click(drawerScope.getByRole('button', { name: /Close navigation menu/i }))
      expect(screen.queryByRole('dialog', { name: /Mobile navigation/i })).not.toBeInTheDocument()
      unmount()

      setupAuthMock(superAdminUser)
      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/platform/overview']}>
              <PathTracker />
              <Routes>
                <Route path="/platform" element={<SuperAdminLayout />}>
                  <Route path="overview" element={<div>Platform Overview</div>} />
                  <Route path="tenants" element={<div>Tenants View</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      const platformToggle = await screen.findByRole('button', {
        name: /Open platform navigation menu/i,
      })
      await user.click(platformToggle)
      const saDrawer = screen.getByRole('dialog', { name: /Platform navigation/i })
      await user.click(within(saDrawer).getByRole('link', { name: /Tenant Management/i }))
      expect(screen.getByTestId('path-tracker')).toHaveTextContent('/platform/tenants')
      expect(screen.queryByRole('dialog', { name: /Platform navigation/i })).not.toBeInTheDocument()
    })
  })

  describe('Toast notification system', () => {
    function ToastHarness() {
      const toast = useToast()
      return (
        <div>
          <button type="button" onClick={() => toast.success('Saved record clean')}>
            Trigger Success
          </button>
          <button
            type="button"
            onClick={() =>
              toast.error('Failed with Bearer secret_token_123\n    at internalStack (app.js:12)')
            }
          >
            Trigger Unsafe Error
          </button>
          <button type="button" onClick={() => toast.error('Duplicate network notice')}>
            Trigger Duplicate Error
          </button>
          <button type="button" onClick={() => toast.warning('Low quota warning')}>
            Trigger Warning
          </button>
          <button type="button" onClick={() => toast.info('Sync scheduled')}>
            Trigger Info
          </button>
        </div>
      )
    }

    it('renders accessible success, error, warning, and info toasts, deduplicates, sanitizes, and dismisses', async () => {
      const user = userEvent.setup()
      render(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
      )

      await user.click(screen.getByText('Trigger Success'))
      expect(screen.getByRole('status')).toHaveTextContent('Saved record clean')

      await user.click(screen.getByText('Trigger Duplicate Error'))
      await user.click(screen.getByText('Trigger Duplicate Error'))
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.getByRole('alert')).toHaveTextContent('Duplicate network notice')

      await user.click(screen.getByText('Trigger Unsafe Error'))
      expect(screen.queryByText(/secret_token_123/)).not.toBeInTheDocument()
      expect(screen.queryByText(/internalStack/)).not.toBeInTheDocument()

      await user.click(screen.getByText('Trigger Warning'))
      await user.click(screen.getByText('Trigger Info'))
      expect(screen.getByText('Low quota warning')).toBeInTheDocument()
      expect(screen.getByText('Sync scheduled')).toBeInTheDocument()

      // Dismiss one toast cleanly
      const dismissButtons = screen.getAllByRole('button', { name: /Dismiss notification/i })
      await user.click(dismissButtons[0])
      expect(screen.queryByText('Saved record clean')).not.toBeInTheDocument()
    })
  })

  describe('Confirmation dialogs & duplicate submit prevention', () => {
    it('supports Cancel, Escape, and single-flight Confirm in ConfirmDialog', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      const onConfirm = vi.fn()

      const { rerender } = render(
        <ConfirmDialog
          open={true}
          title="Delete Resource"
          description="Are you sure you want to remove this item?"
          confirmLabel="Confirm Delete"
          loading={false}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onCancel).toHaveBeenCalledTimes(1)

      await user.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledTimes(2)

      rerender(
        <ConfirmDialog
          open={true}
          title="Delete Resource"
          description="Are you sure you want to remove this item?"
          confirmLabel="Confirm Delete"
          loading={true}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      )

      const processingBtn = screen.getByRole('button', { name: /Processing/i })
      expect(processingBtn).toBeDisabled()
      await user.click(processingBtn)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('confirms Follow-Up deletion via ConfirmDialog and prevents duplicate DELETE requests', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')

      let resolveDelete!: () => void
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/follow-ups') {
          return Promise.resolve({
            data: {
              data: [
                {
                  id: 'task-1',
                  title: 'Call Acme AP',
                  priority: 'HIGH',
                  done: false,
                  dueDate: '2026-11-15T00:00:00.000Z',
                },
              ],
              total: 1,
              page: 1,
              limit: 20,
              summary: { pendingCount: 1, completedCount: 0 },
            },
          })
        }
        return Promise.resolve({ data: {} })
      })

      mockedDelete.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDelete = () => resolve({ data: { deleted: true } })
          }),
      )

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/follow-ups']}>
              <FollowUpPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      const deleteBtn = await screen.findByRole('button', { name: /Delete task Call Acme AP/i })
      await user.click(deleteBtn)

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText(/Delete Follow-Up Task/i)).toBeInTheDocument()

      // Cancel aborts deletion
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(mockedDelete).not.toHaveBeenCalled()

      // Confirm deletion and click rapidly twice while pending
      await user.click(deleteBtn)
      const confirmBtn = screen.getByRole('button', { name: /Confirm Delete/i })
      await user.dblClick(confirmBtn)

      expect(mockedDelete).toHaveBeenCalledTimes(1)
      expect(mockedDelete).toHaveBeenCalledWith('/follow-ups/task-1')

      resolveDelete()
      expect(await screen.findByText(/Deleted follow-up task "Call Acme AP"/i)).toBeInTheDocument()
    })

    it('confirms Invoice cancellation on InvoicesPage without breaking RBAC', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')

      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/customers') return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } })
        if (url === '/invoices') {
          return Promise.resolve({
            data: {
              data: [
                {
                  id: 'inv-1',
                  number: 'INV-2026-01',
                  customerId: 'c-1',
                  customer: { id: 'c-1', name: 'Acme Traders' },
                  amount: 10000,
                  outstanding: 10000,
                  dueDate: '2026-11-30T00:00:00.000Z',
                  issueDate: '2026-11-01T00:00:00.000Z',
                  status: 'OPEN',
                },
              ],
              total: 1,
              page: 1,
              limit: 20,
            },
          })
        }
        return Promise.resolve({ data: {} })
      })
      mockedPatch.mockResolvedValue({ data: { id: 'inv-1', status: 'CANCELLED' } })

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/invoices']}>
              <InvoicesPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      const cancelInvBtn = await screen.findByRole('button', { name: /Cancel invoice INV-2026-01/i })
      await user.click(cancelInvBtn)

      expect(screen.getByRole('dialog')).toHaveTextContent(/cancel invoice INV-2026-01/i)
      await user.click(screen.getByRole('button', { name: /Confirm Cancel/i }))

      await waitFor(() => {
        expect(mockedPatch).toHaveBeenCalledWith('/invoices/inv-1', { status: 'CANCELLED' })
      })
      expect(await screen.findByText(/Invoice INV-2026-01 cancelled/i)).toBeInTheDocument()
    })

    it('confirms Team user role change and status deactivation via ConfirmDialog', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')

      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/users') {
          return Promise.resolve({
            data: [
              {
                id: 'u-agent',
                email: 'agent@acme.in',
                name: 'Arjun Agent',
                role: 'AGENT',
                isActive: true,
                createdAt: '2026-11-01T00:00:00.000Z',
                updatedAt: '2026-11-01T00:00:00.000Z',
              },
            ],
          })
        }
        return Promise.resolve({ data: {} })
      })
      mockedPatch.mockResolvedValue({ data: { id: 'u-agent', role: 'MANAGER', isActive: false } })

      render(
        <ToastProvider>
          <AuthProvider>
            <TeamUsersView />
          </AuthProvider>
        </ToastProvider>,
      )

      const roleSelect = (await screen.findByLabelText(/Role for Arjun Agent/i)) as HTMLSelectElement
      await user.selectOptions(roleSelect, 'MANAGER')

      expect(screen.getByRole('dialog')).toHaveTextContent(/Confirm Role Change/i)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockedPatch).not.toHaveBeenCalled()

      await user.selectOptions(roleSelect, 'MANAGER')
      await user.click(screen.getByRole('button', { name: /Confirm Role Change/i }))

      await waitFor(() => {
        expect(mockedPatch).toHaveBeenCalledWith('/users/u-agent', { role: 'MANAGER' })
      })

      await user.click(screen.getByRole('button', { name: 'Deactivate' }))
      expect(screen.getByRole('dialog')).toHaveTextContent(/Deactivate Team Member/i)
      await user.click(screen.getByRole('button', { name: /Deactivate User/i }))

      await waitFor(() => {
        expect(mockedPatch).toHaveBeenCalledWith('/users/u-agent', { isActive: false })
      })
    })

    it('confirms Payment claim verification via ConfirmDialog and prevents duplicate submit', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')

      let resolveVerify!: () => void
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/invoices') return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 100 } })
        if (url === '/payments') {
          return Promise.resolve({
            data: {
              data: [
                {
                  id: 'pay-1',
                  ref: 'UTR-9988',
                  amount: 5000,
                  method: 'UPI',
                  status: 'PENDING',
                  createdAt: '2026-11-10T00:00:00.000Z',
                },
              ],
              total: 1,
              page: 1,
              limit: 50,
            },
          })
        }
        return Promise.resolve({ data: {} })
      })

      mockedPost.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveVerify = () => resolve({ data: { id: 'pay-1', status: 'COMPLETED' } })
          }),
      )

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/payments']}>
              <PaymentsPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      await user.click(await screen.findByRole('button', { name: /Verify Claim/i }))
      expect(screen.getByRole('dialog')).toHaveTextContent(/Verify Payment Claim/i)
      const confirmBtn = screen.getByRole('button', { name: /Confirm Verification/i })
      await user.dblClick(confirmBtn)

      expect(mockedPost).toHaveBeenCalledTimes(1)
      expect(mockedPost).toHaveBeenCalledWith('/payments/pay-1/verify')

      resolveVerify()
      expect(await screen.findByText(/Payment claim UTR-9988 verified and reconciled/i)).toBeInTheDocument()
    })
  })

  describe('ErrorBoundary recovery & sanitized diagnostics', () => {
    it('hides internal exceptions, routes safely per role, and recovers on Retry View', async () => {
      const user = userEvent.setup()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const onNavigate = vi.fn()

      let shouldThrow = true
      function FlakyWidget() {
        if (shouldThrow) {
          throw new Error('POSTGRES_URL=postgres://secret_pass@db:5432/internal_crash')
        }
        return <div>Recovered Widget Content</div>
      }

      const { rerender } = render(
        <ErrorBoundary
          userRole="SUPER_ADMIN"
          isAuthenticated={true}
          currentPath="/platform/analytics"
          onNavigate={onNavigate}
        >
          <FlakyWidget />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/i)
      // Must NOT leak raw internal error text
      expect(screen.queryByText(/secret_pass/)).not.toBeInTheDocument()
      expect(screen.queryByText(/POSTGRES_URL/)).not.toBeInTheDocument()

      // Must provide role-aware navigation for SUPER_ADMIN
      const navBtn = screen.getByRole('button', { name: /Return to Platform Console/i })
      await user.click(navBtn)
      expect(onNavigate).toHaveBeenCalledWith('/platform/overview')

      // Re-trigger error for tenant user and verify Retry View recovers
      shouldThrow = true
      rerender(
        <ErrorBoundary
          userRole="AGENT"
          isAuthenticated={true}
          currentPath="/customers"
          onNavigate={onNavigate}
        >
          <FlakyWidget />
        </ErrorBoundary>,
      )

      expect(screen.getByRole('button', { name: /Return to Dashboard/i })).toBeInTheDocument()
      shouldThrow = false
      await user.click(screen.getByRole('button', { name: /Retry View/i }))
      expect(screen.getByText('Recovered Widget Content')).toBeInTheDocument()

      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
  })

  describe('API failure feedback & form input preservation', () => {
    it('surfaces FollowUpPage task creation failure, shows no false success, and keeps user form input', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')

      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        return Promise.resolve({
          data: { data: [], total: 0, page: 1, limit: 20, summary: { pendingCount: 0, completedCount: 0 } },
        })
      })
      mockedPost.mockRejectedValue({
        response: { status: 422, data: { message: 'Due date validation rejected by policy' } },
      })

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/follow-ups']}>
              <FollowUpPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      await user.click(await screen.findByRole('button', { name: /\+ Add Task/i }))
      const titleInput = screen.getByLabelText(/Task Title/i) as HTMLInputElement
      await user.type(titleInput, 'Verify NEFT reference with Sharma Traders')
      await user.click(screen.getByRole('button', { name: /Save Task/i }))

      expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
      expect(screen.getAllByText(/Due date validation rejected by policy/i).length).toBeGreaterThan(0)
      expect(screen.queryByText(/created\./i)).not.toBeInTheDocument()
      // Input value must remain intact so user does not lose work
      expect(titleInput.value).toBe('Verify NEFT reference with Sharma Traders')
    })

    it('surfaces AutomatedRemindersView save failure without showing success and preserves modified fields', async () => {
      const user = userEvent.setup()
      mockedGet.mockImplementation((url: string) => {
        if (url === '/reminders/settings') {
          return Promise.resolve({
            data: {
              enabled: true,
              dryRun: true,
              globalEnabled: false,
              channelPreference: 'EMAIL',
              timezone: 'Asia/Kolkata',
              quietHours: { startHour: 20, endHour: 9 },
              maxDailyPerCustomer: 1,
              minDaysBetweenReminders: 3,
              testRecipientEmail: 'qa@acme.in',
              testRecipientPhone: '919876543210',
            },
          })
        }
        return Promise.resolve({ data: { data: [] } })
      })
      mockedPut.mockRejectedValue({
        response: { status: 500, data: { message: 'Settings persistence failed' } },
      })

      render(
        <ToastProvider>
          <AutomatedRemindersView />
        </ToastProvider>,
      )

      const emailInput = (await screen.findByPlaceholderText('qa@example.com')) as HTMLInputElement
      await user.clear(emailInput)
      await user.type(emailInput, 'finance@acme.in')
      await user.click(screen.getByRole('button', { name: /Save Reminder Preferences/i }))

      expect(await screen.findAllByText(/Settings persistence failed/i)).not.toHaveLength(0)
      expect(screen.queryByText(/Settings saved successfully/i)).not.toBeInTheDocument()
      expect(emailInput.value).toBe('finance@acme.in')
    })

    it('surfaces ReportsPage ledger error cleanly instead of silently failing', async () => {
      const user = userEvent.setup()
      mockedGet.mockImplementation((url: string) => {
        if (url === '/reports/ledger') {
          return Promise.reject({
            response: { status: 502, data: { message: 'Ledger calculation upstream failed' } },
          })
        }
        return Promise.resolve({ data: { data: [] } })
      })

      render(
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>,
      )

      await user.click(screen.getByRole('button', { name: /Customer Ledger/i }))
      expect(
        await screen.findAllByText(/Ledger calculation upstream failed/i),
      ).not.toHaveLength(0)
    })
  })
})
