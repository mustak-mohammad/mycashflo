import client from './client'
import type { ChotuChatRequest, ChotuChatResponse } from '../../../../packages/shared-types'

export const chotuApi = {
  chat: async (req: ChotuChatRequest): Promise<ChotuChatResponse> => {
    const res = await client.post<ChotuChatResponse>('/chotu/chat', req)
    return res.data
  },
}
