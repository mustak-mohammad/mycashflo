/**
 * Utility functions for user identity and display name formatting.
 */

/**
 * Derives a friendly display name for a user.
 * If the saved profile name is present and non-blank, it is returned.
 * If missing or blank, a friendly fallback is derived from the email address:
 * - Uses the part before '@'
 * - Replaces dots, underscores, and hyphens with spaces
 * - Capitalizes words where reasonable (e.g. 'mustak.mohammad@example.com' -> 'Mustak Mohammad')
 */
export function getDisplayName(user?: { name?: string | null; email?: string | null } | null): string {
  if (!user) return ''

  const trimmedName = user.name?.trim()
  if (trimmedName) {
    return trimmedName
  }

  const email = user.email?.trim()
  if (!email) {
    return 'User'
  }

  const atIndex = email.indexOf('@')
  const localPart = atIndex !== -1 ? email.slice(0, atIndex) : email
  if (!localPart) {
    return 'User'
  }

  const words = localPart
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) {
    return 'User'
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

