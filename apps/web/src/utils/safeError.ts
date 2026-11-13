const SENSITIVE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+|(?:password|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+)/gi

/**
 * Redacts credentials, JWTs, cookies, and stack traces from strings before
 * rendering UI error notices or writing sanitized console diagnostics.
 */
export function sanitizeUiErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return fallback
    if (
      trimmed.includes('\n    at ') ||
      trimmed.includes('\r\n    at ') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html')
    ) {
      return fallback
    }
    const sanitized = trimmed
      .replace(SENSITIVE_PATTERN, '[REDACTED]')
      .replace(/\s+/g, ' ')
      .trim()
    if (!sanitized) return fallback
    return sanitized.length > 260 ? `${sanitized.slice(0, 257)}...` : sanitized
  }

  if (Array.isArray(raw) && raw.length > 0) {
    const joined = raw
      .map((item) => sanitizeUiErrorMessage(item, ''))
      .filter(Boolean)
      .join(' • ')
    return joined || fallback
  }

  return fallback
}

/**
 * Synchronously extracts a safe, user-facing error message from an Axios/fetch error
 * without exposing raw request configs, headers, stack traces, or tokens.
 */
export function extractSafeErrorMessage(err: unknown, fallback: string): string {
  const axiosLike = err as {
    response?: { status?: number; data?: { message?: unknown; error?: unknown } }
    message?: string
  }

  const responseMessage = axiosLike?.response?.data?.message
  if (responseMessage) {
    return sanitizeUiErrorMessage(responseMessage, fallback)
  }

  const status = axiosLike?.response?.status
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested resource could not be found.'
  if (status && status >= 500) return `${fallback} (Server returned HTTP ${status}).`

  if (typeof axiosLike?.message === 'string' && axiosLike.message.trim()) {
    return sanitizeUiErrorMessage(axiosLike.message, fallback)
  }

  return fallback
}

/**
 * Extracts a safe error message from Blob responses as well as JSON responses
 * (used by CSV/PDF download endpoints where responseType is 'blob').
 */
export async function extractSafeApiError(err: unknown, fallback: string): Promise<string> {
  const axiosLike = err as {
    response?: { status?: number; data?: unknown }
  }
  const data = axiosLike?.response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text) as { message?: unknown }
      if (parsed?.message) {
        return sanitizeUiErrorMessage(parsed.message, fallback)
      }
    } catch {
      // Fall through to status/generic message
    }
  }
  return extractSafeErrorMessage(err, fallback)
}

/**
 * Logs only non-sensitive diagnostic metadata (error name & redacted message,
 * never full Axios request configs, component stacks, tokens, or payloads).
 */
export function logSanitizedDiagnostic(context: string, err: unknown): void {
  const errObj = err as { name?: string; message?: string; response?: { status?: number } }
  console.warn(context, {
    name: typeof errObj?.name === 'string' ? errObj.name : 'Error',
    status: errObj?.response?.status,
    message: sanitizeUiErrorMessage(errObj?.message, 'Unexpected client error'),
  })
}

