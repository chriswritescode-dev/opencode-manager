import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  getSessionSandboxMode,
  setSessionSandboxed,
} from '../../src/db/session-sandbox-modes'
import { SettingsService } from '../../src/services/settings'
import { SessionAncestry } from '../../src/services/session-ancestry'
import { SessionSandboxService } from '../../src/services/session-sandbox'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import { createFakeSessionPermissionClient } from '../helpers/fake-session-permission-client'

const DIRECTORY = '/abs/repo'

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createService(
  db: Database,
  client: OpenCodeClient,
  settingsService: SettingsService,
): SessionSandboxService {
  return new SessionSandboxService(db, new SessionAncestry(client), settingsService)
}

type SessionCreatedEvent = Extract<SSEEvent, { type: 'session.created' }>
type SessionForkedEvent = Extract<SSEEvent, { type: 'session.forked' }>
type SessionDeletedEvent = Extract<SSEEvent, { type: 'session.deleted' }>

function sessionCreatedEvent(sessionID: string, parentID?: string): SSEEvent {
  const data: SessionCreatedEvent['data'] = {
    sessionID,
    projectID: 'proj_test',
    location: { directory: DIRECTORY },
    slug: sessionID,
    version: '2.0.15',
  }
  if (parentID !== undefined) {
    data.parentID = parentID
  }
  const event: SessionCreatedEvent = {
    id: `evt_created_${sessionID}`,
    created: 1,
    type: 'session.created',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    location: { directory: DIRECTORY },
    data,
  }
  return event
}

function sessionForkedEvent(sessionID: string, parentID: string): SSEEvent {
  const event: SessionForkedEvent = {
    id: `evt_forked_${sessionID}`,
    created: 1,
    type: 'session.forked',
    durable: { aggregateID: sessionID, seq: 1, version: 2 },
    location: { directory: DIRECTORY },
    data: { sessionID, parentID, boundary: { type: 'before', messageID: 'msg_1' } },
  }
  return event
}

function sessionDeletedEvent(sessionID: string): SSEEvent {
  const event: SessionDeletedEvent = {
    id: `evt_deleted_${sessionID}`,
    created: 1,
    type: 'session.deleted',
    durable: { aggregateID: sessionID, seq: 1, version: 2 },
    location: { directory: DIRECTORY },
    data: { sessionID },
  }
  return event
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
      available: true,
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

  it('rejects getState when parent resolution fails and support is enabled', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), settingsService)

    await expect(service.getState('ses_root')).rejects.toThrow('upstream unavailable')
  })

  it('rejects getState when parent resolution fails and support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), new SettingsService(db))

    await expect(service.getState('ses_root')).rejects.toThrow('upstream unavailable')
  })

  it('copies the parent root sandbox flag and source onto a fork when the parent is itself a child', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', false)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } }),
      settingsService,
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_child'))

    expect(getSessionSandboxMode(db, 'ses_fork')).toMatchObject({
      sandboxed: false,
      source: 'user',
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

  it('clears the stored value of a sandboxed root session when it is deleted', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))).resolves.toBeUndefined()

    expect(getSessionSandboxMode(db, 'ses_root')).toBeNull()
  })

  it('keeps the root mode row when a child session is deleted', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_child'))

    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({ sandboxed: true, source: 'user' })
    expect(getSessionSandboxMode(db, 'ses_child')).toBeNull()
  })

  it('persists turning sandboxing off and returns the updated state', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', true)
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.update('ses_root', { sandboxed: false })).resolves.toMatchObject({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      sandboxed: false,
      source: 'user',
      available: true,
    })
    expect(getSessionSandboxMode(db, 'ses_root')).toMatchObject({ sandboxed: false, source: 'user' })
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

  it('reports the stored sandbox flag for a session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    setSessionSandboxed(db, 'ses_root', false)

    await expect(service.getClaim('ses_root')).resolves.toEqual({ sandboxed: false })
  })

  it('reports the default sandbox flag for an unstored root session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.getClaim('ses_root')).resolves.toEqual({ sandboxed: true })
  })

  it('reports unsandboxed when support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.getClaim('ses_root')).resolves.toEqual({ sandboxed: false })
  })

  it('rejects getClaim on an ancestry error', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient({ failSessionGet: true }), settingsService)

    await expect(service.getClaim('ses_root')).rejects.toThrow('upstream unavailable')
  })

  it('reports sandboxed for an unstored root session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.resolveShellTarget('ses_root')).resolves.toEqual({ sandboxed: true })
  })

  it('reports unsandboxed when server sandbox support is disabled', async () => {
    const service = createService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    setSessionSandboxed(db, 'ses_root', true)

    await expect(service.resolveShellTarget('ses_root')).resolves.toEqual({ sandboxed: false })
  })

  it('reports the stored sandbox flag', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', false)
    const service = createService(db, createFakeSessionPermissionClient(), settingsService)

    await expect(service.resolveShellTarget('ses_root')).resolves.toEqual({ sandboxed: false })
  })

  it('resolves the root sandboxed state for a child session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sandbox: { enabled: true } })
    setSessionSandboxed(db, 'ses_root', false)
    const service = createService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } }),
      settingsService,
    )

    await expect(service.resolveShellTarget('ses_child')).resolves.toEqual({ sandboxed: false })
  })
})
