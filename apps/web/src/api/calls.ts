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
      .get<{
        status: 'AVAILABLE' | 'PROCESSING' | 'FAILED' | 'NONE'
        url?: string
        streamUrl?: string
        downloadUrl?: string
      }>(`/calls/${id}/recording`)
      .then((r) => r.data),

  uploadRecording: async (id: string, audioBlob: Blob) => {
    const formData = new FormData()
    const mimeType = audioBlob.type || 'audio/webm'
    const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    formData.append('file', audioBlob, `call-${id}.${ext}`)
    formData.append('mimeType', mimeType)

    return client
      .post(`/calls/${id}/recording/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  downloadRecording: async (id: string, label?: string) => {
    let data
    try {
      data = await callsApi.getRecording(id)
    } catch (err: any) {
      if (err?.response?.status === 404) {
        throw new Error('No recording is available for this call.')
      }
      throw err
    }

    if (data.status !== 'AVAILABLE' || (!data.url && !data.downloadUrl)) {
      throw new Error(
        data.status === 'PROCESSING'
          ? 'Recording is still processing. Please try again shortly.'
          : data.status === 'FAILED'
            ? 'The recording failed to generate for this call.'
            : 'No recording is available for this call.',
      )
    }
    const token = localStorage.getItem('mcf_access_token') || localStorage.getItem('token') || ''
    // If the endpoint starts with /api/, strip it so client baseURL (/api) does not duplicate to /api/api/
    let rawEndpoint = data.downloadUrl || `/calls/${id}/recording/download`
    const downloadEndpoint = rawEndpoint.startsWith('/api/') ? rawEndpoint.replace(/^\/api/, '') : rawEndpoint

    const ext = 'webm'
    const filename = `call-recording-${label ?? id}.${ext}`

    try {
      const response = await client.get(downloadEndpoint, { responseType: 'blob' })
      const contentType = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : 'audio/webm'
      const blob = new Blob([response.data], { type: contentType })
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
      // Fallback: direct window open with query token auth
      const apiPrefix = '/api'
      const endpointPath = downloadEndpoint.startsWith('/') ? downloadEndpoint : `/${downloadEndpoint}`
      const fullUrl = token
        ? `${apiPrefix}${endpointPath}?token=${encodeURIComponent(token)}`
        : `${apiPrefix}${endpointPath}`
      window.open(fullUrl, '_blank')
    }
  },

  create: (data: {
    customerId?: string
    collectionCaseId?: string
    duration?: number
    outcome?: string
    transcript?: string
    summary?: string
    stage?: string
    metadata?: Record<string, any>
    livekitRoom?: string
    recordingEgressId?: string
  }) => client.post<CallSession>('/calls', data).then((r) => r.data),

  updateOutcome: (id: string, outcome: string, notes?: string) =>
    client.patch<CallSession>(`/calls/${id}/outcome`, { outcome, notes }).then((r) => r.data),

  initiateOutbound: (data: {
    customerId: string
    phone?: string
    collectionCaseId?: string
    reason?: string
  }) => client.post<any>('/calls/outbound/initiate', data).then((r) => r.data),
}

