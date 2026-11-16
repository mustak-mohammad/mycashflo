/**
 * Bounded Retry Helper for PostgreSQL Deadlocks (40P01) and Serialization Failures (40001).
 *
 * Implements exponential backoff with random jitter to allow competing concurrent
 * transactions to yield and serialize cleanly.
 */
export async function executeWithDeadlockRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 50,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      attempt++;
      const isDeadlockOrSerialization =
        err?.code === '40P01' || // PostgreSQL deadlock_detected
        err?.code === '40001' || // PostgreSQL serialization_failure
        err?.message?.includes('deadlock detected') ||
        err?.message?.includes('could not serialize access');

      if (!isDeadlockOrSerialization || attempt >= maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 25;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}
