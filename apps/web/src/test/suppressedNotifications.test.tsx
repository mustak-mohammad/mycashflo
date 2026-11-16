import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { ToastProvider } from '../store/ToastContext'
import IntelligencePage from '../pages/IntelligencePage'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage'
import type { NotifStatus } from '../../../../packages/shared-types'
import type { TriggerRemindersResult } from '../api/notifications'

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

describe('Phase 1C.1 — Shared Types & Suppressed Notification Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test_token')
  })

  it('validates NotifStatus union type includes SUPPRESSED and TriggerRemindersResult has suppressedCount', () => {
    const status: NotifStatus = 'SUPPRESSED'
    expect(status).toBe('SUPPRESSED')

    const result: TriggerRemindersResult = {
      evaluatedInvoices: 5,
      dispatchedCount: 2,
      failedCount: 1,
      suppressedCount: 2,
      details: [
        {
          invoiceNumber: 'INV-001',
          customerName: 'Acme',
          status: 'SUPPRESSED',
          suppressed: true,
          reason: 'Customer has not explicitly opted into EMAIL communications (consent state: UNKNOWN)',
        },
      ],
    }

    expect(result.suppressedCount).toBe(2)
    expect(result.details[0].status).toBe('SUPPRESSED')
  })

  it('renders SUPPRESSED notification badge with distinct styling in IntelligencePage', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({
          data: {
            user: {
              id: 'user_admin',
              name: 'Admin User',
              email: 'admin@democorp.in',
              role: 'ADMIN',
              tenantId: 'tenant_1',
            },
          },
        })
      }
      if (url.includes('/intelligence/actions/pending')) {
        return Promise.resolve({ data: [] })
      }
      if (url.includes('/intelligence/actions')) {
        return Promise.resolve({ data: [] })
      }
      if (url.includes('/notifications/templates')) {
        return Promise.resolve({ data: [] })
      }
      if (url.includes('/customers')) {
        return Promise.resolve({ data: { data: [] } })
      }
      if (url.includes('/audit-logs')) {
        return Promise.resolve({ data: [] })
      }
      if (url.includes('/notifications')) {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'notif_sup_01',
                channel: 'WHATSAPP',
                template: 'PAYMENT_REMINDER_OVERDUE',
                status: 'SUPPRESSED',
                createdAt: new Date().toISOString(),
                customer: { name: 'Late Payer Corp' },
                payload: { suppressionReason: 'Customer opted out of WhatsApp' },
              },
            ],
            total: 1,
          },
        })
      }
      return Promise.reject(new Error(`Unhandled GET url: ${url}`))
    })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <IntelligencePage />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    )

    const remindersTab = await screen.findByText('Multi-Channel Reminders')
    remindersTab.click()

    await waitFor(() => {
      expect(screen.getByText('SUPPRESSED')).toBeInTheDocument()
    })

    const badge = screen.getByText('SUPPRESSED')
    expect(badge).toHaveClass('text-purple-300')
    expect(badge).toHaveClass('bg-purple-500/20')
  })
})
