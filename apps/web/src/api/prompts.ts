import apiClient from './client'
import type {
  VoicePrompt,
  CreateVoicePromptRequest,
  UpdateVoicePromptRequest,
} from '../types'

export interface PromptQueryParams {
  search?: string
  category?: string
  isActive?: boolean
  page?: number
  limit?: number
}

export const promptsApi = {
  list: (params?: PromptQueryParams) =>
    apiClient.get<VoicePrompt[]>('/prompts', { params }).then((r) => r.data),

  getById: (id: string) =>
    apiClient.get<VoicePrompt>(`/prompts/${id}`).then((r) => r.data),

  create: (dto: CreateVoicePromptRequest) =>
    apiClient.post<VoicePrompt>('/prompts', dto).then((r) => r.data),

  update: (id: string, dto: UpdateVoicePromptRequest) =>
    apiClient.patch<VoicePrompt>(`/prompts/${id}`, dto).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/prompts/${id}`).then((r) => r.data),

  preview: (template: string, sampleData?: Record<string, string>) =>
    apiClient
      .post<{ preview: string; missingVariables: string[] }>('/prompts/preview', {
        template,
        sampleData,
      })
      .then((r) => r.data),

  downloadTxt: async (id: string, name: string) => {
    const res = await apiClient.get(`/prompts/${id}/export`, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.txt`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },

  downloadZip: async () => {
    const res = await apiClient.get('/prompts/export/zip', {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `mycashflo-voice-prompts-${new Date().toISOString().slice(0, 10)}.zip`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
}
