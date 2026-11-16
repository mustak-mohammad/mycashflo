import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { RequireAuth } from '../components/auth/RequireAuth'
import { RequireRole } from '../components/auth/RequireRole'
import SettingsPage from '../pages/SettingsPage'
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
const mockedPut = vi.mocked(apiClient.put)

const adminUser: User = {
  id: 'u-admin',
  email: 'admin@acme.in',
  name: 'Anita Admin',
  role: 'ADMIN',
  tenantId: 't-1',
}

const managerUser: User = {
  id: 'u-mgr',
  email: 'manager@acme.in',
  name: 'Manoj Manager',
  role: 'MANAGER',
  tenantId: 't-1',
}

const agentUser: User = {
  id: 'u-agent',
  email: 'agent@acme.in',
  name: 'Arjun Agent',
  role: 'AGENT',
  tenantId: 't-1',
}

const sampleIntegrations = [
  {
    id: 'int-rzp',
    provider: 'RAZORPAY',
    isActive: true,
    config: { keyId: 'rzp_test_123', keySecret: '****abcd', webhookSecret: '********' },
    updatedAt: '2026-11-10T10:00:00.000Z',
    isConfigured: true,
  },
  {
    id: 'int-sms',
    provider: 'SMS_GATEWAY',
    isActive: true,
    config: {
      provider: 'GUPSHUP',
      accountSid: 'AC_TEST_123',
      authToken: '****7890',
      senderId: 'MCASHF',
      entityId: '110100001234',
      templateId: '110700005678',
      testRecipient: '+919876543210',
    },
    updatedAt: '2026-11-11T12:00:00.000Z',
    isConfigured: true,
  },
]

const sampleAuditPage1 = {
  data: [
    {
      id: 'aud-1',
      tenantId: 't-1',
      userId: 'u-admin',
      action: 'integration.configured',
      entityType: 'IntegrationConfig',
      entityId: 'int-sms',
      metadata: {
        provider: 'SMS_GATEWAY',
        isActive: true,
        authToken: 'raw_secret_should_never_render',
        nested: { apiKey: 'raw_nested_key' },
      },
      createdAt: '2026-11-12T09:15:00.000Z',
      user: { id: 'u-admin', name: 'Anita Admin', email: 'admin@acme.in', role: 'ADMIN' },
    },
    {
      id: 'aud-2',
      tenantId: 't-1',
      userId: 'u-mgr',
      action: 'invoice.failed_delivery',
      entityType: 'Invoice',
      entityId: 'inv-102',
      metadata: { status: 'FAILED', reason: 'SMTP disabled' },
      createdAt: '2026-11-12T08:00:00.000Z',
      user: { id: 'u-mgr', name: 'Manoj Manager', email: 'manager@acme.in', role: 'MANAGER' },
    },
  ],
  total: 25,
  page: 1,
  limit: 20,
}

function renderSettingsApp(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<RequireAuth />}>
            <Route
              path="/settings"
              element={
                <RequireRole allowedRoles={['ADMIN', 'MANAGER']}>
                  <SettingsPage />
                </RequireRole>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function setupDefaultMocks(user: User = adminUser) {
  localStorage.setItem(ACCESS_TOKEN_KEY, `jwt-${user.role.toLowerCase()}`)
  mockedGet.mockImplementation((url: string, config?: unknown) => {
    if (url === '/auth/me') return Promise.resolve({ data: user })
    if (url === '/integrations') return Promise.resolve({ data: sampleIntegrations })
    if (url === '/audit-logs') {
      const page = Number(
        (config as { params?: Record<string, unknown> } | undefined)?.params?.page ?? 1,
      )
      if (page === 2) {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'aud-21',
                tenantId: 't-1',
                userId: 'u-admin',
                action: 'customer.created',
                entityType: 'Customer',
                entityId: 'cust-99',
                metadata: { name: 'Bharat Steel' },
                createdAt: '2026-11-10T07:00:00.000Z',
                user: { id: 'u-admin', name: 'Anita Admin', email: 'admin@acme.in', role: 'ADMIN' },
              },
            ],
            total: 25,
            page: 2,
            limit: 20,
          },
        })
      }
      return Promise.resolve({ data: sampleAuditPage1 })
    }
    return Promise.resolve({ data: {} })
  })
}

describe('P2-06: Settings Compliance Audit Trail & SMS_GATEWAY', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('Compliance Audit Trail tab', () => {
    it('renders dedicated Tenant Audit Trail on ?tab=audit instead of integrations block', async () => {
      setupDefaultMocks(adminUser)
      renderSettingsApp('/settings?tab=audit')

      expect(await screen.findByText(/Tenant Compliance Audit Trail/i)).toBeInTheDocument()
      expect(screen.queryByText(/External Provider Adapters/i)).not.toBeInTheDocument()

      await waitFor(() => {
        expect(mockedGet).toHaveBeenCalledWith('/audit-logs', {
          params: {
            page: 1,
            limit: 20,
            action: undefined,
            entityType: undefined,
          },
        })
      })

      expect(screen.getByText('integration.configured')).toBeInTheDocument()
      expect(screen.getByText('IntegrationConfig')).toBeInTheDocument()
      expect(screen.getByText('Anita Admin')).toBeInTheDocument()
      expect(screen.getByText('Recorded')).toBeInTheDocument()
      expect(screen.getByText('Failed / Rejected')).toBeInTheDocument()

      // Sensitive metadata values must never leak into rendered text
      expect(screen.queryByText(/raw_secret_should_never_render/)).not.toBeInTheDocument()
      expect(screen.queryByText(/raw_nested_key/)).not.toBeInTheDocument()
      expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument()
    })

    it('switches to Compliance Audit Trail tab cleanly on click from Integrations', async () => {
      const user = userEvent.setup()
      setupDefaultMocks(managerUser)
      renderSettingsApp('/settings')

      await screen.findByText(/External Provider Adapters/i)
      await user.click(screen.getByRole('button', { name: /Compliance Audit Trail/i }))

      expect(await screen.findByText(/Tenant Compliance Audit Trail/i)).toBeInTheDocument()
      expect(screen.queryByText(/External Provider Adapters/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Team & Roles/i })).not.toBeInTheDocument()
    })

    it('supports action/entity filters, empty state, and pagination', async () => {
      const user = userEvent.setup()
      setupDefaultMocks(adminUser)
      renderSettingsApp('/settings?tab=audit')

      await screen.findByText('integration.configured')
      expect(screen.getByText(/Page 1 of 2 · 25 entries/i)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Next/i }))
      expect(await screen.findByText('customer.created')).toBeInTheDocument()
      expect(screen.getByText(/Page 2 of 2 · 25 entries/i)).toBeInTheDocument()

      // Filter with no matching results -> empty state
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/integrations') return Promise.resolve({ data: sampleIntegrations })
        if (url === '/audit-logs') {
          return Promise.resolve({ data: { data: [], total: 0, page: 1, limit: 20 } })
        }
        return Promise.resolve({ data: {} })
      })

      await user.type(screen.getByLabelText(/Filter by action/i), 'nonexistent.action')
      await user.selectOptions(screen.getByLabelText(/Filter by entity type/i), 'Invoice')
      await user.click(screen.getByRole('button', { name: /Apply Filter/i }))

      expect(
        await screen.findByText(/No audit records match the selected filters/i),
      ).toBeInTheDocument()
      expect(mockedGet).toHaveBeenCalledWith('/audit-logs', {
        params: {
          page: 1,
          limit: 20,
          action: 'nonexistent.action',
          entityType: 'Invoice',
        },
      })
    })

    it('shows error state with Retry and recovers when /audit-logs fails then succeeds', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')
      let failOnce = true

      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/integrations') return Promise.resolve({ data: sampleIntegrations })
        if (url === '/audit-logs') {
          if (failOnce) {
            failOnce = false
            return Promise.reject({
              response: { status: 500, data: { message: 'Audit DB timeout' } },
            })
          }
          return Promise.resolve({ data: sampleAuditPage1 })
        }
        return Promise.resolve({ data: {} })
      })

      renderSettingsApp('/settings?tab=audit')

      expect(await screen.findByRole('alert')).toHaveTextContent(/Audit DB timeout/i)
      await user.click(screen.getByRole('button', { name: /Retry/i }))

      expect(await screen.findByText('integration.configured')).toBeInTheDocument()
    })

    it('shows explicit permission message when /audit-logs returns 403', async () => {
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-manager')
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: managerUser })
        if (url === '/integrations') return Promise.resolve({ data: sampleIntegrations })
        if (url === '/audit-logs') {
          return Promise.reject({ response: { status: 403 } })
        }
        return Promise.resolve({ data: {} })
      })

      renderSettingsApp('/settings?tab=audit')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /You do not have permission to view tenant audit logs/i,
      )
    })

    it('blocks AGENT from accessing /settings and does not call /audit-logs or /integrations', async () => {
      setupDefaultMocks(agentUser)
      renderSettingsApp('/settings?tab=audit')

      expect(await screen.findByText(/Access Denied/i)).toBeInTheDocument()
      expect(mockedGet).not.toHaveBeenCalledWith('/audit-logs', expect.anything())
      expect(mockedGet).not.toHaveBeenCalledWith('/integrations')
    })
  })

  describe('SMS_GATEWAY integration settings', () => {
    it('renders SMS_GATEWAY card with safe simulation notice and never prefills secret inputs', async () => {
      setupDefaultMocks(adminUser)
      renderSettingsApp('/settings')

      const smsCard = await screen.findByTestId('provider-card-SMS_GATEWAY')
      const cardScope = within(smsCard)

      expect(cardScope.getByText(/SMS Gateway \(DLT \/ Carrier\)/i)).toBeInTheDocument()
      expect(cardScope.getByText(/Simulation & Test Mode/i)).toBeInTheDocument()
      expect(cardScope.getByText(/Stored: \*\*\*\*7890/)).toBeInTheDocument()

      const vendorSelect = cardScope.getByLabelText(/SMS Vendor/i) as HTMLSelectElement
      const accountSidInput = cardScope.getByLabelText(/Account SID/i) as HTMLInputElement
      const authTokenInput = cardScope.getByLabelText(/Auth Token/i) as HTMLInputElement
      const senderIdInput = cardScope.getByLabelText(/DLT Sender ID/i) as HTMLInputElement

      expect(vendorSelect.value).toBe('GUPSHUP')
      expect(accountSidInput.value).toBe('AC_TEST_123')
      expect(senderIdInput.value).toBe('MCASHF')
      // Secret field MUST stay blank instead of prefilling masked placeholder
      expect(authTokenInput.value).toBe('')
      expect(authTokenInput.placeholder).toMatch(/Leave blank to keep stored credential/i)

      // Also verify Razorpay short-secret mask ('********') is shown as hint and NOT prefilled into PasswordInput
      const rzpCard = screen.getByTestId('provider-card-RAZORPAY')
      const rzpScope = within(rzpCard)
      expect(rzpScope.getByText(/Stored: \*\*\*\*\*\*\*\*/)).toBeInTheDocument()
      expect((rzpScope.getByLabelText(/Webhook Secret/i) as HTMLInputElement).value).toBe('')
    })

    it('preserves stored secrets by omitting blank secret fields when saving SMS_GATEWAY', async () => {
      const user = userEvent.setup()
      setupDefaultMocks(adminUser)
      mockedPut.mockResolvedValue({
        data: {
          ...sampleIntegrations[1],
          config: { ...sampleIntegrations[1].config, senderId: 'NEWMCF' },
        },
      })

      renderSettingsApp('/settings')
      const smsCard = await screen.findByTestId('provider-card-SMS_GATEWAY')
      const cardScope = within(smsCard)

      const senderIdInput = cardScope.getByLabelText(/DLT Sender ID/i)
      await user.clear(senderIdInput)
      await user.type(senderIdInput, 'NEWMCF')

      await user.click(cardScope.getByRole('button', { name: /Save Config/i }))

      await waitFor(() => {
        expect(mockedPut).toHaveBeenCalledWith('/integrations/SMS_GATEWAY', {
          isActive: true,
          config: {
            provider: 'GUPSHUP',
            accountSid: 'AC_TEST_123',
            senderId: 'NEWMCF',
            entityId: '110100001234',
            templateId: '110700005678',
            testRecipient: '+919876543210',
          },
        })
      })

      const savePayload = mockedPut.mock.calls[0][1] as { config: Record<string, unknown> }
      expect(savePayload.config).not.toHaveProperty('authToken')
      expect(await cardScope.findByRole('status')).toHaveTextContent(
        /Configuration saved successfully/i,
      )
    })

    it('sends new authToken when explicitly entered and masks returned secret without prefilling', async () => {
      const user = userEvent.setup()
      setupDefaultMocks(adminUser)
      mockedPut.mockResolvedValue({
        data: {
          ...sampleIntegrations[1],
          config: { ...sampleIntegrations[1].config, authToken: '****9999' },
        },
      })

      renderSettingsApp('/settings')
      const smsCard = await screen.findByTestId('provider-card-SMS_GATEWAY')
      const cardScope = within(smsCard)

      const authTokenInput = cardScope.getByLabelText(/Auth Token/i) as HTMLInputElement
      await user.type(authTokenInput, 'new_secret_token_9999')
      await user.click(cardScope.getByRole('button', { name: /Save Config/i }))

      await waitFor(() => {
        expect(mockedPut).toHaveBeenCalledWith(
          '/integrations/SMS_GATEWAY',
          expect.objectContaining({
            config: expect.objectContaining({
              authToken: 'new_secret_token_9999',
            }),
          }),
        )
      })

      expect(authTokenInput.value).toBe('')
      expect(cardScope.getByText(/Stored: \*\*\*\*9999/)).toBeInTheDocument()
    })

    it('runs simulated SMS_GATEWAY connection test and displays result', async () => {
      const user = userEvent.setup()
      setupDefaultMocks(adminUser)
      mockedPost.mockResolvedValue({
        data: {
          provider: 'SMS_GATEWAY',
          status: 'SUCCESS',
          isSimulated: true,
          message: 'SMS Gateway dry-run passed safely in simulation mode (outbound delivery disabled).',
          messageId: 'sim_sms_12345',
        },
      })

      renderSettingsApp('/settings')
      const smsCard = await screen.findByTestId('provider-card-SMS_GATEWAY')
      const cardScope = within(smsCard)

      await user.click(cardScope.getByRole('button', { name: /Test Connection/i }))

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith('/integrations/SMS_GATEWAY/test')
      })

      expect(
        await cardScope.findByText(/SMS Gateway dry-run passed safely in simulation mode/i),
      ).toBeInTheDocument()
      expect(cardScope.getByText('sim_sms_12345')).toBeInTheDocument()
    })

    it('handles failed /integrations fetch cleanly without crashing', async () => {
      localStorage.setItem(ACCESS_TOKEN_KEY, 'jwt-admin')
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve({ data: adminUser })
        if (url === '/integrations') {
          return Promise.reject({
            response: { status: 500, data: { message: 'Failed to load integration configs' } },
          })
        }
        return Promise.resolve({ data: {} })
      })

      renderSettingsApp('/settings')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /Failed to load integration configs/i,
      )
      expect(screen.getByTestId('provider-card-SMS_GATEWAY')).toBeInTheDocument()
    })
  })
})
