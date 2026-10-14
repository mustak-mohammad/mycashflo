import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl mb-4 bg-rose-950/40 border border-rose-800 text-rose-400">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            {this.state.error?.message || 'An unexpected rendering error occurred while loading this view.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
            >
              Retry View
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard' }}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 cursor-pointer"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
