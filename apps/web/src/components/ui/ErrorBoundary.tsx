import { Component, Fragment } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { logSanitizedDiagnostic } from '../../utils/safeError'

export type ErrorBoundaryRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT' | null | undefined

interface Props {
  children: ReactNode
  userRole?: ErrorBoundaryRole
  isAuthenticated?: boolean
  currentPath?: string
  onNavigate?: (path: string) => void
  onRetry?: () => void
}

interface State {
  hasError: boolean
  lastResetPath?: string
  retryCount: number
}

export function resolveSafeFallbackDestination(options: {
  isAuthenticated?: boolean
  userRole?: ErrorBoundaryRole
  currentPath: string
}): { path: string; label: string } {
  const { isAuthenticated, userRole, currentPath } = options

  if (isAuthenticated === false) {
    return { path: '/login', label: 'Return to Sign In' }
  }

  if (userRole === 'SUPER_ADMIN' || (userRole == null && currentPath.startsWith('/platform'))) {
    return { path: '/platform/overview', label: 'Return to Platform Console' }
  }

  // Avoid looping back onto /dashboard if /dashboard itself failed to render
  if (currentPath === '/dashboard') {
    return { path: '/profile', label: 'Go to My Profile' }
  }

  return { path: '/dashboard', label: 'Return to Dashboard' }
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      lastResetPath: props.currentPath,
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.currentPath !== undefined && props.currentPath !== state.lastResetPath) {
      return {
        hasError: false,
        lastResetPath: props.currentPath,
      }
    }
    return null
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    const path =
      this.props.currentPath ??
      (typeof window !== 'undefined' ? window.location.pathname : '')
    logSanitizedDiagnostic(`ErrorBoundary caught view error on ${path || '/'}`, error)
  }

  private handleRetry = () => {
    this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }))
    this.props.onRetry?.()
  }

  private handleSafeNavigate = (path: string) => {
    this.setState({ hasError: false })
    if (this.props.onNavigate) {
      this.props.onNavigate(path)
      return
    }
    if (typeof window !== 'undefined') {
      window.location.assign(path)
    }
  }

  render() {
    if (this.state.hasError) {
      const currentPath =
        this.props.currentPath ??
        (typeof window !== 'undefined' ? window.location.pathname : '/')
      const fallback = resolveSafeFallbackDestination({
        isAuthenticated: this.props.isAuthenticated,
        userRole: this.props.userRole,
        currentPath,
      })

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center min-h-[400px] p-6 sm:p-8 text-center"
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl mb-4 bg-rose-950/40 border border-rose-800 text-rose-400">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            An unexpected display error occurred while loading this view. Your data has not been
            modified. Please try again or navigate to a safe page.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
            >
              Retry View
            </button>
            <button
              type="button"
              onClick={() => this.handleSafeNavigate(fallback.path)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 cursor-pointer"
            >
              {fallback.label}
            </button>
          </div>
        </div>
      )
    }

    return <Fragment key={this.state.retryCount}>{this.props.children}</Fragment>
  }
}
