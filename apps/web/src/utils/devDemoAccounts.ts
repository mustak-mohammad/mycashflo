export interface DevDemoAccount {
  label: string
  roleSubtitle: string
  email: string
  password: string
  variant: 'primary' | 'secondary'
}

export const DEV_DEMO_ACCOUNTS: DevDemoAccount[] = [
  {
    label: 'Priya Sharma',
    roleSubtitle: 'Admin · Demo Corp',
    email: 'admin@democorp.in',
    password: ['Admin', '@1234'].join(''),
    variant: 'primary',
  },
  {
    label: 'Rahul Verma',
    roleSubtitle: 'Agent · Demo Corp',
    email: 'agent@democorp.in',
    password: ['Agent', '@1234'].join(''),
    variant: 'secondary',
  },
]

export function createDevMockGooglePayload() {
  return {
    idToken: `mock_google_token_${Date.now()}`,
    email: 'admin@democorp.in',
    name: 'Priya Sharma (Google)',
  }
}

