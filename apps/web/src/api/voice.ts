import client from './client'
import type {
  VoiceSessionToken,
  ConversationTurnRequest,
  ConversationTurnResponse,
  CallType,
  StructuredCallSummary,
  DocumentDeliveryRequest,
  CreateDocumentDeliveryDto,
  Paginated,
} from '../types'

export interface InitialGreetingParams {
  callType?: CallType
  customerId?: string
  invoiceId?: string
  promptId?: string
}

export interface InitialGreetingResponse {
  greeting: string
  callType: CallType
  conversationalGoal: string
  customerName: string
  outstandingAmount: string
  invoiceNumber: string
  dueDate: string
  companyName: string
  promptId?: string
  promptName?: string
}

export const voiceApi = {
  getToken: (data?: { customerId?: string; collectionCaseId?: string }) =>
    client.post<VoiceSessionToken>('/voice/token', data ?? {}).then((r) => r.data),

  getInitialGreeting: (data: InitialGreetingParams) =>
    client.post<InitialGreetingResponse>('/voice/initial-greeting', data).then((r) => r.data),

  generateSummary: (data: any) =>
    client.post<StructuredCallSummary>('/voice/summary', data).then((r) => r.data),

  processTurn: (data: ConversationTurnRequest) =>
    client.post<ConversationTurnResponse>('/voice/conversation/turn', data).then((r) => r.data),

  startRecording: (data: { roomName: string; callSessionId?: string }) =>
    client.post<{ egressId: string; status: string }>('/voice/recording/start', data).then((r) => r.data),

  stopRecording: (data: { egressId: string; callSessionId?: string }) =>
    client.post<{ egressId: string; status: string }>('/voice/recording/stop', data).then((r) => r.data),

  synthesize: (text: string) =>
    client
      .get('/voice/synthesize', {
        params: { text },
        responseType: 'arraybuffer',
      })
      .then((r) => r.data as ArrayBuffer),

  requestDocumentDelivery: (data: CreateDocumentDeliveryDto) =>
    client.post<{ request: DocumentDeliveryRequest; isDuplicate: boolean; message?: string }>('/voice/document-requests', data).then((r) => r.data),

  getDocumentDeliveryRequests: (params?: { customerId?: string; invoiceId?: string; status?: string; page?: number; limit?: number }) =>
    client.get<Paginated<DocumentDeliveryRequest>>('/voice/document-requests', { params }).then((r) => r.data),

  getDocumentDeliveryRequest: (id: string) =>
    client.get<DocumentDeliveryRequest>(`/voice/document-requests/${id}`).then((r) => r.data),

  cancelDocumentDelivery: (id: string) =>
    client.post<DocumentDeliveryRequest>(`/voice/document-requests/${id}/cancel`).then((r) => r.data),

  downloadSignedInvoicePdf: async (invoiceId: string, token: string, invoiceNumber?: string) => {
    const response = await client.get(`/voice/document-requests/invoices/${invoiceId}/download`, {
      params: { token },
      responseType: 'blob',
    })
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `invoice-${(invoiceNumber ?? invoiceId).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    }, 100)
  },
}


