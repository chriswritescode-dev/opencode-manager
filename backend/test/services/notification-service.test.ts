import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { sseAggregator, type SSEEvent } from '../../src/services/sse-aggregator'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'

const DIRECTORY = '/abs/repo'
const USER_ID = 'user-1'

const sendResult = { delivered: 0, expired: 0, failed: 0, total: 0 }

function formCreatedEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_form_1',
    created: 1700000000000,
    type: 'form.created',
    location: { directory: DIRECTORY },
    data: {
      form: {
        id: 'form-1',
        sessionID,
        title: 'Deploy to prod?',
        fields: [{ key: 'confirm', type: 'string' }],
      },
    },
  }
}

function permissionAskedEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_perm_1',
    created: 1700000000000,
    type: 'permission.asked',
    location: { directory: DIRECTORY },
    data: {
      id: 'perm-1',
      sessionID,
      action: 'shell',
      resources: ['ls -la'],
    },
  }
}

function createService(): NotificationService {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  createRepo(db, {
    localPath: 'repo-one',
    sourcePath: DIRECTORY,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })

  const service = new NotificationService(db)
  vi.spyOn(service, 'isConfigured').mockReturnValue(true)
  service.saveSubscription(USER_ID, 'https://push.example.com/sub-1', 'p256dh-key', 'auth-key')
  new SettingsService(db).updateSettings(
    {
      notifications: {
        enabled: true,
        events: { permissionAsked: true, questionAsked: true, sessionError: true, sessionIdle: true },
      },
    },
    USER_ID,
  )
  return service
}

describe('NotificationService.handleSSEEvent session routing', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes a real V2 form.created event to the session carried in data.form', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Question')
    expect(payload.tag).toBe('form.created-ses_form')
    expect(payload.data?.sessionId).toBe('ses_form')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_form')
  })

  it('suppresses a form.created event for a session the user is viewing', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses a form.created event for a subagent session', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSubagentSession').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, formCreatedEvent('ses_form'))

    expect(send).not.toHaveBeenCalled()
  })

  it('keeps permission notifications session-scoped from the top-level sessionID', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.tag).toBe('permission.asked-ses_perm')
    expect(payload.data?.sessionId).toBe('ses_perm')
    expect(payload.data?.url).toBe('/repos/1/sessions/ses_perm')
  })

  it('suppresses a permission for a session the user is viewing', async () => {
    const service = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(send).not.toHaveBeenCalled()
  })
})
