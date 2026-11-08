import { Hono } from 'hono'
import { CreateChatRequestSchema, ListChatsQuerySchema } from '@opencode-manager/shared/schemas'
import { ChatNotFoundError, ChatSessionMismatchError, type ChatService } from '../services/chats'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { handleOpenCodeError, parseJsonBody } from '../utils/route-helpers'

export function createChatRoutes(chatService: ChatService) {
  const app = new Hono()

  app.get('/', async (c) => {
    const parsedQuery = ListChatsQuerySchema.safeParse(c.req.query())
    if (!parsedQuery.success) {
      return c.json({ error: 'Invalid query', details: parsedQuery.error.issues }, 400)
    }

    try {
      return c.json(await chatService.list(parsedQuery.data))
    } catch (error) {
      logger.error('Failed to list chats', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.get('/:chatId', async (c) => {
    try {
      const chat = await chatService.resolve(c.req.param('chatId'))
      return chat ? c.json(chat) : c.json({ error: 'Chat not found' }, 404)
    } catch (error) {
      logger.error('Failed to read chat', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/', async (c) => {
    const body = await parseJsonBody(c, CreateChatRequestSchema, { allowEmpty: true })
    if (!body.ok) {
      return body.response
    }

    try {
      return c.json(await chatService.create(body.data), 201)
    } catch (error) {
      return handleOpenCodeError(c, error, 'Chat request failed')
    }
  })

  app.delete('/:chatId/sessions/:sessionId', async (c) => {
    try {
      return c.json(await chatService.deleteSession(c.req.param('chatId'), c.req.param('sessionId')))
    } catch (error) {
      if (error instanceof ChatNotFoundError) {
        return c.json({ error: error.message }, 404)
      }
      if (error instanceof ChatSessionMismatchError) {
        return c.json({ error: error.message }, 400)
      }
      return handleOpenCodeError(c, error, 'Chat session delete failed')
    }
  })

  return app
}
