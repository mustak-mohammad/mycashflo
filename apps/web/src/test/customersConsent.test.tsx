import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { ToastProvider } from '../store/ToastContext'
import CustomersPage from '../pages/CustomersPage'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage'
import type { Customer, Paginated, User } from '../types'

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
const mockedPatch = vi.mocked(apiClient.patch)

describe('CustomersPage — Structured Communication Consent (Phase 1C)', () => {
  const adminUser: User = {
    id: 'user_admin',
    name: 'Admin User',
    email: 'admin@mycashflo.in',
    role: 'ADMIN',
    tenantId: 'tenant_1',
  }

  const sampleCustomers: Customer[] = [
    {
      id: 'cust_1',
      name: 'Alpha Traders',
      email: 'alpha@traders.in',
      phone: '+91 98765 00001',
      outstandingBalance: 15000,
      currency: 'INR',
      status: 'ACTIVE',
      createdAt: '2026-10-01T00:00:00Z',
      tenantId: 'tenant_1',
      emailConsent: 'OPTED_IN',
      whatsappConsent: 'OPTED_OUT',
      smsConsent: 'UNKNOWN',
    },
    {
      id: 'cust_2',
      name: 'Beta Enterprises',
      email: 'beta@ent.in',
      phone: '+91 98765 00002',
      outstandingBalance: 30000,
      currency: 'INR',
      status: 'ACTIVE',
      createdAt: '2026-10-02T00:00:00Z',
      tenantId: 'tenant_1',
      notes: '[DND:NO_CONTACT - WhatsApp Opt-Out on 2026-10-15]',
      emailConsent: 'UNKNOWN',
      whatsappConsent: 'UNKNOWN',
      smsConsent: 'UNKNOWN',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-admin-jwt')

    mockedGet.mockImplementation((url: string) => {
      if (url === '/auth/me') {
        return Promise.resolve({ data: adminUser })
      }
      if (url.startsWith('/customers')) {
        const paginated: Paginated<Customer> = {
          data: sampleCustomers,
          total: 2,
          page: 1,
          limit: 20,
        }
        return Promise.resolve({ data: paginated })
      }
      if (url.includes('/voice/document-deliveries')) {
        return Promise.resolve({ data: { data: [] } })
      }
      return Promise.reject(new Error(`Unhandled GET ${url}`))
    })

    mockedPatch.mockImplementation((url: string, data: any) => {
      if (url.startsWith('/customers/')) {
        return Promise.resolve({ data: { id: 'cust_1', ...data } })
      }
      return Promise.reject(new Error(`Unhandled PATCH ${url}`))
    })
  })

  function renderCustomersPage() {
    return render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <CustomersPage />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    )
  }

  it('renders table column for Consent Preferences with channel badges', async () => {
    renderCustomersPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha Traders')).toBeInTheDocument()
    })

    expect(screen.getByText('Consent Preferences')).toBeInTheDocument()

    // Customer 1 badges: Email Opted In, WhatsApp Opted Out
    const emailInBadge = screen.getByTitle('Email: Opted in (Consent granted)')
    expect(emailInBadge).toBeInTheDocument()
    expect(emailInBadge).toHaveTextContent('Email')

    const waOutBadge = screen.getByTitle('WhatsApp: Opted out (Cease contact)')
    expect(waOutBadge).toBeInTheDocument()
    expect(waOutBadge).toHaveTextContent('WhatsApp')

    // SMS and Voice Unknown exist for both customers
    const smsUnkBadges = screen.getAllByTitle('SMS: Unknown consent (Outreach suppressed)')
    expect(smsUnkBadges.length).toBe(2)

    const voiceUnkBadges = screen.getAllByTitle('Voice: Unknown consent (Outreach suppressed)')
    expect(voiceUnkBadges.length).toBe(2)

    // Customer 2: Legacy DND badge
    expect(screen.getByText('Legacy DND')).toBeInTheDocument()
  })

  it('allows editing customer consent preferences and saves changes', async () => {
    const user = userEvent.setup()
    renderCustomersPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha Traders')).toBeInTheDocument()
    })

    // Wait for Admin role to resolve and show Edit buttons
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
    })

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    await user.click(editButtons[0])

    // Modal opens
    expect(screen.getByText('Edit Customer')).toBeInTheDocument()
    expect(screen.getByText('Communication Channel Consent')).toBeInTheDocument()

    // Email select should have OPTED_IN, WhatsApp should have OPTED_OUT, SMS should have UNKNOWN, Voice should have UNKNOWN
    const selects = screen.getAllByRole('combobox')
    const emailSelect = selects[0]
    const waSelect = selects[1]
    const smsSelect = selects[2]
    const voiceSelect = selects[3]

    expect(emailSelect).toHaveValue('OPTED_IN')
    expect(waSelect).toHaveValue('OPTED_OUT')
    expect(smsSelect).toHaveValue('UNKNOWN')
    expect(voiceSelect).toHaveValue('UNKNOWN')

    // Change WhatsApp consent to OPTED_IN
    await user.selectOptions(waSelect, 'OPTED_IN')
    expect(waSelect).toHaveValue('OPTED_IN')

    // Submit form
    const saveButton = screen.getByRole('button', { name: 'Update Customer' })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith(
        '/customers/cust_1',
        expect.objectContaining({
          name: 'Alpha Traders',
          whatsappConsent: 'OPTED_IN',
        }),
      )
    })
  })

  it('omits consent fields from update payload when only unrelated details are edited', async () => {
    const user = userEvent.setup()
    renderCustomersPage()

    await waitFor(() => {
      expect(screen.getByText('Alpha Traders')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
    })

    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    await user.click(editButtons[0])

    expect(screen.getByText('Edit Customer')).toBeInTheDocument()

    // Only edit business name
    const nameInput = screen.getByPlaceholderText(/e\.g\. Apex Infotech/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Alpha Traders Pvt Ltd')

    const saveButton = screen.getByRole('button', { name: 'Update Customer' })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledWith(
        '/customers/cust_1',
        expect.objectContaining({
          name: 'Alpha Traders Pvt Ltd',
        }),
      )
    })

    const patchCallPayload = mockedPatch.mock.calls[0][1] as any
    expect(patchCallPayload.emailConsent).toBeUndefined()
    expect(patchCallPayload.whatsappConsent).toBeUndefined()
    expect(patchCallPayload.smsConsent).toBeUndefined()
    expect(patchCallPayload.voiceConsent).toBeUndefined()
  })
})
