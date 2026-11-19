import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import {
  ChatSchema,
  CreateChatResponseSchema,
  DeleteChatSessionResponseSchema,
  ListChatsResponseSchema,
  type Chat,
  type CreateChatRequest,
  type CreateChatResponse,
  type DeleteChatSessionResponse,
  type ListChatsResponse,
} from '@opencode-manager/shared/schemas'

export async function listChats(input: {
  limit: number
  cursor?: string
}): Promise<ListChatsResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/chats`, ListChatsResponseSchema, {
    params: { limit: input.limit, cursor: input.cursor },
  })
}

export async function getChat(chatId: string): Promise<Chat> {
  return fetchWrapper(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`, ChatSchema)
}

export async function createChat(input: CreateChatRequest): Promise<CreateChatResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/chats`, CreateChatResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteChatSession(
  chatId: string,
  sessionId: string,
): Promise<DeleteChatSessionResponse> {
  return fetchWrapper(
    `${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/sessions/${encodeURIComponent(sessionId)}`,
    DeleteChatSessionResponseSchema,
    { method: 'DELETE' },
  )
}
