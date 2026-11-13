import { useEffect, useId, useRef, type ReactNode } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'primary'
  loading?: boolean
  errorMessage?: string | null
  onCancel: () => void
  onConfirm: () => void
}

const CONFIRM_BTN_STYLE: Record<'danger' | 'warning' | 'primary', string> = {
  danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  warning: 'bg-amber-600 hover:bg-amber-500 text-white',
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    cancelBtnRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, loading, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onCancel()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-xl shrink-0">
            {variant === 'danger' ? '⚠️' : variant === 'warning' ? '⚡' : 'ℹ️'}
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-white">
              {title}
            </h3>
            <div id={descId} className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              {description}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="p-2.5 rounded-lg text-xs bg-rose-950/40 border border-rose-800 text-rose-300"
          >
            ⚠️ {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (!loading) onConfirm()
            }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 transition-colors ${CONFIRM_BTN_STYLE[variant]}`}
          >
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

