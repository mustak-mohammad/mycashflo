import { useState, useEffect, useCallback, useRef } from 'react'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Generic data-fetching hook.
 * Re-runs whenever the `fetcher` reference changes (use stable refs or deps).
 *
 * @example
 * const { data, loading, error } = useApi(() => customersApi.list({ page: 1 }))
 */
export function useApi<T>(fetcher: () => Promise<T>): UseApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const counterRef = useRef(0)

  const run = useCallback(async () => {
    const id = ++counterRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      if (id === counterRef.current) {
        setData(result)
      }
    } catch (err: unknown) {
      if (id === counterRef.current) {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (err instanceof Error ? err.message : 'An unexpected error occurred')
        setError(msg)
      }
    } finally {
      if (id === counterRef.current) {
        setLoading(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher])

  useEffect(() => { run() }, [run])

  return { data, loading, error, refetch: run }
}
