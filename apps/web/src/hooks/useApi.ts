import { useState, useEffect, useCallback, useRef } from 'react'
import { extractSafeErrorMessage } from '../utils/safeError'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Generic data-fetching hook.
 * Re-runs whenever the `fetcher` reference changes (use stable refs or deps).
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
        setError(extractSafeErrorMessage(err, 'An unexpected error occurred'))
      }
    } finally {
      if (id === counterRef.current) {
        setLoading(false)
      }
    }
  }, [fetcher])

  useEffect(() => {
    void run()
  }, [run])

  return { data, loading, error, refetch: run }
}
