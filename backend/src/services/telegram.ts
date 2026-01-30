import { Bot, GrammyError, HttpError } from 'grammy'
import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { opencodeSdkClient } from './opencode-sdk-client'

export interface TelegramSession {
  id: number
  chat_id: string
  opencode_session_id: string
  created_at: number
  updated_at: number
}

export interface TelegramAllowlistEntry {
  id: number
  chat_id: string
  added_at: number
}

export interface TelegramStatus {
  running: boolean
  botUsername?: string
  activeSessions: number
  allowlistCount: number
  startedAt?: number
}

const MAX_MESSAGE_LENGTH = 4096
const TYPING_INTERVAL_MS = 5000

function chunkText(text: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text]
  }
  
  const chunks: string[] = []
  let remaining = text
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }
    
    let splitIndex = remaining.lastIndexOf('\n', maxLength)
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength)
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength
    }
    
    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trimStart()
  }
  
  return chunks
}

class TelegramService {
  private db: Database | null = null
  private bot: Bot | null = null
  private startedAt: number | null = null
  private messageQueue: Map<string, Promise<void>> = new Map()

  setDatabase(db: Database): void {
    this.db = db
  }

  isRunning(): boolean {
    return this.bot !== null
  }

  async start(token: string): Promise<void> {
    if (this.bot) {
      logger.warn('Telegram bot already running, stopping first')
      await this.stop()
    }

    if (!this.db) {
      throw new Error('Database not set')
    }

    logger.info('Starting Telegram bot...')
    this.bot = new Bot(token)

    this.bot.on('message:text', async (ctx) => {
      const chatId = String(ctx.chat.id)
      const text = ctx.message.text

      if (!this.isAllowed(chatId)) {
        logger.warn(`Telegram: Unauthorized access attempt from chat ${chatId}`)
        await ctx.reply('Access denied. Contact the administrator to add your chat ID to the allowlist.')
        return
      }

      await this.queueMessage(chatId, async () => {
        await this.handleMessage(ctx, chatId, text)
      })
    })

    this.bot.catch((err) => {
      const ctx = err.ctx
      logger.error(`Telegram error while handling update ${ctx.update.update_id}:`)
      
      const e = err.error
      if (e instanceof GrammyError) {
        logger.error(`Grammy error: ${e.description}`)
      } else if (e instanceof HttpError) {
        logger.error(`HTTP error: ${e}`)
      } else {
        logger.error(`Unknown error: ${e}`)
      }
    })

    try {
      const me = await this.bot.api.getMe()
      logger.info(`Telegram bot @${me.username} started successfully`)
      
      this.startedAt = Date.now()
      
      this.bot.start({
        onStart: () => {
          logger.info('Telegram bot polling started')
        },
      })
    } catch (error) {
      this.bot = null
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      logger.info('Stopping Telegram bot...')
      await this.bot.stop()
      this.bot = null
      this.startedAt = null
      logger.info('Telegram bot stopped')
    }
  }

  getStatus(): TelegramStatus {
    return {
      running: this.isRunning(),
      botUsername: this.bot ? undefined : undefined,
      activeSessions: this.getSessionCount(),
      allowlistCount: this.getAllowlistCount(),
      startedAt: this.startedAt ?? undefined,
    }
  }

  private async queueMessage(chatId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.messageQueue.get(chatId) ?? Promise.resolve()
    const next = previous.then(task).catch((err) => {
      logger.error(`Telegram queue error for chat ${chatId}:`, err)
    }).finally(() => {
      if (this.messageQueue.get(chatId) === next) {
        this.messageQueue.delete(chatId)
      }
    })
    this.messageQueue.set(chatId, next)
    await next
  }

  private async handleMessage(ctx: any, chatId: string, text: string): Promise<void> {
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {})
    }, TYPING_INTERVAL_MS)

    try {
      await ctx.replyWithChatAction('typing')
      
      const session = await this.getOrCreateSession(chatId)
      
      if (!opencodeSdkClient.isConfigured()) {
        await ctx.reply('OpenCode server is not available. Please try again later.')
        return
      }

      const response = await this.sendToOpenCode(session.opencode_session_id, text)
      
      if (!response) {
        await ctx.reply('No response received from OpenCode.')
        return
      }

      const chunks = chunkText(response)
      for (const chunk of chunks) {
        await ctx.reply(chunk)
      }

      this.updateSessionTimestamp(chatId)
    } catch (error) {
      logger.error(`Telegram: Error handling message from ${chatId}:`, error)
      await ctx.reply('An error occurred while processing your message. Please try again.')
    } finally {
      clearInterval(typingInterval)
    }
  }

  private async sendToOpenCode(sessionId: string, message: string): Promise<string | null> {
    try {
      const baseUrl = opencodeSdkClient.getBaseUrl()
      
      const response = await fetch(`${baseUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parts: [{ type: 'text', text: message }],
        }),
        signal: AbortSignal.timeout(120000),
      })

      if (!response.ok) {
        throw new Error(`OpenCode API error: ${response.status}`)
      }

      let fullResponse = ''
      const reader = response.body?.getReader()
      
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'part' && data.part?.type === 'text') {
                fullResponse += data.part.text || ''
              }
            } catch {
            }
          }
        }
      }

      return fullResponse.trim() || null
    } catch (error) {
      logger.error('Error sending to OpenCode:', error)
      throw error
    }
  }

  private async getOrCreateSession(chatId: string): Promise<TelegramSession> {
    if (!this.db) {
      throw new Error('Database not set')
    }

    const existing = this.db
      .prepare('SELECT * FROM telegram_sessions WHERE chat_id = ?')
      .get(chatId) as TelegramSession | undefined

    if (existing) {
      return existing
    }

    const baseUrl = opencodeSdkClient.getBaseUrl()
    const createResponse = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Telegram Chat ${chatId}`,
      }),
    })

    if (!createResponse.ok) {
      throw new Error(`Failed to create OpenCode session: ${createResponse.status}`)
    }

    const sessionData = await createResponse.json() as { id: string }
    const now = Date.now()

    this.db
      .prepare(`
        INSERT INTO telegram_sessions (chat_id, opencode_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(chatId, sessionData.id, now, now)

    logger.info(`Created new Telegram session for chat ${chatId}`)

    return {
      id: 0,
      chat_id: chatId,
      opencode_session_id: sessionData.id,
      created_at: now,
      updated_at: now,
    }
  }

  private updateSessionTimestamp(chatId: string): void {
    if (!this.db) return
    
    this.db
      .prepare('UPDATE telegram_sessions SET updated_at = ? WHERE chat_id = ?')
      .run(Date.now(), chatId)
  }

  private isAllowed(chatId: string): boolean {
    if (!this.db) return false

    const allowlistCount = this.getAllowlistCount()
    
    if (allowlistCount === 0) {
      return true
    }

    const entry = this.db
      .prepare('SELECT 1 FROM telegram_allowlist WHERE chat_id = ?')
      .get(chatId)
    
    return !!entry
  }

  private getSessionCount(): number {
    if (!this.db) return 0
    
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM telegram_sessions')
      .get() as { count: number }
    
    return result?.count ?? 0
  }

  private getAllowlistCount(): number {
    if (!this.db) return 0
    
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM telegram_allowlist')
      .get() as { count: number }
    
    return result?.count ?? 0
  }

  getAllSessions(): TelegramSession[] {
    if (!this.db) return []
    
    return this.db
      .prepare('SELECT * FROM telegram_sessions ORDER BY updated_at DESC')
      .all() as TelegramSession[]
  }

  getAllowlist(): TelegramAllowlistEntry[] {
    if (!this.db) return []
    
    return this.db
      .prepare('SELECT * FROM telegram_allowlist ORDER BY added_at DESC')
      .all() as TelegramAllowlistEntry[]
  }

  addToAllowlist(chatId: string): void {
    if (!this.db) {
      throw new Error('Database not set')
    }

    this.db
      .prepare(`
        INSERT OR IGNORE INTO telegram_allowlist (chat_id, added_at)
        VALUES (?, ?)
      `)
      .run(chatId, Date.now())
    
    logger.info(`Added chat ${chatId} to Telegram allowlist`)
  }

  removeFromAllowlist(chatId: string): boolean {
    if (!this.db) {
      throw new Error('Database not set')
    }

    const result = this.db
      .prepare('DELETE FROM telegram_allowlist WHERE chat_id = ?')
      .run(chatId)
    
    if (result.changes > 0) {
      logger.info(`Removed chat ${chatId} from Telegram allowlist`)
      return true
    }
    
    return false
  }

  deleteSession(chatId: string): boolean {
    if (!this.db) {
      throw new Error('Database not set')
    }

    const result = this.db
      .prepare('DELETE FROM telegram_sessions WHERE chat_id = ?')
      .run(chatId)
    
    return result.changes > 0
  }

  seedAllowlistFromEnv(): void {
    const allowlistEnv = process.env.TELEGRAM_ALLOWLIST
    if (!allowlistEnv) return

    const chatIds = allowlistEnv.split(',').map(id => id.trim()).filter(Boolean)
    
    for (const chatId of chatIds) {
      this.addToAllowlist(chatId)
    }
    
    if (chatIds.length > 0) {
      logger.info(`Seeded ${chatIds.length} chat IDs from TELEGRAM_ALLOWLIST env var`)
    }
  }
}

export const telegramService = new TelegramService()
