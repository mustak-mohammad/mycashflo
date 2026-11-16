import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import apiClient from '../api/client'
import { AuthProvider } from '../store/AuthContext'
import { ChangePasswordCard } from '../components/auth/ChangePasswordCard'
import { TeamUsersView } from '../components/team/TeamUsersView'
import { ACCESS_TOKEN_KEY } from '../utils/authStorage'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} as Record<string, string> } },
  },
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedPost = vi.mocked(apiClient.post)

describe('Frontend Password Policy Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('ChangePasswordCard', () => {
    it('shows real-time policy feedback and prevents submitting weak passwords', async () => {
      const user = userEvent.setup()
      render(<ChangePasswordCard />)

      await user.click(screen.getByRole('button', { name: /change password/i }))

      const currentInput = screen.getByPlaceholderText(/enter your existing account password/i)
      const newInput = screen.getByPlaceholderText(/minimum 8 characters/i)
      const confirmInput = screen.getByPlaceholderText(/re-type new password/i)
      const submitBtn = screen.getByRole('button', { name: /update password/i })

      await user.type(currentInput, 'OldPass@123')

      // Too short & missing complexity
      await user.type(newInput, 'weak')
      await user.type(confirmInput, 'weak')
      expect(screen.getByText(/password requirements:/i)).toBeInTheDocument()
      expect(submitBtn).toBeDisabled()

      // Meets min length (8+) but lacks uppercase and number/symbol
      await user.clear(newInput)
      await user.clear(confirmInput)
      await user.type(newInput, 'onlylowercase')
      await user.type(confirmInput, 'onlylowercase')
      expect(submitBtn).toBeDisabled()

      // Meets min length and mixed case, but lacks number/symbol
      await user.clear(newInput)
      await user.clear(confirmInput)
      await user.type(newInput, 'MixedCaseOnly')
      await user.type(confirmInput, 'MixedCaseOnly')
      expect(submitBtn).toBeDisabled()

      expect(mockedPost).not.toHaveBeenCalled()
    })

    it('allows strong compliant passwords to submit to /auth/change-password', async () => {
      const user = userEvent.setup()
      mockedPost.mockResolvedValueOnce({
        data: { message: 'Password changed successfully. All active sessions have been updated.' },
      })

      render(<ChangePasswordCard />)
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await user.type(screen.getByPlaceholderText(/enter your existing account password/i), 'OldPass@123')
      await user.type(screen.getByPlaceholderText(/minimum 8 characters/i), 'NewStrong@2026')
      await user.type(screen.getByPlaceholderText(/re-type new password/i), 'NewStrong@2026')

      const submitBtn = screen.getByRole('button', { name: /update password/i })
      expect(submitBtn).toBeEnabled()

      await user.click(submitBtn)

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith('/auth/change-password', {
          currentPassword: 'OldPass@123',
          newPassword: 'NewStrong@2026',
        })
        expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument()
      })
    })
  })

  describe('TeamUsersView user creation form', () => {
    it('shows policy feedback and blocks creating users with weak temporary passwords', async () => {
      const user = userEvent.setup()
      localStorage.setItem(ACCESS_TOKEN_KEY, 'admin-jwt')
      mockedGet.mockImplementation((url: string) => {
        if (url === '/auth/me') {
          return Promise.resolve({
            data: { id: 'a1', email: 'admin@acme.in', name: 'Admin', role: 'ADMIN', tenantId: 't1' },
          })
        }
        if (url === '/users') {
          return Promise.resolve({ data: [] })
        }
        return Promise.resolve({ data: [] })
      })

      render(
        <AuthProvider>
          <TeamUsersView />
        </AuthProvider>,
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ invite user/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /\+ invite user/i }))

      await user.type(screen.getByPlaceholderText(/ramesh kumar/i), 'Pooja Verma')
      await user.type(screen.getByPlaceholderText(/ramesh@company\.in/i), 'pooja@acme.in')
      const passwordInput = screen.getByLabelText(/temporary password/i)
      const createBtn = screen.getByRole('button', { name: /create user/i })

      await user.type(passwordInput, 'weakpass')
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
      expect(screen.getByText(/uppercase and lowercase letters/i)).toBeInTheDocument()
      expect(screen.getByText(/at least one number or special symbol/i)).toBeInTheDocument()
      expect(createBtn).toBeDisabled()
      expect(mockedPost).not.toHaveBeenCalled()

      // Replace with compliant password
      await user.clear(passwordInput)
      await user.type(passwordInput, 'AgentPass!2026')
      expect(createBtn).toBeEnabled()

      mockedPost.mockResolvedValueOnce({
        data: { id: 'u2', email: 'pooja@acme.in', name: 'Pooja Verma', role: 'AGENT', isActive: true },
      })

      await user.click(createBtn)

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith('/users', {
          name: 'Pooja Verma',
          email: 'pooja@acme.in',
          password: 'AgentPass!2026',
          role: 'AGENT',
        })
      })
    })
  })
})

