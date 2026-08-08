import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { createSettingsRoutes } from '../../src/routes/settings'
import { encryptSecret } from '../../src/utils/crypto'
import { ENV } from '@opencode-manager/shared/config/env'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { GitAuthService } from '../../src/services/git-auth'

vi.mock('bun:sqlite', () => ({
  Database: class Database {},
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    restart: vi.fn(),
    reloadConfig: vi.fn(),
    getVersion: vi.fn(),
    fetchVersion: vi.fn(),
    clearStartupError: vi.fn(),
    reinitializeBinDirectory: vi.fn(),
  },
  ConfigReloadError: class ConfigReloadError extends Error {
    validationIssues = []
    removedFields = []
  },
}))

describe('OpenCode Server Auth Routes', () => {
  let db: Database
  let app: Hono
  let originalPassword: string
  const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalPassword = ENV.OPENCODE.SERVER_PASSWORD
    setEnvPassword('')
    vi.clearAllMocks()

    db = createTestDb()

    const mockGitAuthService = {} as GitAuthService
    const mockOpenCodeClient = {} as OpenCodeClient
    const routes = createSettingsRoutes(db, mockGitAuthService, mockOpenCodeClient)
    app = new Hono().route('/api/settings', routes)
  })

  afterEach(() => {
    db.close()
    setEnvPassword(originalPassword)
  })

  describe('GET /api/settings/opencode-server-auth', () => {
    it('returns source none when no password is configured', async () => {
      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: false, source: 'none' })
    })

    it('returns source env when only env password is configured', async () => {
      setEnvPassword('envpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'env' })
    })

    it('returns source db when stored password exists', async () => {
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
    })

    it('returns source db when both stored and env passwords exist', async () => {
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
    })
  })

  describe('PATCH /api/settings/opencode-server-auth', () => {
    it('stores password encrypted, restarts server, and returns db source', async () => {
      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
      expect(mockRestart).toHaveBeenCalledOnce()

      const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string } | undefined
      expect(row).toBeDefined()
      expect(row?.value).not.toBe('testpassword123')
    })

    it('clears stored password and returns none source without env fallback', async () => {
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: false, source: 'none' })
      expect(mockRestart).toHaveBeenCalledOnce()
      expect(db.prepare('SELECT 1 FROM app_secrets WHERE key = ?').get('opencode_server_password')).toBeUndefined()
    })

    it('clears stored password and returns env source when env fallback exists', async () => {
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'env' })
      expect(mockRestart).toHaveBeenCalledOnce()
    })

    it('returns 400 when password is shorter than 8 characters', async () => {
      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'short' }),
      })

      expect(response.status).toBe(400)
      expect(mockRestart).not.toHaveBeenCalled()
    })

    it('restores missing stored password when restart fails after storing a new password', async () => {
      setEnvPassword('envpassword123')
      mockRestart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      })

      expect(response.status).toBe(500)
      expect(mockRestart).toHaveBeenCalledTimes(2)
      expect(db.prepare('SELECT 1 FROM app_secrets WHERE key = ?').get('opencode_server_password')).toBeUndefined()

      const statusResponse = await app.request('/api/settings/opencode-server-auth')
      expect(await statusResponse.json()).toEqual({ isSet: true, source: 'env' })
    })

    it('restores previous stored password when restart fails after clearing it', async () => {
      insertPassword('testpassword123')
      const previous = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string }
      mockRestart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(500)
      expect(mockRestart).toHaveBeenCalledTimes(2)

      const restored = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string } | undefined
      expect(restored?.value).toBe(previous.value)
    })
  })

  function insertPassword(password: string) {
    const encrypted = encryptSecret(password)
    const now = Date.now()
    db.prepare(`
      INSERT INTO app_secrets (key, value, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('opencode_server_password', encrypted, now, now)
  }

  function setEnvPassword(password: string) {
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', {
      value: password,
      configurable: true,
      writable: true,
    })
  }

  function createTestDb(): Database {
    const secrets = new Map<string, { value: string; created_at: number; updated_at: number }>()

    return {
      exec: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn((sql: string) => ({
        get: (key: string) => {
          if (sql.includes('SELECT value')) {
            const secret = secrets.get(key)
            return secret === undefined ? undefined : secret
          }
          if (sql.includes('SELECT 1 FROM app_secrets')) {
            return secrets.has(key) ? { 1: 1 } : undefined
          }
          return undefined
        },
        run: (key: string, value?: string, createdAt?: number, updatedAt?: number) => {
          if (sql.includes('INSERT INTO app_secrets') && value !== undefined) {
            const existing = secrets.get(key)
            secrets.set(key, {
              value,
              created_at: createdAt ?? existing?.created_at ?? Date.now(),
              updated_at: updatedAt ?? Date.now(),
            })
          }
          if (sql.includes('DELETE FROM app_secrets')) {
            secrets.delete(key)
          }
          return { changes: 1 }
        },
        all: vi.fn(() => []),
      })),
    } as unknown as Database
  }
})
