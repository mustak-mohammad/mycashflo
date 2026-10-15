import client from './client'
import type { CallSession, Paginated } from '../types'

export interface CallListParams {
  page?: number
  limit?: number
  outcome?: string
  customerId?: string
}

function triggerCsvDownload(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export const callsApi = {
  list: (params?: CallListParams) =>
    client.get<Paginated<CallSession>>('/calls', { params }).then((r) => r.data),

  get: (id: string) =>
    client.get<CallSession>(`/calls/${id}`).then((r) => r.data),

  downloadCsv: async (params?: { outcome?: string; customerId?: string }) => {
    const response = await client.get('/calls/export', { params, responseType: 'blob' })
    triggerCsvDownload(response.data, `call-history-${new Date().toISOString().slice(0, 10)}.csv`)
  },

  getRecording: (id: string) =>
    client
      .get<{ status: 'AVAILABLE' | 'PROCESSING' | 'FAILED'; url?: string }>(`/calls/${id}/recording`)
      .then((r) => r.data),

  downloadRecording: async (id: string, label?: string) => {
    const data = await callsApi.getRecording(id)
    if (data.status !== 'AVAILABLE' || !data.url) {
      throw new Error(
        data.status === 'PROCESSING'
          ? 'Recording is still processing. Please try again shortly.'
          : data.status === 'FAILED'
            ? 'The recording failed to generate for this call.'
            : 'No recording is available for this call.',
      )
    }
    const ext = data.url.split('?')[0].split('.').pop() || 'ogg'
    const filename = `call-recording-${label ?? id}.${ext}`
    try {
      const audio = await fetch(data.url)
      if (!audio.ok) throw new Error('download failed')
      const blob = await audio.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      setTimeout(() => {
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
      }, 100)
    } catch {
      // Cross-origin storage may block blob downloads; fall back to the direct URL.
      window.open(data.url, '_blank')
    }
  },

  create: (data: {
    customerId?: string
    collectionCaseId?: string
    duration?: number
    outcome?: string
    transcript?: string
    summary?: string
    livekitRoom?: string
    recordingEgressId?: string
  }) => client.post<CallSession>('/calls', data).then((r) => r.data),
}
