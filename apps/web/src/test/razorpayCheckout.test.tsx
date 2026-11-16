import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { ToastProvider } from '../store/ToastContext'
import InvoicesPage from '../pages/InvoicesPage'
import {
  RazorpayCheckoutModal,
  isInvoicePayable,
} from '../components/payments/RazorpayCheckoutModal'
import {
  loadRazorpayCheckoutScript,
  resetRazorpayLoaderForTests,
  RAZORPAY_CHECKOUT_SCRIPT_URL,
} from '../utils/razorpayLoader'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage'
import type { Invoice, User } from '../types'

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

const managerUser: User = {
  id: 'u-mgr-1',
  email: 'manager@mycashflo.in',
  name: 'Manoj Manager',
  role: 'MANAGER',
  tenantId: 't-test-1',
}

const mockInvoices: Invoice[] = [
  {
    id: 'inv-open-1',
    number: 'INV-2026-001',
    customerId: 'cust-1',
    customer: { name: 'Acme Corp' },
    amount: 50000,
    outstanding: 50000,
    currency: 'INR',
    status: 'OPEN',
    issueDate: '2026-11-01T00:00:00.000Z',
    dueDate: '2026-11-30T00:00:00.000Z',
    tenantId: 't-test-1',
  },
  {
    id: 'inv-overdue-2',
    number: 'INV-2026-002',
    customerId: 'cust-2',
    customer: { name: 'Beta Ltd' },
    amount: 30000,
    outstanding: 15000,
    currency: 'INR',
    status: 'OVERDUE',
    issueDate: '2026-10-01T00:00:00.000Z',
    dueDate: '2026-10-31T00:00:00.000Z',
    tenantId: 't-test-1',
  },
  {
    id: 'inv-paid-3',
    number: 'INV-2026-003',
    customerId: 'cust-3',
    customer: { name: 'Gamma Enterprises' },
    amount: 25000,
    outstanding: 0,
    currency: 'INR',
    status: 'PAID',
    issueDate: '2026-10-15T00:00:00.000Z',
    dueDate: '2026-11-15T00:00:00.000Z',
    tenantId: 't-test-1',
  },
  {
    id: 'inv-cancelled-4',
    number: 'INV-2026-004',
    customerId: 'cust-4',
    customer: { name: 'Delta Co' },
    amount: 10000,
    outstanding: 10000,
    currency: 'INR',
    status: 'CANCELLED',
    issueDate: '2026-10-10T00:00:00.000Z',
    dueDate: '2026-11-10T00:00:00.000Z',
    tenantId: 't-test-1',
  },
  {
    id: 'inv-draft-5',
    number: 'INV-2026-005',
    customerId: 'cust-5',
    customer: { name: 'Epsilon Tech' },
    amount: 40000,
    outstanding: 40000,
    currency: 'INR',
    status: 'DRAFT',
    issueDate: '2026-11-10T00:00:00.000Z',
    dueDate: '2026-12-10T00:00:00.000Z',
    tenantId: 't-test-1',
  },
]

describe('Razorpay Standard Checkout UI & SDK Integration (Test Mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-jwt-token')
    resetRazorpayLoaderForTests()
    delete window.Razorpay

    // Default mock responses
    mockedGet.mockImplementation((url: string) => {
      if (url === '/auth/me') {
        return Promise.resolve({ data: { user: managerUser } })
      }
      if (url === '/invoices') {
        return Promise.resolve({
          data: {
            data: mockInvoices,
            total: mockInvoices.length,
            page: 1,
            limit: 20,
          },
        })
      }
      if (url === '/customers') {
        return Promise.resolve({
          data: {
            data: [{ id: 'cust-1', name: 'Acme Corp' }],
            total: 1,
            page: 1,
            limit: 100,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
  })

  afterEach(() => {
    resetRazorpayLoaderForTests()
    delete window.Razorpay
    // Clean up any injected scripts
    document
      .querySelectorAll(`script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`)
      .forEach((el) => el.remove())
  })

  // ── 1. Script Loader Utility Tests ──────────────────────────────────────────
  describe('loadRazorpayCheckoutScript Utility', () => {
    it('resolves immediately if window.Razorpay is already present', async () => {
      const mockCtor = vi.fn() as any
      window.Razorpay = mockCtor

      const loaded = await loadRazorpayCheckoutScript()
      expect(loaded).toBe(mockCtor)
      expect(document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`)).toBeNull()
    })

    it('injects script tag and resolves when script triggers load event', async () => {
      const loadPromise = loadRazorpayCheckoutScript()

      const script = document.querySelector<HTMLScriptElement>(
        `script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`,
      )
      expect(script).not.toBeNull()
      expect(script?.async).toBe(true)

      // Simulate script executing and defining window.Razorpay
      const mockCtor = vi.fn() as any
      window.Razorpay = mockCtor
      script?.dispatchEvent(new Event('load'))

      const resolved = await loadPromise
      expect(resolved).toBe(mockCtor)
    })

    it('deduplicates concurrent load calls by returning the same singleton promise', async () => {
      const promise1 = loadRazorpayCheckoutScript()
      const promise2 = loadRazorpayCheckoutScript()

      expect(promise1).toBe(promise2)
      const scripts = document.querySelectorAll(`script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`)
      expect(scripts.length).toBe(1)

      const mockCtor = vi.fn() as any
      window.Razorpay = mockCtor
      scripts[0].dispatchEvent(new Event('load'))

      const [res1, res2] = await Promise.all([promise1, promise2])
      expect(res1).toBe(mockCtor)
      expect(res2).toBe(mockCtor)
    })

    it('rejects with error if script fails to load and allows retry', async () => {
      const promise = loadRazorpayCheckoutScript()
      const script = document.querySelector<HTMLScriptElement>(
        `script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`,
      )

      script?.dispatchEvent(new Event('error'))

      await expect(promise).rejects.toThrow(/Failed to load Razorpay Checkout SDK/)

      // Ensure promise cache was reset so subsequent call can try again
      resetRazorpayLoaderForTests()
      const retryPromise = loadRazorpayCheckoutScript()
      expect(retryPromise).not.toBe(promise)
    })
  })

  // ── 2. Invoice Eligibility & Actions in InvoicesPage ─────────────────────────
  describe('Invoice Eligibility Rules & Pay Now Action in InvoicesPage', () => {
    it('correctly assesses invoice payment eligibility via isInvoicePayable', () => {
      expect(isInvoicePayable(mockInvoices[0])).toBe(true) // OPEN, outstanding 50000
      expect(isInvoicePayable(mockInvoices[1])).toBe(true) // OVERDUE, outstanding 15000
      expect(isInvoicePayable(mockInvoices[2])).toBe(false) // PAID, outstanding 0
      expect(isInvoicePayable(mockInvoices[3])).toBe(false) // CANCELLED
      expect(isInvoicePayable(mockInvoices[4])).toBe(false) // DRAFT
      expect(isInvoicePayable(null)).toBe(false)
      expect(isInvoicePayable(undefined)).toBe(false)
    })

    it('renders enabled Pay Now buttons for eligible invoices and disabled buttons for ineligible invoices', async () => {
      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter>
              <InvoicesPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      await waitFor(() => {
        expect(screen.getByText('INV-2026-001')).toBeInTheDocument()
      })

      // INV-2026-001 (OPEN, 50k outstanding) -> Enabled Pay Now
      const payBtn1 = screen.getByTestId('pay-now-btn-inv-open-1')
      expect(payBtn1).toBeEnabled()
      expect(payBtn1).toHaveTextContent('Pay Now')

      // INV-2026-002 (OVERDUE, 15k outstanding) -> Enabled Pay Now
      const payBtn2 = screen.getByTestId('pay-now-btn-inv-overdue-2')
      expect(payBtn2).toBeEnabled()

      // INV-2026-003 (PAID) -> Disabled Pay Now with paid tooltip
      const payBtn3 = screen.getByTestId('pay-now-btn-inv-paid-3')
      expect(payBtn3).toBeDisabled()
      expect(payBtn3).toHaveAttribute('title', 'Invoice is already paid in full')

      // INV-2026-004 (CANCELLED) -> Disabled Pay Now
      const payBtn4 = screen.getByTestId('pay-now-btn-inv-cancelled-4')
      expect(payBtn4).toBeDisabled()
      expect(payBtn4).toHaveAttribute('title', 'Cannot pay cancelled invoice')

      // INV-2026-005 (DRAFT) -> Disabled Pay Now
      const payBtn5 = screen.getByTestId('pay-now-btn-inv-draft-5')
      expect(payBtn5).toBeDisabled()
      expect(payBtn5).toHaveAttribute('title', 'Cannot pay draft invoice')
    })

    it('opens invoice details modal on invoice number click and allows launching Pay Now', async () => {
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter>
              <InvoicesPage />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>,
      )

      await waitFor(() => {
        expect(screen.getByText('INV-2026-001')).toBeInTheDocument()
      })

      // Click on invoice number link
      const invLink = screen.getByRole('button', { name: 'INV-2026-001' })
      await user.click(invLink)

      // Invoice Details modal should open
      const detailsDialog = screen.getByRole('dialog', { name: /Invoice INV-2026-001/i })
      expect(detailsDialog).toBeInTheDocument()
      expect(within(detailsDialog).getByText('Acme Corp')).toBeInTheDocument()

      // Click Pay Now in details modal
      const detailPayNowBtn = within(detailsDialog).getByTestId('detail-pay-now-btn')
      expect(detailPayNowBtn).toBeEnabled()
      await user.click(detailPayNowBtn)

      // Razorpay Checkout Modal should be open
      expect(screen.getByRole('dialog', { name: /Pay Invoice INV-2026-001/i })).toBeInTheDocument()
      expect(screen.getByText('🧪 Test Mode')).toBeInTheDocument()
    })
  })

  // ── 3. Razorpay Checkout Flow, Verification & Concurrency Safeguards ──────────
  describe('Razorpay Checkout Modal End-to-End Flow', () => {
    function setupMockRazorpay(overrides?: {
      onOpen?: () => void
      onOn?: (event: string, handler: any) => void
      onInit?: (options: any) => void
    }) {
      let capturedOptions: any = null
      const mockOpen = vi.fn().mockImplementation(() => {
        overrides?.onOpen?.()
      })
      const mockOn = vi.fn().mockImplementation((event: string, handler: any) => {
        overrides?.onOn?.(event, handler)
      })

      class MockRazorpay {
        open = mockOpen
        on = mockOn
        constructor(opts: any) {
          capturedOptions = opts
          overrides?.onInit?.(opts)
        }
      }

      window.Razorpay = MockRazorpay as any
      return {
        getCapturedOptions: () => capturedOptions,
        mockOpen,
        mockOn,
      }
    }

    it('creates Razorpay order, loads SDK, and opens Standard Checkout modal with test credentials', async () => {
      const user = userEvent.setup()
      const { getCapturedOptions, mockOpen, mockOn } = setupMockRazorpay()

      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_test_9999',
          paymentId: 'pay_db_1',
          provider: 'RAZORPAY',
          keyId: 'rzp_test_AcmeTestKey123',
          amount: 50000,
          amountInPaise: 5000000,
          currency: 'INR',
          receipt: 'rcpt_inv_001_123',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Acme Corp',
          customerEmail: 'billing@acmecorp.in',
          customerPhone: '+919876543210',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]}
            isOpen={true}
            onClose={vi.fn()}
            onPaymentSuccess={vi.fn()}
          />
        </ToastProvider>,
      )

      expect(screen.getByText('Pay Invoice INV-2026-001')).toBeInTheDocument()
      expect(screen.getByText('Test Sandbox Mode:')).toBeInTheDocument()

      const payButton = screen.getByRole('button', { name: /Pay ₹50,000 Now/i })
      await user.click(payButton)

      // Verify POST /payments/razorpay/order was called with correct parameters
      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith(
          '/payments/razorpay/order',
          expect.objectContaining({
            invoiceId: 'inv-open-1',
            amount: 50000,
            currency: 'INR',
            idempotencyKey: expect.stringMatching(/^chk_inv-open-1_/),
          }),
        )
      })

      // Verify Razorpay constructor was called with public test key and order params
      await waitFor(() => {
        expect(getCapturedOptions()).not.toBeNull()
      })
      const captured = getCapturedOptions()
      expect(captured.key).toBe('rzp_test_AcmeTestKey123')
      expect(captured.order_id).toBe('order_test_9999')
      expect(captured.amount).toBe(5000000)
      expect(captured.currency).toBe('INR')
      expect(captured.prefill.name).toBe('Acme Corp')
      expect(captured.prefill.email).toBe('billing@acmecorp.in')
      expect(captured.prefill.contact).toBe('+919876543210')

      // Verify checkout modal open was triggered
      expect(mockOpen).toHaveBeenCalledTimes(1)
      expect(mockOn).toHaveBeenCalledWith('payment.failed', expect.any(Function))
    })

    it('submits verification on checkout success and confirms settlement on COMPLETED response', async () => {
      const user = userEvent.setup()
      const { getCapturedOptions } = setupMockRazorpay()
      const mockSuccessCallback = vi.fn()

      // 1. Mock order creation
      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_test_1001',
          paymentId: 'pay_db_1',
          provider: 'RAZORPAY',
          keyId: 'rzp_test_Key456',
          amount: 50000,
          amountInPaise: 5000000,
          currency: 'INR',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Acme Corp',
          customerEmail: 'billing@acme.com',
          customerPhone: '+919999999999',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      // 2. Mock verification response
      mockedPost.mockResolvedValueOnce({
        data: {
          verified: true,
          idempotent: false,
          status: 'COMPLETED',
          orderId: 'order_test_1001',
          providerPaymentId: 'pay_rzp_gateway_8888',
          paymentId: 'pay_db_settled_1',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          paidAmount: 50000,
          remainingOutstanding: 0,
          invoiceStatus: 'PAID',
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]}
            isOpen={true}
            onClose={vi.fn()}
            onPaymentSuccess={mockSuccessCallback}
          />
        </ToastProvider>,
      )

      const payButton = screen.getByRole('button', { name: /Pay ₹50,000 Now/i })
      await user.click(payButton)

      await waitFor(() => {
        expect(getCapturedOptions()).not.toBeNull()
      })

      // Simulate Razorpay Standard Checkout invoking options.handler upon successful payment
      await getCapturedOptions().handler({
        razorpay_order_id: 'order_test_1001',
        razorpay_payment_id: 'pay_rzp_gateway_8888',
        razorpay_signature: 'valid_hmac_sha256_sig_test',
      })

      // Verify verification endpoint was called
      expect(mockedPost).toHaveBeenCalledWith('/payments/razorpay/verify', {
        invoiceId: 'inv-open-1',
        razorpay_order_id: 'order_test_1001',
        razorpay_payment_id: 'pay_rzp_gateway_8888',
        razorpay_signature: 'valid_hmac_sha256_sig_test',
      })

      // Check that success confirmation is rendered in UI
      await waitFor(() => {
        expect(screen.getByText('Payment Verified & Reconciled!')).toBeInTheDocument()
      })
      expect(screen.getByText('pay_rzp_gateway_8888')).toBeInTheDocument()
      expect(mockSuccessCallback).toHaveBeenCalledTimes(1)
      expect(mockSuccessCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          verified: true,
          status: 'COMPLETED',
          paidAmount: 50000,
          remainingOutstanding: 0,
        }),
      )
    })

    it('supports partial payment within range and validates exceeding amounts', async () => {
      const user = userEvent.setup()

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]} // outstanding: 50000
            isOpen={true}
            onClose={vi.fn()}
          />
        </ToastProvider>,
      )

      // Click "Partial Payment"
      const partialOption = screen.getByRole('button', { name: /Partial Payment/i })
      await user.click(partialOption)

      const amountInput = screen.getByPlaceholderText(/Enter amount up to 50000/i)
      expect(amountInput).toBeInTheDocument()

      // Enter amount exceeding outstanding (60000 > 50000)
      await user.clear(amountInput)
      await user.type(amountInput, '60000')

      const payBtn = screen.getByRole('button', { name: /Pay ₹60,000 Now/i })
      await user.click(payBtn)

      // Should display error without sending API request
      expect(
        screen.getByText(/Payment amount \(₹60,000\) cannot exceed outstanding balance \(₹50,000\)/i),
      ).toBeInTheDocument()
      expect(mockedPost).not.toHaveBeenCalled()
    })

    it('handles authorized pending capture (status: PENDING) without marking invoice paid', async () => {
      const user = userEvent.setup()
      const { getCapturedOptions } = setupMockRazorpay()
      const mockSuccessCallback = vi.fn()

      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_test_2002',
          paymentId: 'pay_db_2',
          provider: 'RAZORPAY',
          keyId: 'rzp_test_Key456',
          amount: 15000,
          amountInPaise: 1500000,
          currency: 'INR',
          invoiceId: 'inv-overdue-2',
          invoiceNumber: 'INV-2026-002',
          customerName: 'Beta Ltd',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      // Verification returns PENDING (authorized, capture delayed)
      mockedPost.mockResolvedValueOnce({
        data: {
          verified: false,
          idempotent: false,
          status: 'PENDING',
          orderId: 'order_test_2002',
          paymentId: 'pay_db_2',
          invoiceId: 'inv-overdue-2',
          invoiceNumber: 'INV-2026-002',
          invoiceStatus: 'OVERDUE',
          remainingOutstanding: 15000,
          message: 'Payment is authorized/pending capture; invoice balance unchanged.',
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[1]} // outstanding: 15000
            isOpen={true}
            onClose={vi.fn()}
            onPaymentSuccess={mockSuccessCallback}
          />
        </ToastProvider>,
      )

      await user.click(screen.getByRole('button', { name: /Pay ₹15,000 Now/i }))

      await waitFor(() => {
        expect(getCapturedOptions()).not.toBeNull()
      })

      // Simulate handler callback
      await getCapturedOptions().handler({
        razorpay_order_id: 'order_test_2002',
        razorpay_payment_id: 'pay_rzp_auth_only',
        razorpay_signature: 'valid_sig_test',
      })

      // Should show pending capture notice and NOT call onPaymentSuccess
      await waitFor(() => {
        expect(screen.getByText('Payment Authorized (Pending Capture)')).toBeInTheDocument()
      })
      expect(mockSuccessCallback).not.toHaveBeenCalled()
    })

    it('handles user cancellation (modal.ondismiss) cleanly without corrupting state', async () => {
      const user = userEvent.setup()
      const { getCapturedOptions } = setupMockRazorpay()

      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_test_3003',
          paymentId: 'pay_db_3',
          provider: 'RAZORPAY',
          keyId: 'rzp_test_Key789',
          amount: 50000,
          amountInPaise: 5000000,
          currency: 'INR',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Acme Corp',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]}
            isOpen={true}
            onClose={vi.fn()}
          />
        </ToastProvider>,
      )

      await user.click(screen.getByRole('button', { name: /Pay ₹50,000 Now/i }))

      await waitFor(() => {
        expect(getCapturedOptions()).not.toBeNull()
      })

      // Trigger modal dismissal
      getCapturedOptions().modal.ondismiss()

      // The button should be re-enabled and ready for another attempt
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Pay ₹50,000 Now/i })).toBeEnabled()
      })
    })

    it('surfaces payment decline from Razorpay payment.failed event', async () => {
      const user = userEvent.setup()
      let failureHandler: any = null
      setupMockRazorpay({
        onOn: (event, handler) => {
          if (event === 'payment.failed') {
            failureHandler = handler
          }
        },
      })

      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_test_4004',
          paymentId: 'pay_db_4',
          provider: 'RAZORPAY',
          keyId: 'rzp_test_Key789',
          amount: 50000,
          amountInPaise: 5000000,
          currency: 'INR',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Acme Corp',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]}
            isOpen={true}
            onClose={vi.fn()}
          />
        </ToastProvider>,
      )

      await user.click(screen.getByRole('button', { name: /Pay ₹50,000 Now/i }))

      await waitFor(() => {
        expect(failureHandler).not.toBeNull()
      })

      // Trigger payment failure
      failureHandler({
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Payment was declined by the issuing bank.',
          reason: 'payment_failed',
        },
      })

      await waitFor(() => {
        expect(
          screen.getByText('Payment was declined by the issuing bank.'),
        ).toBeInTheDocument()
      })
    })

    it('enforces live mode guardrail and blocks order if rzp_live key is returned', async () => {
      const user = userEvent.setup()

      mockedPost.mockResolvedValueOnce({
        data: {
          orderId: 'order_live_forbidden',
          paymentId: 'pay_live_1',
          provider: 'RAZORPAY',
          keyId: 'rzp_live_ForbiddenSecretLiveKey',
          amount: 50000,
          amountInPaise: 5000000,
          currency: 'INR',
          invoiceId: 'inv-open-1',
          invoiceNumber: 'INV-2026-001',
          customerName: 'Acme Corp',
          status: 'CREATED',
          reusedExistingOrder: false,
          isSimulated: false,
        },
      })

      render(
        <ToastProvider>
          <RazorpayCheckoutModal
            invoice={mockInvoices[0]}
            isOpen={true}
            onClose={vi.fn()}
          />
        </ToastProvider>,
      )

      await user.click(screen.getByRole('button', { name: /Pay ₹50,000 Now/i }))

      // Should display safety error and never initialize Razorpay
      await waitFor(() => {
        expect(
          screen.getAllByText(/Security Error: Razorpay Live Mode keys are forbidden/).length,
        ).toBeGreaterThan(0)
      })
    })
  })
})
