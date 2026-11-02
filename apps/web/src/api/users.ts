import apiClient from './client'

export interface UserItem {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'MANAGER' | 'AGENT'
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  email: string
  password: string
  name: string
  role: 'ADMIN' | 'MANAGER' | 'AGENT'
}

export interface UpdateUserInput {
  name?: string
  role?: 'ADMIN' | 'MANAGER' | 'AGENT'
  isActive?: boolean
}

export const usersApi = {
  list: async (): Promise<UserItem[]> => {
    const res = await apiClient.get<UserItem[]>('/users')
    return res.data
  },
  create: async (data: CreateUserInput): Promise<UserItem> => {
    const res = await apiClient.post<UserItem>('/users', data)
    return res.data
  },
  update: async (id: string, data: UpdateUserInput): Promise<UserItem> => {
    const res = await apiClient.patch<UserItem>(`/users/${id}`, data)
    return res.data
  },
}
