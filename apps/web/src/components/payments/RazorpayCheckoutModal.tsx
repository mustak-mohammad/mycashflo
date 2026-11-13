import { useState, useRef, useEffect } from 'react'
import { loadRazorpayCheckoutScript } from '../../utils/razorpayLoader'
import { paymentsApi } from '../../api/payments'
import { useToast } from '../../store/ToastContext'
import { extractSafeErrorMessage } from '../../utils/safeError'
import type {
  Invoice,
  VerifyRazorpayPaymentResponse,
  RazorpaySuccessResponse,
  RazorpayFailureResponse,
  RazorpayCheckoutOptions,
} from '../../types'

export interface RazorpayCheckoutModalProps {
  invoice: Invoice | null
  isOpen: boolean
  onClose: () => void
  onPaymentSuccess?: (result: VerifyRazorpayPaymentResponse) => void
}

type CheckoutStep =
  | 'IDLE'
  | 'CREATING_ORDER'
  | 'LOADING_SDK'
  | 'CHECKOUT_OPEN'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'PENDING'
  | 'ERROR'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function isInvoicePayable(inv: Invoice | null | undefined): boolean {
  if (!inv) return false
  if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'DRAFT') {
    return false
  }
  return Number(inv.outstanding) > 0
}

export function RazorpayCheckoutModal({
  invoice,
  isOpen,
  onClose,
  onPaymentSuccess,
}: RazorpayCheckoutModalProps) {
  const toast = useToast()

  const [step, setStep] = useState<CheckoutStep>('IDLE')
  const [payFullBalance, setPayFullBalance] = useState(true)
  const [customAmount, setCustomAmount] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [verifiedResult, setVerifiedResult] = useState<VerifyRazorpayPaymentResponse | null>(null)

  const inFlightRef = useRef(false)

  // Sync default amount when invoice opens
  useEffect(() => {
    if (invoice) {
      setPayFullBalance(true)
      setCustomAmount(String(invoice.outstanding || ''))
      setStep('IDLE')
      setErrorMessage(null)
      setPendingMessage(null)
      setVerifiedResult(null)
      inFlightRef.current = false
    }
  }, [invoice])

  if (!isOpen || !invoice) return null

  const payable = isInvoicePayable(invoice)
  const remainingOutstanding = Number(invoice.outstanding) || 0

  const resolvedAmount = payFullBalance
    ? remainingOutstanding
    : parseFloat(customAmount) || 0

  const handleStartCheckout = async () => {
    if (inFlightRef.current) return

    // Validation
    if (!payable) {
      setErrorMessage('This invoice is not eligible for payment.')
      return
    }

    if (isNaN(resolvedAmount) || resolvedAmount <= 0) {
      setErrorMessage('Please enter a valid positive payment amount.')
      return
    }

    if (resolvedAmount > remainingOutstanding) {
      setErrorMessage(
        `Payment amount (${fmt(resolvedAmount)}) cannot exceed outstanding balance (${fmt(remainingOutstanding)}).`,
      )
      return
    }

    inFlightRef.current = true
    setErrorMessage(null)
    setPendingMessage(null)
    setStep('CREATING_ORDER')

    try {
      // 1. Create order on server via POST /payments/razorpay/order
      const idempotencyKey = `chk_${invoice.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const order = await paymentsApi.createRazorpayOrder({
        invoiceId: invoice.id,
        amount: resolvedAmount,
        currency: invoice.currency || 'INR',
        idempotencyKey,
      })

      // Safeguard: Check that live mode keys are never used in test mode
      if (order.keyId && order.keyId.startsWith('rzp_live_')) {
        throw new Error(
          'Security Error: Razorpay Live Mode keys are forbidden. Only Test Mode keys are permitted.',
        )
      }

      // 2. Load Razorpay Checkout SDK dynamically
      setStep('LOADING_SDK')
      const RazorpaySDK = await loadRazorpayCheckoutScript()

      // 3. Configure Razorpay Standard Checkout options
      const options: RazorpayCheckoutOptions = {
        key: order.keyId,
        amount: order.amountInPaise,
        currency: order.currency || 'INR',
        name: 'myCashFlo',
        description: `Payment for Invoice ${invoice.number}`,
        order_id: order.orderId,
        prefill: {
          name: order.customerName || invoice.customer?.name || '',
          email: order.customerEmail || '',
          contact: order.customerPhone || '',
        },
        notes: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
        },
        theme: {
          color: '#4f46e5',
        },
        modal: {
          ondismiss: () => {
            inFlightRef.current = false
            setStep('IDLE')
            toast.info('Payment cancelled by user.')
          },
        },
        handler: async (response: RazorpaySuccessResponse) => {
          // 4. Send signature and IDs to backend verification endpoint
          setStep('VERIFYING')
          try {
            const verifyResult = await paymentsApi.verifyRazorpayPayment({
              invoiceId: invoice.id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            })

            if (verifyResult.verified && verifyResult.status === 'COMPLETED') {
              setVerifiedResult(verifyResult)
              setStep('SUCCESS')
              toast.success(
                `Payment of ${fmt(verifyResult.paidAmount ?? resolvedAmount)} verified successfully!`,
              )
              onPaymentSuccess?.(verifyResult)
            } else if (verifyResult.status === 'PENDING') {
              setPendingMessage(
                verifyResult.message ||
                  'Payment is authorized and pending capture; invoice balance unchanged.',
              )
              setStep('PENDING')
              toast.warning('Payment is authorized and awaiting gateway capture.')
            } else {
              throw new Error(
                verifyResult.message ||
                  'Payment verification returned non-completed status from gateway.',
              )
            }
          } catch (verifyErr: unknown) {
            const msg = extractSafeErrorMessage(
              verifyErr,
              'Payment verification failed. Please contact support.',
            )
            setErrorMessage(msg)
            setStep('ERROR')
            toast.error(msg)
          } finally {
            inFlightRef.current = false
          }
        },
      }

      // 4. Open Razorpay Checkout modal
      const rzpInstance = new RazorpaySDK(options)

      rzpInstance.on('payment.failed', (failRes: RazorpayFailureResponse) => {
        inFlightRef.current = false
        const failureReason =
          failRes?.error?.description || failRes?.error?.reason || 'Payment was declined or failed.'
        setErrorMessage(failureReason)
        setStep('ERROR')
        toast.error(`Razorpay Checkout Error: ${failureReason}`)
      })

      setStep('CHECKOUT_OPEN')
      rzpInstance.open()
    } catch (err: unknown) {
      inFlightRef.current = false
      const msg = extractSafeErrorMessage(err, 'Failed to initialize Razorpay checkout.')
      setErrorMessage(msg)
      setStep('ERROR')
      toast.error(msg)
    }
  }

  const isProcessing =
    step === 'CREATING_ORDER' ||
    step === 'LOADING_SDK' ||
    step === 'CHECKOUT_OPEN' ||
    step === 'VERIFYING'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="razorpay-checkout-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💳</span>
              <h3
                id="razorpay-checkout-title"
                className="text-base font-bold text-white tracking-tight"
              >
                Pay Invoice {invoice.number}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                🧪 Test Mode
              </span>
            </div>
            <p className="text-xs text-white/50 mt-1">
              Secure online remittance via Razorpay Standard Checkout
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close checkout modal"
            className="text-white/40 hover:text-white text-lg p-1 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>

        {/* Test Mode Sandbox Banner */}
        <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-200/90 flex items-center gap-2.5">
          <span className="text-base shrink-0">🛡️</span>
          <div>
            <span className="font-semibold text-amber-300">Test Sandbox Mode:</span> Real money will{' '}
            <strong>NOT</strong> be charged. Test card and simulated UPI credentials will succeed
            cleanly.
          </div>
        </div>

        {/* Invoice Summary Box */}
        <div className="p-4 rounded-xl space-y-2 bg-white/[0.02] border border-white/5 text-xs">
          <div className="flex justify-between text-white/70">
            <span>Customer:</span>
            <span className="font-semibold text-white">{invoice.customer?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Invoice Due Date:</span>
            <span className="text-white">{formatDate(invoice.dueDate)}</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Invoice Total:</span>
            <span className="font-mono text-white">{fmt(Number(invoice.amount))}</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Current Outstanding:</span>
            <span className="font-mono font-bold text-rose-400">
              {fmt(remainingOutstanding)}
            </span>
          </div>
        </div>

        {/* Ineligibility Warning */}
        {!payable && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2"
          >
            <span>⚠️</span>
            <span>
              {invoice.status === 'PAID'
                ? 'This invoice is already paid in full. No payment required.'
                : invoice.status === 'CANCELLED'
                ? 'This invoice is cancelled and cannot receive payments.'
                : invoice.status === 'DRAFT'
                ? 'This invoice is in DRAFT status. Approve and issue it before accepting payment.'
                : 'This invoice has zero remaining outstanding balance.'}
            </span>
          </div>
        )}

        {/* Payment Amount Selection (Only if payable and in pre-success state) */}
        {payable && step !== 'SUCCESS' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-white/70">
              Payment Amount
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setPayFullBalance(true)
                  setCustomAmount(String(remainingOutstanding))
                  setErrorMessage(null)
                }}
                className={`p-3 rounded-xl text-left border cursor-pointer transition-all ${
                  payFullBalance
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-white/[0.02] border-white/5 text-white/60 hover:border-white/10'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="text-[11px] text-white/50">Full Outstanding</div>
                <div className="font-mono font-bold text-sm text-indigo-300 mt-0.5">
                  {fmt(remainingOutstanding)}
                </div>
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setPayFullBalance(false)
                  setErrorMessage(null)
                }}
                className={`p-3 rounded-xl text-left border cursor-pointer transition-all ${
                  !payFullBalance
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-white/[0.02] border-white/5 text-white/60 hover:border-white/10'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="text-[11px] text-white/50">Partial Payment</div>
                <div className="font-mono font-bold text-sm text-white/80 mt-0.5">
                  Custom Amount
                </div>
              </button>
            </div>

            {!payFullBalance && (
              <div className="mt-2">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-white/50 text-xs font-mono">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max={remainingOutstanding}
                    step="any"
                    value={customAmount}
                    disabled={isProcessing}
                    onChange={(e) => {
                      setCustomAmount(e.target.value)
                      setErrorMessage(null)
                    }}
                    placeholder={`Enter amount up to ${remainingOutstanding}`}
                    className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-lg bg-black/40 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                </div>
                <p className="text-[11px] text-white/40 mt-1">
                  Specify amount to settle (max {fmt(remainingOutstanding)})
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 rounded-lg text-xs bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center gap-2"
          >
            <span>⚠️</span>
            <span className="break-all">{errorMessage}</span>
          </div>
        )}

        {/* Pending Authorized State */}
        {step === 'PENDING' && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800 text-xs text-amber-200 space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-amber-400">
              <span>⏳</span> Payment Authorized (Pending Capture)
            </div>
            <p className="text-white/80">
              {pendingMessage ||
                'The payment was authorized by the gateway but capture is pending. Invoice outstanding remains unchanged until capture is finalized.'}
            </p>
          </div>
        )}

        {/* Success Confirmed State */}
        {step === 'SUCCESS' && verifiedResult && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-200 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <span>✅</span> Payment Verified & Reconciled!
            </div>
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between text-white/70">
                <span>Amount Paid:</span>
                <span className="font-bold text-emerald-300">
                  {fmt(Number(verifiedResult.paidAmount || resolvedAmount))}
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Remaining Due:</span>
                <span className="font-bold text-white">
                  {fmt(Number(verifiedResult.remainingOutstanding || 0))}
                </span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Updated Status:</span>
                <span className="font-semibold text-emerald-400">
                  {verifiedResult.invoiceStatus}
                </span>
              </div>
              {verifiedResult.providerPaymentId && (
                <div className="flex justify-between text-white/50 text-[11px]">
                  <span>Razorpay Payment ID:</span>
                  <span>{verifiedResult.providerPaymentId}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          {step === 'SUCCESS' ? (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 cursor-pointer transition-colors shadow-lg shadow-emerald-600/30"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Close
              </button>

              {payable && (
                <button
                  type="button"
                  onClick={handleStartCheckout}
                  disabled={isProcessing || resolvedAmount <= 0}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-2"
                >
                  {isProcessing && (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  <span>
                    {step === 'CREATING_ORDER'
                      ? 'Creating Order…'
                      : step === 'LOADING_SDK'
                      ? 'Loading Checkout…'
                      : step === 'CHECKOUT_OPEN'
                      ? 'Checkout Active…'
                      : step === 'VERIFYING'
                      ? 'Verifying Signature…'
                      : `Pay ${fmt(resolvedAmount)} Now`}
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

