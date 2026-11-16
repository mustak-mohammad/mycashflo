import apiClient from './client'
import type { LoginResponse, User } from '../types'

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>('/auth/login', { email, password }).then((r) => r.data),
  getProfile: () => apiClient.get<User>('/auth/me').then((r) => r.data),
  updateProfile: (name: string) =>
    apiClient.patch<User>('/auth/profile', { name }).then((r) => r.data),
  changePassword: (dto: { currentPassword: string; newPassword: string }) =>
    apiClient.post<{ message: string }>('/auth/change-password', dto).then((r) => r.data),
}
