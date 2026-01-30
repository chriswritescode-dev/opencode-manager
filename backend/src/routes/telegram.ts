import { Hono } from 'hono'
import { z } from 'zod'
import { Database } from 'bun:sqlite'
import { telegramService } from '../services/telegram'
import { logger } from '../utils/logger'

const AddToAllowlistSchema = z.object({
  chatId: z.string().min(1),
})

const StartBotSchema = z.object({
  token: z.string().min(1),
})

export function createTelegramRoutes(db: Database) {
  const app = new Hono()

  telegramService.setDatabase(db)

  app.get('/status', async (c) => {
    const status = telegramService.getStatus()
    return c.json(status)
  })

  app.post('/start', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = StartBotSchema.safeParse(body)
      
      if (!parsed.success) {
        const token = process.env.TELEGRAM_BOT_TOKEN
        if (!token) {
          return c.json({ error: 'No token provided and TELEGRAM_BOT_TOKEN not set' }, 400)
        }
        await telegramService.start(token)
      } else {
        await telegramService.start(parsed.data.token)
      }
      
      return c.json({ success: true, status: telegramService.getStatus() })
    } catch (error) {
      logger.error('Failed to start Telegram bot:', error)
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to start bot' 
      }, 500)
    }
  })

  app.post('/stop', async (c) => {
    try {
      await telegramService.stop()
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to stop Telegram bot:', error)
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to stop bot' 
      }, 500)
    }
  })

  app.get('/sessions', async (c) => {
    const sessions = telegramService.getAllSessions()
    return c.json(sessions)
  })

  app.delete('/sessions/:chatId', async (c) => {
    const chatId = c.req.param('chatId')
    const deleted = telegramService.deleteSession(chatId)
    
    if (deleted) {
      return c.json({ success: true })
    }
    return c.json({ error: 'Session not found' }, 404)
  })

  app.get('/allowlist', async (c) => {
    const allowlist = telegramService.getAllowlist()
    return c.json(allowlist)
  })

  app.post('/allowlist', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = AddToAllowlistSchema.safeParse(body)
      
      if (!parsed.success) {
        return c.json({ error: 'Invalid request: chatId is required' }, 400)
      }
      
      telegramService.addToAllowlist(parsed.data.chatId)
      return c.json({ success: true })
    } catch (error) {
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to add to allowlist' 
      }, 500)
    }
  })

  app.delete('/allowlist/:chatId', async (c) => {
    const chatId = c.req.param('chatId')
    const removed = telegramService.removeFromAllowlist(chatId)
    
    if (removed) {
      return c.json({ success: true })
    }
    return c.json({ error: 'Chat ID not found in allowlist' }, 404)
  })

  return app
}
