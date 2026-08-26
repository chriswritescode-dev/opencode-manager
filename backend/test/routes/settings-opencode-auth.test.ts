import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { createSettingsRoutes } from '../../src/routes/settings'
import { encryptSecret } from '../../src/utils/crypto'
import { ENV } from '@opencode-manager/shared/config/env'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { GitAuthService } from '../../src/services/git-auth'
import type { SettingsService } from '../../src/services/settings'

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
    getLastStartupError: vi.fn(() => null),
    checkHealth: vi.fn(() => true),
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

    it('keeps the proxy lifecycle gate closed during the supervised restart and reopens only after a verified healthy restart', async () => {
      const lifecycle = { initialized: false }
      const { app: supervisedApp, manager } = createSupervisedApp(db, lifecycle)

      let releaseRestart!: () => void
      manager.restart.mockImplementationOnce(
        () => new Promise<void>((resolve) => { releaseRestart = resolve }),
      )

      const patchPromise = supervisedApp.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      })
      await vi.waitFor(() => expect(manager.restart).toHaveBeenCalledTimes(1))
      expect(lifecycle.initialized).toBe(false)

      releaseRestart()
      const response = await patchPromise

      expect(response.status).toBe(200)
      expect(lifecycle.initialized).toBe(true)
      expect(await response.json()).toEqual({ isSet: true, source: 'db' })
      expect(db.prepare('SELECT 1 FROM app_secrets WHERE key = ?').get('opencode_server_password')).toBeDefined()
    })

    it('fails the auth update and restores the prior password when the supervised restart ends unhealthy, keeping the proxy gate closed', async () => {
      insertPassword('testpassword123')
      const previous = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string }
      const lifecycle = { initialized: false }
      const { app: supervisedApp, manager } = createSupervisedApp(db, lifecycle)
      manager.checkHealth.mockResolvedValue(false)
      manager.isLastStartupErrorNonRecoverable.mockReturnValue(true)

      const response = await supervisedApp.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(500)
      expect(manager.restart).toHaveBeenCalledTimes(2)
      expect(lifecycle.initialized).toBe(false)

      const restored = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get('opencode_server_password') as { value: string } | undefined
      expect(restored?.value).toBe(previous.value)
    })
  })

  function createSupervisedApp(db: Database, lifecycle: { initialized: boolean }) {
    const manager = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isOperationInProgress: vi.fn(() => false),
      checkHealth: vi.fn().mockResolvedValue(true),
      restart: vi.fn().mockResolvedValue(undefined),
      reloadConfig: vi.fn().mockResolvedValue(undefined),
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      isLastStartupErrorNonRecoverable: vi.fn(() => false),
      setLifecycleInitialized: vi.fn((value: boolean) => { lifecycle.initialized = value }),
      getPort: vi.fn(() => 5551),
      getVersion: vi.fn(() => '1.0.137'),
      getMinVersion: vi.fn(() => '1.0.137'),
      isVersionSupported: vi.fn(() => true),
    }
    const supervisor = new OpenCodeSupervisor(manager as unknown as never, {} as SettingsService, {
      failureThreshold: 1,
      watchEnabled: false,
    })
    const routes = createSettingsRoutes(db, {} as GitAuthService, {} as OpenCodeClient, supervisor)
    return { app: new Hono().route('/api/settings', routes), manager }
  }

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
