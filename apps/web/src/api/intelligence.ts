import client from './client'
import type { ActionProposal, AiToolDefinition, ExecuteToolRequest, ExecuteToolResponse } from '../../../../packages/shared-types'

export async function getAiTools(): Promise<AiToolDefinition[]> {
  const res = await client.get<AiToolDefinition[]>('/intelligence/tools')
  return res.data
}

export async function executeAiTool(dto: ExecuteToolRequest): Promise<ExecuteToolResponse> {
  const res = await client.post<ExecuteToolResponse>('/intelligence/tools/execute', dto)
  return res.data
}

export async function getPendingActionProposals(): Promise<ActionProposal[]> {
  const res = await client.get<ActionProposal[]>('/intelligence/actions/pending')
  return res.data
}

export async function getAllActionProposals(): Promise<ActionProposal[]> {
  const res = await client.get<ActionProposal[]>('/intelligence/actions')
  return res.data
}

export async function approveActionProposal(id: string): Promise<{ proposal: ActionProposal; execution: any }> {
  const res = await client.post<{ proposal: ActionProposal; execution: any }>(`/intelligence/actions/${id}/approve`)
  return res.data
}

export async function rejectActionProposal(id: string, reason?: string): Promise<ActionProposal> {
  const res = await client.post<ActionProposal>(`/intelligence/actions/${id}/reject`, { reason })
  return res.data
}

export async function sendIntelligenceChat(
  message: string,
  customerId?: string,
): Promise<{
  reply: string
  toolCalled: string | null
  actionProposal?: any
  requiresConfirmation?: boolean
  data: any
}> {
  const res = await client.post<{
    reply: string
    toolCalled: string | null
    actionProposal?: any
    requiresConfirmation?: boolean
    data: any
  }>('/intelligence/chat', { message, customerId })
  return res.data
}
