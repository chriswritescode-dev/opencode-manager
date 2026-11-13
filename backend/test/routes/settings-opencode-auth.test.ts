import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import type { OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { ENV } from '@opencode-manager/shared/config/env'
import { createSettingsRoutes } from '../../src/routes/settings'
import { SettingsService } from '../../src/services/settings'
import { OpenCodeSupervisor } from '../../src/services/opencode-supervisor'
import type { OpenCodeRestartTarget } from '../../src/services/opencode-restart'
import { decryptSecret, encryptSecret } from '../../src/utils/crypto'
import { selectRow } from '../../src/db/rows'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createGitAuthService } from '../helpers/git-fixtures'
import { createTestDatabase } from '../helpers/test-database'
import { createOpenCodeServerTestContext } from '../helpers/opencode-server-harness'
import { readJson } from '../helpers/read-json'

const AuthStatusSchema = z.object({ isSet: z.boolean(), source: z.enum(['db', 'env', 'managed']) })
const SecretValueSchema = z.object({ value: z.string() })
const SecretCountSchema = z.object({ count: z.number() })
const SecretExistsSchema = z.object({ found: z.number() })

const CUSTOM_PASSWORD_KEY = 'opencode_server_password'
const MANAGED_PASSWORD_KEY = 'opencode_server_managed_password'
const jsonHeaders = { 'Content-Type': 'application/json' }

function lifecycleStatus(overrides: Partial<OpenCodeLifecycleStatus> = {}): OpenCodeLifecycleStatus {
  return {
    state: 'healthy',
    healthy: true,
    port: 5551,
    version: '2.0.15',
    minVersion: '2.0.15',
    versionSupported: true,
    lastError: null,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: 0,
    watching: false,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

function createRestartTarget(): OpenCodeRestartTarget & { restart: ReturnType<typeof vi.fn> } {
  return { restart: vi.fn(async () => lifecycleStatus()) }
}

function createSupervisedApp(db: Database, restartTarget: OpenCodeRestartTarget): Hono {
  return new Hono().route(
    '/api/settings',
    createSettingsRoutes(db, createGitAuthService(), createStubOpenCodeClient(), restartTarget),
  )
}

describe('OpenCode server auth routes', () => {
  let db: Database
  let originalPassword: string

  function setEnvPassword(password: string): void {
    Object.defineProperty(ENV.OPENCODE, 'SERVER_PASSWORD', { value: password, configurable: true, writable: true })
  }

  function createApp(restartTarget: OpenCodeRestartTarget = createRestartTarget()): Hono {
    return new Hono().route(
      '/api/settings',
      createSettingsRoutes(db, createGitAuthService(), createStubOpenCodeClient(), restartTarget),
    )
  }

  function insertPassword(password: string): void {
    const now = Date.now()
    db.prepare(`INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(CUSTOM_PASSWORD_KEY, encryptSecret(password), now, now)
  }

  function storedPasswordRow(): { value: string } | null {
    return selectRow(db, SecretValueSchema, 'SELECT value FROM app_secrets WHERE key = ?', CUSTOM_PASSWORD_KEY)
  }

  function secretCount(): number {
    const row = selectRow(db, SecretCountSchema, 'SELECT COUNT(*) AS count FROM app_secrets')
    return row?.count ?? 0
  }

  function customPasswordExists(): boolean {
    return selectRow(db, SecretExistsSchema, 'SELECT 1 AS found FROM app_secrets WHERE key = ?', CUSTOM_PASSWORD_KEY) !== null
  }

  beforeEach(() => {
    originalPassword = ENV.OPENCODE.SERVER_PASSWORD
    setEnvPassword('')
    db = createTestDatabase()
  })

  afterEach(() => {
    db.close()
    setEnvPassword(originalPassword)
  })

  describe('GET /api/settings/opencode-server-auth', () => {
    it('reports the managed source without persisting a password on status reads', async () => {
      const response = await createApp().request('/api/settings/opencode-server-auth')
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'managed' })
      expect(secretCount()).toBe(0)
    })

    it('generates and persists an encrypted managed password when the password is resolved', () => {
      const password = new SettingsService(db).getOpenCodeServerPassword()

      const managed = selectRow(db, SecretValueSchema, 'SELECT value FROM app_secrets WHERE key = ?', MANAGED_PASSWORD_KEY)
      expect(managed).not.toBeNull()
      expect(managed?.value).not.toBe(password)
      expect(decryptSecret(managed?.value ?? '')).toBe(password)
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
      expect(secretCount()).toBe(1)
    })

    it('keeps a stored managed password stable when it already exists', () => {
      const first = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()
      const second = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      expect(second).toBe(first)
      expect(secretCount()).toBe(1)
    })

    it('returns source env when only env password is configured', async () => {
      setEnvPassword('envpassword123')

      const response = await createApp().request('/api/settings/opencode-server-auth')
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'env' })
    })

    it('returns source db when stored password exists', async () => {
      insertPassword('testpassword123')

      const response = await createApp().request('/api/settings/opencode-server-auth')
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'db' })
    })

    it('returns source db when both stored and env passwords exist', async () => {
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await createApp().request('/api/settings/opencode-server-auth')
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'db' })
    })

    it('prefers the stored custom password over the managed password', () => {
      insertPassword('testpassword123')
      new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      expect(new SettingsService(db).getOpenCodeServerPassword()).toBe('testpassword123')
    })
  })

  describe('PATCH /api/settings/opencode-server-auth', () => {
    it('stores the password encrypted, restarts the server, and returns the db source', async () => {
      const restartTarget = createRestartTarget()
      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: 'testpassword123' }),
      })
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'db' })
      expect(restartTarget.restart).toHaveBeenCalledOnce()

      const row = storedPasswordRow()
      expect(row).not.toBeNull()
      expect(row?.value).not.toBe('testpassword123')
      expect(decryptSecret(row?.value ?? '')).toBe('testpassword123')
    })

    it('clears the stored password and reverts to the managed password without env fallback', async () => {
      const restartTarget = createRestartTarget()
      insertPassword('testpassword123')

      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: null }),
      })
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'managed' })
      expect(restartTarget.restart).toHaveBeenCalledOnce()
      expect(customPasswordExists()).toBe(false)
    })

    it('clears the stored password and returns the env source when an env fallback exists', async () => {
      const restartTarget = createRestartTarget()
      setEnvPassword('envpassword123')
      insertPassword('testpassword123')

      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: null }),
      })
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'env' })
      expect(restartTarget.restart).toHaveBeenCalledOnce()
    })

    it('keeps the managed password when clearing a custom password', async () => {
      insertPassword('testpassword123')
      const managedBefore = new SettingsService(db).getOrCreateManagedOpenCodeServerPassword()

      const response = await createApp().request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: null }),
      })
      const body = await readJson(response, AuthStatusSchema)

      expect(response.status).toBe(200)
      expect(body).toEqual({ isSet: true, source: 'managed' })
      expect(new SettingsService(db).getOpenCodeServerPassword()).toBe(managedBefore)
    })

    it('returns 400 when the password is shorter than 8 characters', async () => {
      const restartTarget = createRestartTarget()

      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: 'short' }),
      })

      expect(response.status).toBe(400)
      expect(restartTarget.restart).not.toHaveBeenCalled()
    })

    it('restores a missing stored password when the restart fails after storing a new password', async () => {
      setEnvPassword('envpassword123')
      const restartTarget = createRestartTarget()
      restartTarget.restart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: 'testpassword123' }),
      })

      expect(response.status).toBe(500)
      expect(restartTarget.restart).toHaveBeenCalledTimes(2)
      expect(customPasswordExists()).toBe(false)

      const statusResponse = await createApp().request('/api/settings/opencode-server-auth')
      expect(await readJson(statusResponse, AuthStatusSchema)).toEqual({ isSet: true, source: 'env' })
    })

    it('restores the previous stored password when the restart fails after clearing it', async () => {
      insertPassword('testpassword123')
      const previous = storedPasswordRow()
      const restartTarget = createRestartTarget()
      restartTarget.restart.mockRejectedValueOnce(new Error('restart failed'))

      const response = await createApp(restartTarget).request('/api/settings/opencode-server-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ password: null }),
      })

      expect(response.status).toBe(500)
      expect(restartTarget.restart).toHaveBeenCalledTimes(2)
      expect(storedPasswordRow()?.value).toBe(previous?.value)
    })

    it('keeps the proxy lifecycle gate closed during the supervised restart and reopens it after a healthy restart', async () => {
      const context = createOpenCodeServerTestContext()

      try {
        const supervisor = new OpenCodeSupervisor(context.harness.manager, new SettingsService(db), { watchEnabled: false })
        const app = createSupervisedApp(db, supervisor)

        let releaseRestart = (): void => {}
        const restartBlocked = new Promise<void>((resolve) => {
          releaseRestart = resolve
        })
        context.harness.restoreQuarantinedOpenCodePlugins.mockImplementationOnce(async () => {
          await restartBlocked
        })

        const patchPromise = app.request('/api/settings/opencode-server-auth', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ password: 'testpassword123' }),
        })
        await vi.waitFor(() => expect(context.harness.restoreQuarantinedOpenCodePlugins).toHaveBeenCalledTimes(1))
        expect(context.harness.manager.isLifecycleInitialized()).toBe(false)

        releaseRestart()
        const response = await patchPromise
        const body = await readJson(response, AuthStatusSchema)

        expect(response.status).toBe(200)
        expect(body).toEqual({ isSet: true, source: 'db' })
        expect(context.harness.manager.isLifecycleInitialized()).toBe(true)
        expect(customPasswordExists()).toBe(true)
      } finally {
        context.dispose()
      }
    })

    it('fails the auth update and restores the prior password when the supervised restart ends unhealthy', async () => {
      insertPassword('testpassword123')
      const previous = storedPasswordRow()
      const context = createOpenCodeServerTestContext()

      try {
        context.harness.readVersionOutput.mockReturnValue({ stdout: '0.1.0', stderr: '' })
        const supervisor = new OpenCodeSupervisor(context.harness.manager, new SettingsService(db), { watchEnabled: false })
        const app = createSupervisedApp(db, supervisor)

        const response = await app.request('/api/settings/opencode-server-auth', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ password: null }),
        })

        expect(response.status).toBe(500)
        expect(context.harness.manager.isLifecycleInitialized()).toBe(false)
        expect(storedPasswordRow()?.value).toBe(previous?.value)
      } finally {
        context.dispose()
      }
    })

  })
})
