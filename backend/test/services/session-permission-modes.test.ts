import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import { getSessionPermissionMode, setSessionPermissionMode } from '../../src/db/session-permission-modes'
import { SettingsService } from '../../src/services/settings'
import { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import type { SSEEvent } from '../../src/services/sse-aggregator'
import {
  createFakeSessionPermissionClient,
  type FakePendingPermissionRequest,
} from '../helpers/fake-session-permission-client'

const DIRECTORY = '/abs/repo'

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function permissionAskedEvent(sessionID: string, id: string): SSEEvent {
  return {
    id: `evt_${id}`,
    created: Date.now(),
    type: 'permission.asked',
    location: { directory: DIRECTORY },
    data: { id, sessionID, action: 'shell', resources: ['ls'] },
  } as unknown as SSEEvent
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

function sessionDeletedEvent(sessionID: string): SSEEvent {
  return {
    id: `evt_deleted_${sessionID}`,
    created: Date.now(),
    type: 'session.deleted',
    location: { directory: DIRECTORY },
    data: { sessionID },
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

function sessionCreatedWithPermissionsEvent(sessionID: string, permissions: unknown[]): SSEEvent {
  return {
    id: `evt_created_${sessionID}`,
    created: Date.now(),
    type: 'session.created',
    location: { directory: DIRECTORY },
    data: { sessionID, permissions },
  } as unknown as SSEEvent
}

describe('SessionPermissionModeService', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('treats a root session with no stored row as ask', async () => {
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.getEffectiveMode('ses_root')).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      mode: 'ask',
      lockedReason: null,
    })
  })

  it('applies a stored auto root mode to its child and marks it locked to the child', async () => {
    setSessionPermissionMode(db, 'ses_root', 'auto')
    const client = createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await expect(service.getEffectiveMode('ses_child')).resolves.toEqual({
      sessionId: 'ses_child',
      rootSessionId: 'ses_root',
      mode: 'auto',
      lockedReason: 'child',
    })
  })

  it('always reports ask for a schedule-run session even when a mode is stored', async () => {
    createRepo(db, {
      localPath: 'repo-one',
      sourcePath: '/abs/repo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
    const run = createScheduleRun(db, {
      jobId: 1,
      repoId: 1,
      triggerSource: 'schedule',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunMetadata(db, 1, 1, run.id, { sessionId: 'ses_scheduled' })
    setSessionPermissionMode(db, 'ses_scheduled', 'auto')

    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.getEffectiveMode('ses_scheduled')).resolves.toEqual({
      sessionId: 'ses_scheduled',
      rootSessionId: 'ses_scheduled',
      mode: 'ask',
      lockedReason: 'schedule',
    })
  })

  it('rejects setMode for a child session', async () => {
    const client = createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await expect(service.setMode('ses_child', 'auto', '/abs/repo')).rejects.toMatchObject({ status: 400 })
    expect(getSessionPermissionMode(db, 'ses_child')).toBeNull()
    expect(getSessionPermissionMode(db, 'ses_root')).toBeNull()
  })

  it('fails closed to ask when parent resolution fails', async () => {
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient({ failSessionGet: true }), new SettingsService(db))

    await expect(service.getEffectiveMode('ses_root')).resolves.toEqual({
      sessionId: 'ses_root',
      rootSessionId: 'ses_root',
      mode: 'ask',
      lockedReason: null,
    })
  })

  it('reads the default mode from session settings', () => {
    const settingsService = new SettingsService(db)
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), settingsService)

    expect(service.defaultMode()).toBe('ask')

    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    expect(service.defaultMode()).toBe('auto')
  })

  it('stores the default auto mode for a launched session', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), settingsService)

    await service.applyDefaultMode('ses_launched', DIRECTORY)

    expect(getSessionPermissionMode(db, 'ses_launched')).toBe('auto')
  })

  it('stores no mode for a launched session when the default is ask', async () => {
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await service.applyDefaultMode('ses_launched', DIRECTORY)

    expect(getSessionPermissionMode(db, 'ses_launched')).toBeNull()
  })

  it('does not override an existing stored ask when applying the default auto mode', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    setSessionPermissionMode(db, 'ses_launched', 'ask')
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), settingsService)

    await service.applyDefaultMode('ses_launched', DIRECTORY)

    expect(getSessionPermissionMode(db, 'ses_launched')).toBe('ask')
  })

  it('accepts a pending request raised before the launched session mode was recorded', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const client = createFakeSessionPermissionClient({
      parents: { ses_launched: null },
      pendingRequests: { [DIRECTORY]: [{ id: 'perm-launched', sessionID: 'ses_launched' }] },
    })
    const service = new SessionPermissionModeService(db, client, settingsService)

    await service.applyDefaultMode('ses_launched', DIRECTORY)

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_launched',
      requestID: 'perm-launched',
      decision: 'once',
    })
  })

  it('auto-accepts a permission request for an auto root session', async () => {
    setSessionPermissionMode(db, 'ses_root', 'auto')
    const client = createFakeSessionPermissionClient({ parents: { ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.handleEvent(DIRECTORY, permissionAskedEvent('ses_root', 'perm-1'))

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_root',
      requestID: 'perm-1',
      decision: 'once',
    })
  })

  it('auto-accepts a permission request for a child of an auto root session', async () => {
    setSessionPermissionMode(db, 'ses_root', 'auto')
    const client = createFakeSessionPermissionClient({ parents: { ses_child: 'ses_root', ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.handleEvent(DIRECTORY, permissionAskedEvent('ses_child', 'perm-2'))

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_child',
      requestID: 'perm-2',
      decision: 'once',
    })
  })

  it('leaves an ask session permission request unanswered', async () => {
    const client = createFakeSessionPermissionClient({ parents: { ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.handleEvent(DIRECTORY, permissionAskedEvent('ses_root', 'perm-3'))

    expect(client.replyPermission).not.toHaveBeenCalled()
  })

  it('stamps the default auto mode on a new root session but not on a child', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), settingsService)

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))
    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_child', 'ses_root'))

    expect(getSessionPermissionMode(db, 'ses_root')).toBe('auto')
    expect(getSessionPermissionMode(db, 'ses_child')).toBeNull()
  })

  it('does not stamp a new root session when the default mode is ask', async () => {
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))

    expect(getSessionPermissionMode(db, 'ses_root')).toBeNull()
  })

  it('does not stamp the default auto mode when the created event carries an explicit permissions ruleset', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), settingsService)

    await service.handleEvent(
      DIRECTORY,
      sessionCreatedWithPermissionsEvent('ses_root', [{ permission: 'bash', pattern: '*', action: 'allow' }]),
    )

    expect(getSessionPermissionMode(db, 'ses_root')).toBeNull()
  })

  it('copies an auto source mode onto a forked root session', async () => {
    setSessionPermissionMode(db, 'ses_source', 'auto')
    const service = new SessionPermissionModeService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_source: null } }),
      new SettingsService(db),
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_source'))

    expect(getSessionPermissionMode(db, 'ses_fork')).toBe('auto')
  })

  it('leaves a forked session unstamped when the source is ask', async () => {
    const service = new SessionPermissionModeService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_source: null } }),
      new SettingsService(db),
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_source'))

    expect(getSessionPermissionMode(db, 'ses_fork')).toBeNull()
  })

  it('does not overwrite an explicit pin when copying the source mode onto a fork', async () => {
    setSessionPermissionMode(db, 'ses_source', 'auto')
    setSessionPermissionMode(db, 'ses_fork', 'ask')
    const service = new SessionPermissionModeService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_source: null } }),
      new SettingsService(db),
    )

    await service.handleEvent(DIRECTORY, sessionForkedEvent('ses_fork', 'ses_source'))

    expect(getSessionPermissionMode(db, 'ses_fork')).toBe('ask')
  })

  it('pinAsk overrides a default auto stamp and survives later insert-if-absent events', async () => {
    const settingsService = new SettingsService(db)
    settingsService.updateSettings({ sessionDefaults: { permissionMode: 'auto' } })
    const service = new SessionPermissionModeService(
      db,
      createFakeSessionPermissionClient({ parents: { ses_root: null } }),
      settingsService,
    )

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))
    expect(getSessionPermissionMode(db, 'ses_root')).toBe('auto')

    service.pinAsk('ses_root')
    expect(getSessionPermissionMode(db, 'ses_root')).toBe('ask')

    await service.handleEvent(DIRECTORY, sessionCreatedEvent('ses_root'))
    expect(getSessionPermissionMode(db, 'ses_root')).toBe('ask')
  })

  it('rejects setMode for a schedule-run session with 409', async () => {
    createRepo(db, {
      localPath: 'repo-one',
      sourcePath: '/abs/repo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
    const run = createScheduleRun(db, {
      jobId: 1,
      repoId: 1,
      triggerSource: 'schedule',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunMetadata(db, 1, 1, run.id, { sessionId: 'ses_scheduled' })

    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await expect(service.setMode('ses_scheduled', 'auto', DIRECTORY)).rejects.toMatchObject({ status: 409 })
    expect(getSessionPermissionMode(db, 'ses_scheduled')).toBeNull()
  })

  it('accepts pending requests for active auto sessions and skips ask sessions', async () => {
    setSessionPermissionMode(db, 'ses_auto', 'auto')
    const client = createFakeSessionPermissionClient({
      parents: { ses_auto: null, ses_ask: null },
      directories: { ses_auto: DIRECTORY, ses_ask: DIRECTORY },
      activeSessions: ['ses_auto', 'ses_ask'],
      pendingRequests: {
        [DIRECTORY]: [
          { id: 'perm-auto', sessionID: 'ses_auto' },
          { id: 'perm-ask', sessionID: 'ses_ask' },
        ],
      },
    })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.acceptPendingRequestsForActiveSessions()

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_auto',
      requestID: 'perm-auto',
      decision: 'once',
    })
  })

  it('accepts a pending request for a child of an active auto root', async () => {
    setSessionPermissionMode(db, 'ses_root', 'auto')
    const client = createFakeSessionPermissionClient({
      parents: { ses_root: null, ses_child: 'ses_root' },
      directories: { ses_child: DIRECTORY },
      activeSessions: ['ses_child'],
      pendingRequests: { [DIRECTORY]: [{ id: 'perm-child', sessionID: 'ses_child' }] },
    })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.acceptPendingRequestsForActiveSessions()

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_child',
      requestID: 'perm-child',
      decision: 'once',
    })
  })

  it('clears the stored mode when the session is deleted', async () => {
    setSessionPermissionMode(db, 'ses_root', 'auto')
    const service = new SessionPermissionModeService(db, createFakeSessionPermissionClient(), new SettingsService(db))

    await service.handleEvent(DIRECTORY, sessionDeletedEvent('ses_root'))

    expect(getSessionPermissionMode(db, 'ses_root')).toBeNull()
  })

  it('replies to pending requests for the switched root only', async () => {
    const client = createFakeSessionPermissionClient({
      parents: { ses_root: null, ses_other: null },
      pendingRequests: {
        [DIRECTORY]: [
          { id: 'perm-root', sessionID: 'ses_root' },
          { id: 'perm-other', sessionID: 'ses_other' },
        ],
      },
    })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.setMode('ses_root', 'auto', DIRECTORY)

    expect(client.replyPermission).toHaveBeenCalledTimes(1)
    expect(client.replyPermission).toHaveBeenCalledWith({
      sessionID: 'ses_root',
      requestID: 'perm-root',
      decision: 'once',
    })
  })

  it('does not approve pending requests when the root switches to ask while the listing is in flight', async () => {
    const listDeferred = createDeferred<FakePendingPermissionRequest[]>()
    const listStarted = createDeferred<void>()
    const client = createFakeSessionPermissionClient({
      parents: { ses_root: null },
      listRequests: () => {
        listStarted.resolve()
        return listDeferred.promise
      },
    })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    const autoSwitch = service.setMode('ses_root', 'auto', DIRECTORY)
    await listStarted.promise
    await service.setMode('ses_root', 'ask', DIRECTORY)
    listDeferred.resolve([{ id: 'perm-root', sessionID: 'ses_root' }])
    await autoSwitch

    expect(getSessionPermissionMode(db, 'ses_root')).toBe('ask')
    expect(client.replyPermission).not.toHaveBeenCalled()
  })

  it('does not approve a pending child request when the root switches to ask while child resolution is in flight', async () => {
    const childDeferred = createDeferred<{ parentID?: string }>()
    const childResolutionStarted = createDeferred<void>()
    const client = createFakeSessionPermissionClient({
      parents: { ses_root: null },
      pendingRequests: { [DIRECTORY]: [{ id: 'perm-child', sessionID: 'ses_child' }] },
      getSession: (sessionID) => {
        if (sessionID === 'ses_child') {
          childResolutionStarted.resolve()
          return childDeferred.promise
        }
        return Promise.resolve({ parentID: null })
      },
    })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    const autoSwitch = service.setMode('ses_root', 'auto', DIRECTORY)
    await childResolutionStarted.promise
    await service.setMode('ses_root', 'ask', DIRECTORY)
    childDeferred.resolve({ parentID: 'ses_root' })
    await autoSwitch

    expect(getSessionPermissionMode(db, 'ses_root')).toBe('ask')
    expect(client.replyPermission).not.toHaveBeenCalled()
  })

  it('does not list pending requests when switching to ask', async () => {
    const client = createFakeSessionPermissionClient({ parents: { ses_root: null } })
    const service = new SessionPermissionModeService(db, client, new SettingsService(db))

    await service.setMode('ses_root', 'ask', DIRECTORY)

    expect(client.replyPermission).not.toHaveBeenCalled()
  })
})
