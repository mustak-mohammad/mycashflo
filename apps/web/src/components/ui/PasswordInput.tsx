import { useState, forwardRef, type InputHTMLAttributes } from 'react'

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  error?: boolean
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className = '', style, error, disabled, ...rest }, ref) => {
    const [showPassword, setShowPassword] = useState(false)

    return (
      <div className="relative w-full">
        <input
          ref={ref}
          type={showPassword ? 'text' : 'password'}
          disabled={disabled}
          className={`w-full pr-11 text-sm outline-none transition-all disabled:opacity-50 ${className}`}
          style={{
            ...style,
            ...(error ? { borderColor: 'var(--danger, #ef4444)' } : {}),
            paddingRight: '2.75rem', // Ensure typed text never overlaps with the toggle icon
          }}
          {...rest}
        />
        <button
          type="button"
          tabIndex={0}
          disabled={disabled}
          onClick={() => setShowPassword((prev) => !prev)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          title={showPassword ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-white transition-colors rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showPassword ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    )
  },
)

PasswordInput.displayName = 'PasswordInput'
