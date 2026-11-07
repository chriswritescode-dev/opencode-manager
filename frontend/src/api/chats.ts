import { fetchWrapper } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import type {
  Chat,
  CreateChatRequest,
  CreateChatResponse,
  DeleteChatSessionResponse,
  ListChatsResponse,
} from '@opencode-manager/shared/schemas'

export async function listChats(input: {
  limit: number
  cursor?: string
}): Promise<ListChatsResponse> {
  return fetchWrapper<ListChatsResponse>(`${API_BASE_URL}/api/chats`, {
    params: { limit: input.limit, cursor: input.cursor },
  })
}

export async function getChat(chatId: string): Promise<Chat> {
  return fetchWrapper<Chat>(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`)
}

export async function createChat(input: CreateChatRequest): Promise<CreateChatResponse> {
  return fetchWrapper<CreateChatResponse>(`${API_BASE_URL}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteChatSession(
  chatId: string,
  sessionId: string,
): Promise<DeleteChatSessionResponse> {
  return fetchWrapper<DeleteChatSessionResponse>(
    `${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  )
}
