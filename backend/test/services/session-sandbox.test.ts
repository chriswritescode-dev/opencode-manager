import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  getSessionSandboxMode,
  setSessionSandboxResources,
  setSessionSandboxed,
} from '../../src/db/session-sandbox-modes'
import { parseMemoryMib } from '../../src/services/sandbox/command'
import { SettingsService } from '../../src/services/settings'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { SessionSandboxService } from '../../src/services/session-sandbox'
import { logger } from '../../src/utils/logger'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import { createFakeSessionPermissionClient } from '../helpers/fake-session-permission-client'

const DIRECTORY = '/abs/repo'

const ENV_RESOURCES = { cpus: ENV.SANDBOX.CPUS, memoryMib: parseMemoryMib(ENV.SANDBOX.MEMORY) ?? 0 }

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createService(
  db: Database,
  client: OpenCodeClient,
  settingsService: SettingsService,
  sandboxes: { removeSessionSandbox(rootSessionId: string): Promise<void> } = { removeSessionSandbox: async () => undefined },
): SessionSandboxService {
  return new SessionSandboxService(db, new SessionAncestry(client), settingsService, sandboxes)
}

function sessionCreatedEvent(sessionID: string, parentID?: string): SSEEvent {
  return {
    id: `evt_created_${sessionID}`,
    created: Date.now(),
    type: 'session.created',
    location: { directory: DIRECTORY },
    data: { sessionID, parentID },
  } as unknown as SSEEvent
}

function sessionForkedEvent(sessionID: string, parentID: string): SSEEvent {
  return {
    id: `evt_forked_${sessionID}`,
    created: Date.now(),
    type: 'session.forked',
    location: { directory: DIRECTORY },
    data: { sessionID, parentID, boundary: { messageID: 'msg_1', partID: null } },
  } as unknown as SSEEvent
}

function sessionDeletedEvent(sessionID: string): SSEEvent {
  return {
    id: `evt_deleted_${sessionID}`,
    created: Date.now(),
    type: 'session.deleted',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as unknown as SSEEvent
}

describe('SessionSandboxService', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('defaults an unstored root session to the configured default when support is enabled', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.getState('ses_root')).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: true,
      source: 'default',
      resources: null,
      effectiveResources: ENV_RESOURCES,
      lockedReason: null,
      available: true,
    })
  })

  it('reports unavailable and unsandboxed when server sandbox support is disabled', async () => {
    const settingsService = new SettingsService(db)
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxed(db, 'ses_root', true)

    await expect(service.getState('ses_root')).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      resources: null,
      effectiveResources: ENV_RESOURCES,
      lockedReason: null,
      available: false,
    })
  })

  it('reports the stored value and source when server sandbox support is enabled', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxed(db, 'ses_root', false)

    await expect(service.getState('ses_root')).resolves.toMatchObject({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      resources: null,
      available: true,
    })
  })

  it('reports the per-session override and the effective resources', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxed(db, 'ses_root', true)
    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, true)

    await expect(service.getState('ses_root')).resolves.toMatchObject({
      source: 'user',
      resources: { cpus: 4, memoryMib: 8192 },
      effectiveResources: { cpus: 4, memoryMib: 8192 },
    })
  })

  it('stamps the default value on a new root session but not on a child', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true, defaultForNewSessions: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))
    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_child', 'ses_root'))

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({
      sandboxed: true,
      source: 'default',
      resources: null,
    })
    expect(getSessionSandboxMode(db, 'ses_child')).toBeNull()
  })

  it('stamps the configured default of false on a new root session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true, defaultForNewSessions: false } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))

    expect(getSessionSandboxMode(db, 'ses_root')?.sandboxed).toBe(false)
  })

  it('inherits the root value for a child and reports the child lock', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', false)
    const client = createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } })
    const service = createService(db, client, settingsService)

    await expect(service.getState('ses_child')).resolves.toMatchObject({
      sessionId: 'ses_child',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      lockedReason: 'child',
      available: true,
    })
  })

  it('fails closed to sandboxed when parent resolution fails and support is enabled', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), settingsService)

    await expect(service.getState('ses_root')).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: true,
      source: 'default',
      resources: null,
      effectiveResources: ENV_RESOURCES,
      lockedReason: null,
      available: true,
    })
  })

  it('fails closed to unsandboxed when parent resolution fails and support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), new SettingsService(db))

    await expect(service.getState('ses_root')).resolves.toMatchObject({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'default',
      resources: null,
      available: false,
    })
  })

  it('copies the parent root sandbox flag, source, and resources onto a forked session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_source', false)
    setSessionSandboxResources(db, 'ses_source', { cpus: 4, memoryMib: 8192 }, false)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_source: null } }),
      settingsService,
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_source'))

    expect(getSessionSandboxMode(db, 'ses_fork')).toMatchObject({
      sandboxed: false,
      source: 'user',
      resources: { cpus: 4, memoryMib: 8192 },
    })
  })

  it('copies the parent root row onto a fork when the parent is itself a child', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', false)
    setSessionSandboxResources(db, 'ses_root', { cpus: 2, memoryMib: 4096 }, false)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } }),
      settingsService,
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_child'))

    expect(getSessionSandboxMode(db, 'ses_fork')).toMatchObject({
      sandboxed: false,
      source: 'user',
      resources: { cpus: 2, memoryMib: 4096 },
    })
  })

  it('does not overwrite an explicit stored value when copying onto a fork', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_source', true)
    setSessionSandboxed(db, 'ses_fork', false)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_source: null } }),
      settingsService,
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_source'))

    expect(getSessionSandboxMode(db, 'ses_fork')?.sandboxed).toBe(false)
  })

  it('clears the stored value when the session is deleted', async () => {
    setSessionSandboxed(db, 'ses_root', true)
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))

    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('removes the sandbox microVM when a sandboxed root session is deleted', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const removed: string[] = []
    const service = createService(db, createFakeSessionPermissionClient(), settingsService, {
      removeSessionSandbox: async (rootSessionId) => {
        removed.push(rootSessionId)
      },
    })

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))

    expect(removed).toEqual(['ses_root'])
    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('does not remove a sandbox microVM when a child session is deleted', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const removed: string[] = []
    const service = createService(db, createFakeSessionPermissionClient(), settingsService, {
      removeSessionSandbox: async (rootSessionId) => {
        removed.push(rootSessionId)
      },
    })

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_child'))

    expect(removed).toEqual([])
  })

  it('does not remove a sandbox microVM when server sandbox support is disabled', async () => {
    setSessionSandboxed(db, 'ses_root', true)
    const removed: string[] = []
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db), {
      removeSessionSandbox: async (rootSessionId) => {
        removed.push(rootSessionId)
      },
    })

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))

    expect(removed).toEqual([])
    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('logs and swallows a failure while removing the deleted session sandbox', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      const service = createService(db, createFakeSessionPermissionClient(), settingsService, {
        removeSessionSandbox: async () => {
          throw new Error('msb rm failed')
        },
      })

      await expect(service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))).resolves.toBeUndefined()
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('msb rm failed'))
      })
      expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects updating a child session with 400', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const client = createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } })
    const service = createService(db, client, settingsService)

    await expect(service.update('ses_child', { sandboxed: false })).rejects.toMatchObject({ status: 400 })
    expect(getSessionSandboxMode(db, 'ses_child')).toBeNull()
  })

  it('rejects enabling sandboxing with 409 when server support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.update('ses_root', { sandboxed: true })).rejects.toMatchObject({ status: 409 })
    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('allows disabling sandboxing when server support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.update('ses_root', { sandboxed: false })).resolves.toMatchObject({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      available: false,
    })
    expect(getSessionSandboxMode(db, 'ses_root')?.sandboxed).toBe(false)
  })

  it('rejects a resource override above the host limit with 400', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(
      service.update('ses_root', { resources: { cpus: os.availableParallelism() + 1, memoryMib: 1024 } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('persists a resource override and keeps the toggle timestamp stable', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await service.update('ses_root', { sandboxed: true })
    const toggledAt = getSessionSandboxMode(db, 'ses_root')?.toggledAt

    await expect(service.update('ses_root', { resources: { cpus: 4, memoryMib: 8192 } })).resolves.toMatchObject({
      source: 'user',
      resources: { cpus: 4, memoryMib: 8192 },
      effectiveResources: { cpus: 4, memoryMib: 8192 },
    })

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({ toggledAt })
  })

  it('clears a resource override with null', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, true)

    await expect(service.update('ses_root', { resources: null })).resolves.toMatchObject({
      resources: null,
      effectiveResources: ENV_RESOURCES,
    })
  })

  it('reports a claim with the toggle timestamp and source', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxed(db, 'ses_root', false)
    const toggledAt = getSessionSandboxMode(db, 'ses_root')?.toggledAt

    await expect(service.getClaim('ses_root')).resolves.toEqual({
      sandboxed: false,
      source: 'user',
      since: toggledAt,
    })
  })

  it('reports a zero-since default claim for an unstored root session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.getClaim('ses_root')).resolves.toEqual({
      sandboxed: true,
      source: 'default',
      since: 0,
    })
  })

  it('reports an unsandboxed claim when support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.getClaim('ses_root')).resolves.toEqual({
      sandboxed: false,
      source: 'default',
      since: 0,
    })
  })

  it('fails closed on an ancestry error when reporting a claim', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), settingsService)

    await expect(service.getClaim('ses_root')).resolves.toEqual({
      sandboxed: true,
      source: 'default',
      since: 0,
    })
  })

  it('resolves the shell target to the root session and effective resources', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxResources(db, 'ses_root', { cpus: 4, memoryMib: 8192 }, true)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } }),
      settingsService,
    )

    await expect(service.resolveShellTarget('ses_child')).resolves.toEqual({
      rootSessionId: 'ses_root',
      resources: { cpus: 4, memoryMib: 8192 },
    })
  })
})
