import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { sanitizeUiErrorMessage } from '../utils/safeError'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastInput {
  type: ToastType
  title?: string
  message: string
  durationMs?: number
  dedupeKey?: string
}

export interface ToastItem extends Required<Pick<ToastInput, 'type' | 'message'>> {
  id: string
  title?: string
  dedupeKey: string
  createdAt: number
}

interface ToastContextValue {
  showToast: (input: ToastInput) => string
  dismissToast: (id: string) => void
  clearToasts: () => void
  success: (message: string, title?: string) => string
  error: (message: string, title?: string) => string
  warning: (message: string, title?: string) => string
  info: (message: string, title?: string) => string
}

const DEFAULT_DURATION_MS = 5000
const MAX_VISIBLE_TOASTS = 5

const NOOP_TOAST_CONTEXT: ToastContextValue = {
  showToast: () => '',
  dismissToast: () => {},
  clearToasts: () => {},
  success: () => '',
  error: () => '',
  warning: () => '',
  info: () => '',
}

const ToastContext = createContext<ToastContextValue>(NOOP_TOAST_CONTEXT)

const TOAST_STYLES: Record<
  ToastType,
  { container: string; badge: string; icon: string; fallbackTitle: string }
> = {
  success: {
    container: 'bg-emerald-950/95 border-emerald-700/80 text-emerald-100',
    badge: 'text-emerald-300',
    icon: '✓',
    fallbackTitle: 'Success',
  },
  error: {
    container: 'bg-rose-950/95 border-rose-700/80 text-rose-100',
    badge: 'text-rose-300',
    icon: '⚠️',
    fallbackTitle: 'Error',
  },
  warning: {
    container: 'bg-amber-950/95 border-amber-700/80 text-amber-100',
    badge: 'text-amber-300',
    icon: '⚡',
    fallbackTitle: 'Warning',
  },
  info: {
    container: 'bg-slate-900/95 border-sky-700/80 text-slate-100',
    badge: 'text-sky-300',
    icon: 'ℹ️',
    fallbackTitle: 'Notice',
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const seqRef = useRef(0)

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    setToasts([])
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const scheduleAutoDismiss = useCallback(
    (id: string, durationMs: number) => {
      const existing = timersRef.current.get(id)
      if (existing) clearTimeout(existing)
      if (durationMs <= 0) return
      const timer = setTimeout(() => {
        timersRef.current.delete(id)
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, durationMs)
      timersRef.current.set(id, timer)
    },
    [],
  )

  const showToast = useCallback(
    ({ type, title, message, durationMs = DEFAULT_DURATION_MS, dedupeKey }: ToastInput) => {
      const safeMessage = sanitizeUiErrorMessage(
        message,
        type === 'error' ? 'An unexpected error occurred.' : 'Notification updated.',
      )
      const normalizedKey = dedupeKey || `${type}:${safeMessage}`

      let activeId = ''
      setToasts((prev) => {
        const duplicate = prev.find((t) => t.dedupeKey === normalizedKey)
        if (duplicate) {
          activeId = duplicate.id
          scheduleAutoDismiss(duplicate.id, durationMs)
          return prev
        }
        seqRef.current += 1
        activeId = `toast_${seqRef.current}`
        const nextItem: ToastItem = {
          id: activeId,
          type,
          title,
          message: safeMessage,
          dedupeKey: normalizedKey,
          createdAt: seqRef.current,
        }
        const trimmed = prev.length >= MAX_VISIBLE_TOASTS ? prev.slice(1) : prev
        scheduleAutoDismiss(activeId, durationMs)
        return [...trimmed, nextItem]
      })

      return activeId
    },
    [scheduleAutoDismiss],
  )

  const success = useCallback(
    (message: string, title?: string) => showToast({ type: 'success', message, title }),
    [showToast],
  )
  const error = useCallback(
    (message: string, title?: string) => showToast({ type: 'error', message, title }),
    [showToast],
  )
  const warning = useCallback(
    (message: string, title?: string) => showToast({ type: 'warning', message, title }),
    [showToast],
  )
  const info = useCallback(
    (message: string, title?: string) => showToast({ type: 'info', message, title }),
    [showToast],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      dismissToast,
      clearToasts,
      success,
      error,
      warning,
      info,
    }),
    [showToast, dismissToast, clearToasts, success, error, warning, info],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
      >
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type]
          const isAssertive = toast.type === 'error' || toast.type === 'warning'
          return (
            <div
              key={toast.id}
              role={isAssertive ? 'alert' : 'status'}
              aria-live={isAssertive ? 'assertive' : 'polite'}
              data-testid={`toast-${toast.type}`}
              className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-sm flex items-start gap-3 text-xs ${style.container}`}
            >
              <span aria-hidden="true" className={`text-sm shrink-0 mt-0.5 ${style.badge}`}>
                {style.icon}
              </span>
              <div className="flex-1 min-w-0">
                {toast.title && (
                  <div className="font-semibold text-[13px] mb-0.5 truncate">{toast.title}</div>
                )}
                <div className="leading-relaxed break-words">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="shrink-0 text-white/60 hover:text-white bg-transparent border-none p-0.5 cursor-pointer text-xs leading-none"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
