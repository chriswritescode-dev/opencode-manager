import { z } from 'zod'

export const CHAT_ID_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{6}$/

export const ChatIdSchema = z.string().regex(CHAT_ID_PATTERN, 'Invalid chat id')

export const ChatSchema = z.object({
  id: ChatIdSchema,
  directory: z.string(),
  filesPath: z.string(),
  createdAt: z.number(),
})

export const ListChatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: ChatIdSchema.optional(),
})

export const ListChatsResponseSchema = z.object({
  chats: z.array(ChatSchema),
  nextCursor: ChatIdSchema.optional(),
})

export const CreateChatRequestSchema = z.object({
  title: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
})

export const CreateChatResponseSchema = z.object({
  chat: ChatSchema,
  sessionId: z.string(),
})

export const DeleteChatSessionResponseSchema = z.object({
  deleted: z.literal(true),
  folderRemoved: z.boolean(),
})

export type Chat = z.infer<typeof ChatSchema>
export type ListChatsQuery = z.infer<typeof ListChatsQuerySchema>
export type ListChatsResponse = z.infer<typeof ListChatsResponseSchema>
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>
export type CreateChatResponse = z.infer<typeof CreateChatResponseSchema>
export type DeleteChatSessionResponse = z.infer<typeof DeleteChatSessionResponseSchema>

/** Reads the UTC creation time encoded in a chat id. */
export function parseChatIdCreatedAt(id: string): number {
  const match = CHAT_ID_PATTERN.exec(id)
  if (!match) return NaN
  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
}
