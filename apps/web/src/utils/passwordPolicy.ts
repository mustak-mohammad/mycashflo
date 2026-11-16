export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]).+$/

export interface PasswordPolicyEvaluation {
  hasMinLength: boolean
  hasLowercase: boolean
  hasUppercase: boolean
  hasMixedCase: boolean
  hasNumberOrSymbol: boolean
  isValid: boolean
  errorMessage: string | null
}

export function evaluatePasswordPolicy(password: string): PasswordPolicyEvaluation {
  const hasMinLength = password.length >= PASSWORD_MIN_LENGTH
  const hasLowercase = /[a-z]/.test(password)
  const hasUppercase = /[A-Z]/.test(password)
  const hasMixedCase = hasLowercase && hasUppercase
  const hasNumberOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)
  const isValid = hasMinLength && PASSWORD_COMPLEXITY_REGEX.test(password)

  let errorMessage: string | null = null
  if (!hasMinLength) {
    errorMessage = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
  } else if (!hasMixedCase || !hasNumberOrSymbol || !isValid) {
    errorMessage =
      'Password must contain at least one uppercase letter, one lowercase letter, and at least one number or special symbol.'
  }

  return {
    hasMinLength,
    hasLowercase,
    hasUppercase,
    hasMixedCase,
    hasNumberOrSymbol,
    isValid,
    errorMessage,
  }
}
