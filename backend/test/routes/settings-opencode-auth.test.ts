import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { createSettingsRoutes } from '../../src/routes/settings'
import { decryptSecret, encryptSecret } from '../../src/utils/crypto'
import { ENV } from '@opencode-manager/shared/config/env'
import { opencodeServerManager } from '../../src/services/opencode-single-server'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { GitAuthService } from '../../src/services/git-auth'
import { SettingsService } from '../../src/services/settings'

vi.mock('bun:sqlite', () => ({
  Database: class Database {},
}))

vi.mock('../../src/services/opencode-single-server', () => ({
  opencodeServerManager: {
    restart: vi.fn(),
    getVersion: vi.fn(),
    fetchVersion: vi.fn(),
    clearStartupError: vi.fn(),
    getLastStartupError: vi.fn(() => null),
    checkHealth: vi.fn(() => true),
  },
  ConfigReloadError: class ConfigReloadError extends Error {
    validationIssues = []
  },
}))

describe('OpenCode Server Auth Routes', () => {
  let db: Database
  let secrets: Map<string, { value: string; created_at: number; updated_at: number }>
  let app: Hono
  let originalPassword: string
  const mockRestart = opencodeServerManager.restart as ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalPassword = ENV.OPENCODE.SERVER_PASSWORD
    setEnvPassword('')
    vi.clearAllMocks()

    const testDb = createTestDb()
    db = testDb.db
    secrets = testDb.secrets

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
    it('reports the managed source without persisting a password on status reads', async () => {
      const response = await app.request('/api/settings/opencode-server-auth')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'managed' })
      expect(secrets.size).toBe(0)
    })

    it('generates and persists an encrypted managed password when the password is resolved', () => {
      const password = new SettingsService(db).getOpenCodeServerPassword()

      const managed = secrets.get('opencode_server_managed_password')
      expect(managed).toBeDefined()
      expect(managed?.value).not.toBe(password)
      expect(decryptSecret(managed!.value)).toBe(password)
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('returns the same managed password across concurrent resolution', async () => {
      const service = new SettingsService(db)
      const passwords = await Promise.all([
        Promise.resolve().then(() => service.getOrCreateManagedOpenCodeServerPassword()),
        Promise.resolve().then(() => service.getOrCreateManagedOpenCodeServerPassword()),
        Promise.resolve().then(() => service.getOpenCodeServerPassword()),
      ])

      expect(new Set(passwords).size).toBe(1)
      expect(passwords[2]).toBe(passwords[0])
      expect(secrets.size).toBe(1)
    })

    it('keeps a stored managed password stable when it already exists', () => {
      const first = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()
      const second = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      expect(second).toBe(first)
      expect(secrets.size).toBe(1)
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

    it('prefers the stored custom password over the managed password', async () => {
      insertPassword('testpassword123')
      new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      expect(new SettingsService(db).getOpenCodeServerPassword()).toBe('testpassword123')
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

    it('clears stored password and reverts to the managed password without env fallback', async () => {
      insertPassword('testpassword123')

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'managed' })
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

    it('keeps the managed password when clearing a custom password', async () => {
      insertPassword('testpassword123')
      const managedBefore = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      const response = await app.request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ isSet: true, source: 'managed' })
      expect(new SettingsService(db).getOpenCodeServerPassword()).toBe(managedBefore)
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
      clearStartupError: vi.fn(),
      getLastStartupError: vi.fn(() => null),
      isLastStartupErrorNonRecoverable: vi.fn(() => false),
      setLifecycleInitialized: vi.fn((value: boolean) => { lifecycle.initialized = value }),
      getPort: vi.fn(() => 5551),
      getVersion: vi.fn(() => '2.0.15'),
      getMinVersion: vi.fn(() => '2.0.15'),
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

  function createTestDb(): { db: Database; secrets: Map<string, { value: string; created_at: number; updated_at: number }> } {
    const secrets = new Map<string, { value: string; created_at: number; updated_at: number }>()

    const db = {
      exec: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn((sql: string) => ({
        get: (key: string) => {
          if (sql.includes('SELECT value')) {
            const secret = secrets.get(key)
            return secret === undefined ? undefined : { value: secret.value }
          }
          if (sql.includes('SELECT 1 FROM app_secrets')) {
            return secrets.has(key) ? { 1: 1 } : undefined
          }
          return undefined
        },
        run: (key: string, value?: string, createdAt?: number, updatedAt?: number) => {
          if (sql.includes('INSERT INTO app_secrets') && value !== undefined) {
            if (sql.includes('DO NOTHING') && secrets.has(key)) {
              return { changes: 0 }
            }
            const existing = secrets.get(key)
            secrets.set(key, {
              value,
              created_at: createdAt ?? existing?.created_at ?? Date.now(),
              updated_at: updatedAt ?? Date.now(),
            })
            return { changes: 1 }
          }
          if (sql.includes('DELETE FROM app_secrets')) {
            secrets.delete(key)
            return { changes: 1 }
          }
          return { changes: 0 }
        },
        all: vi.fn(() => []),
      })),
    } as unknown as Database

    return { db, secrets }
  }
})
