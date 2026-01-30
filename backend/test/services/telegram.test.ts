import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

const mockBotInstance = {
  on: vi.fn(),
  catch: vi.fn(),
  api: {
    getMe: vi.fn().mockResolvedValue({ username: 'test_bot' }),
  },
  start: vi.fn(),
  stop: vi.fn(),
}

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => mockBotInstance),
  GrammyError: class GrammyError extends Error {},
  HttpError: class HttpError extends Error {},
}))

vi.mock('../../src/services/opencode-sdk-client', () => ({
  opencodeSdkClient: {
    isConfigured: vi.fn().mockReturnValue(true),
    getBaseUrl: vi.fn().mockReturnValue('http://localhost:5551'),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

import { telegramService, type TelegramSession, type TelegramAllowlistEntry } from '../../src/services/telegram'
import { Bot } from 'grammy'

describe('TelegramService', () => {
  let mockDb: any
  let sessions: TelegramSession[]
  let allowlist: TelegramAllowlistEntry[]
  let sessionIdCounter: number
  let allowlistIdCounter: number

  beforeEach(() => {
    vi.clearAllMocks()
    sessions = []
    allowlist = []
    sessionIdCounter = 1
    allowlistIdCounter = 1

    mockDb = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('INSERT INTO telegram_sessions')) {
          return {
            run: vi.fn((...args) => {
              const session: TelegramSession = {
                id: sessionIdCounter++,
                chat_id: args[0],
                opencode_session_id: args[1],
                created_at: args[2],
                updated_at: args[3]
              }
              sessions.push(session)
              return { lastInsertRowid: session.id, changes: 1 }
            })
          }
        }
        if (sql.includes('SELECT * FROM telegram_sessions WHERE chat_id')) {
          return {
            get: vi.fn((chatId: string) => sessions.find(s => s.chat_id === chatId))
          }
        }
        if (sql.includes('SELECT * FROM telegram_sessions ORDER BY')) {
          return {
            all: vi.fn(() => sessions)
          }
        }
        if (sql.includes('UPDATE telegram_sessions SET updated_at')) {
          return {
            run: vi.fn((updatedAt, chatId) => {
              const session = sessions.find(s => s.chat_id === chatId)
              if (session) {
                session.updated_at = updatedAt
              }
              return { changes: session ? 1 : 0 }
            })
          }
        }
        if (sql.includes('DELETE FROM telegram_sessions WHERE chat_id')) {
          return {
            run: vi.fn((chatId: string) => {
              const index = sessions.findIndex(s => s.chat_id === chatId)
              if (index !== -1) {
                sessions.splice(index, 1)
                return { changes: 1 }
              }
              return { changes: 0 }
            })
          }
        }
        if (sql.includes('INSERT OR IGNORE INTO telegram_allowlist')) {
          return {
            run: vi.fn((...args) => {
              const existing = allowlist.find(a => a.chat_id === args[0])
              if (!existing) {
                const entry: TelegramAllowlistEntry = {
                  id: allowlistIdCounter++,
                  chat_id: args[0],
                  added_at: args[1]
                }
                allowlist.push(entry)
                return { changes: 1 }
              }
              return { changes: 0 }
            })
          }
        }
        if (sql.includes('SELECT 1 FROM telegram_allowlist WHERE chat_id')) {
          return {
            get: vi.fn((chatId: string) => allowlist.find(a => a.chat_id === chatId) ? { 1: 1 } : undefined)
          }
        }
        if (sql.includes('SELECT * FROM telegram_allowlist ORDER BY')) {
          return {
            all: vi.fn(() => allowlist)
          }
        }
        if (sql.includes('DELETE FROM telegram_allowlist WHERE chat_id')) {
          return {
            run: vi.fn((chatId: string) => {
              const index = allowlist.findIndex(a => a.chat_id === chatId)
              if (index !== -1) {
                allowlist.splice(index, 1)
                return { changes: 1 }
              }
              return { changes: 0 }
            })
          }
        }
        if (sql.includes('SELECT COUNT(*) as count FROM telegram_sessions')) {
          return {
            get: vi.fn(() => ({ count: sessions.length }))
          }
        }
        if (sql.includes('SELECT COUNT(*) as count FROM telegram_allowlist')) {
          return {
            get: vi.fn(() => ({ count: allowlist.length }))
          }
        }
        return {
          all: vi.fn(() => []),
          get: vi.fn(() => undefined),
          run: vi.fn(() => ({ changes: 0 }))
        }
      })
    }

    telegramService.setDatabase(mockDb)
  })

  afterEach(async () => {
    await telegramService.stop()
    delete process.env.TELEGRAM_ALLOWLIST
  })

  describe('setDatabase', () => {
    it('should set the database', () => {
      expect(() => telegramService.setDatabase(mockDb)).not.toThrow()
    })
  })

  describe('isRunning', () => {
    it('should return false when not started', () => {
      expect(telegramService.isRunning()).toBe(false)
    })

    it('should return true after starting', async () => {
      await telegramService.start('test-token')
      expect(telegramService.isRunning()).toBe(true)
    })
  })

  describe('start', () => {
    it('should start the bot successfully', async () => {
      await telegramService.start('test-token')
      
      expect(Bot).toHaveBeenCalledWith('test-token')
      expect(telegramService.isRunning()).toBe(true)
    })

    it('should register message handler', async () => {
      await telegramService.start('test-token')
      
      expect(mockBotInstance.on).toHaveBeenCalledWith('message:text', expect.any(Function))
    })

    it('should register error handler', async () => {
      await telegramService.start('test-token')
      
      expect(mockBotInstance.catch).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should call getMe to verify token', async () => {
      await telegramService.start('test-token')
      
      expect(mockBotInstance.api.getMe).toHaveBeenCalled()
    })

    it('should stop existing bot before starting new one', async () => {
      await telegramService.start('token-1')
      mockBotInstance.stop.mockClear()
      
      await telegramService.start('token-2')
      expect(mockBotInstance.stop).toHaveBeenCalled()
    })
  })

  describe('stop', () => {
    it('should stop the bot', async () => {
      await telegramService.start('test-token')
      await telegramService.stop()
      
      expect(telegramService.isRunning()).toBe(false)
    })

    it('should not throw if bot not started', async () => {
      await expect(telegramService.stop()).resolves.not.toThrow()
    })
  })

  describe('getStatus', () => {
    it('should return status when not running', () => {
      const status = telegramService.getStatus()
      
      expect(status.running).toBe(false)
      expect(status.activeSessions).toBe(0)
      expect(status.allowlistCount).toBe(0)
    })

    it('should return status when running', async () => {
      await telegramService.start('test-token')
      const status = telegramService.getStatus()
      
      expect(status.running).toBe(true)
      expect(status.startedAt).toBeDefined()
    })

    it('should count sessions correctly', () => {
      sessions.push({ id: 1, chat_id: '111', opencode_session_id: 'sess-1', created_at: Date.now(), updated_at: Date.now() })
      sessions.push({ id: 2, chat_id: '222', opencode_session_id: 'sess-2', created_at: Date.now(), updated_at: Date.now() })
      
      const status = telegramService.getStatus()
      expect(status.activeSessions).toBe(2)
    })

    it('should count allowlist correctly', () => {
      allowlist.push({ id: 1, chat_id: '111', added_at: Date.now() })
      allowlist.push({ id: 2, chat_id: '222', added_at: Date.now() })
      allowlist.push({ id: 3, chat_id: '333', added_at: Date.now() })
      
      const status = telegramService.getStatus()
      expect(status.allowlistCount).toBe(3)
    })
  })

  describe('allowlist management', () => {
    it('should add chat ID to allowlist', () => {
      telegramService.addToAllowlist('12345')
      
      expect(allowlist).toHaveLength(1)
      expect(allowlist[0].chat_id).toBe('12345')
    })

    it('should not duplicate chat IDs', () => {
      telegramService.addToAllowlist('12345')
      telegramService.addToAllowlist('12345')
      
      expect(allowlist).toHaveLength(1)
    })

    it('should remove chat ID from allowlist', () => {
      allowlist.push({ id: 1, chat_id: '12345', added_at: Date.now() })
      
      const removed = telegramService.removeFromAllowlist('12345')
      
      expect(removed).toBe(true)
      expect(allowlist).toHaveLength(0)
    })

    it('should return false when removing non-existent chat ID', () => {
      const removed = telegramService.removeFromAllowlist('99999')
      expect(removed).toBe(false)
    })

    it('should get all allowlist entries', () => {
      allowlist.push({ id: 1, chat_id: '111', added_at: Date.now() })
      allowlist.push({ id: 2, chat_id: '222', added_at: Date.now() })
      
      const result = telegramService.getAllowlist()
      expect(result).toHaveLength(2)
    })
  })

  describe('session management', () => {
    it('should return all sessions', () => {
      sessions.push({ id: 1, chat_id: '111', opencode_session_id: 'sess-1', created_at: Date.now(), updated_at: Date.now() })
      
      const result = telegramService.getAllSessions()
      expect(result).toHaveLength(1)
    })

    it('should delete session', () => {
      sessions.push({ id: 1, chat_id: '12345', opencode_session_id: 'sess-abc', created_at: Date.now(), updated_at: Date.now() })
      
      const deleted = telegramService.deleteSession('12345')
      expect(deleted).toBe(true)
      expect(sessions).toHaveLength(0)
    })

    it('should return false when deleting non-existent session', () => {
      const deleted = telegramService.deleteSession('99999')
      expect(deleted).toBe(false)
    })
  })

  describe('seedAllowlistFromEnv', () => {
    it('should seed allowlist from environment variable', () => {
      process.env.TELEGRAM_ALLOWLIST = '111,222,333'
      
      telegramService.seedAllowlistFromEnv()
      
      expect(allowlist).toHaveLength(3)
      expect(allowlist.map(e => e.chat_id)).toContain('111')
      expect(allowlist.map(e => e.chat_id)).toContain('222')
      expect(allowlist.map(e => e.chat_id)).toContain('333')
    })

    it('should handle empty env var gracefully', () => {
      delete process.env.TELEGRAM_ALLOWLIST
      
      expect(() => telegramService.seedAllowlistFromEnv()).not.toThrow()
    })

    it('should handle whitespace in env var', () => {
      process.env.TELEGRAM_ALLOWLIST = '111 , 222 , 333'
      
      telegramService.seedAllowlistFromEnv()
      
      expect(allowlist).toHaveLength(3)
    })

    it('should filter empty strings', () => {
      process.env.TELEGRAM_ALLOWLIST = '111,,222,,'
      
      telegramService.seedAllowlistFromEnv()
      
      expect(allowlist).toHaveLength(2)
    })
  })
})
