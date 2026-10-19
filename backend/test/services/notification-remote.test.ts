import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { sseAggregator, type SSEEvent } from '../../src/services/sse-aggregator'
import * as repoService from '../../src/services/repo'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'

vi.mock('../../src/services/repo', () => ({
  resolveRepoForDirectory: vi.fn(async () => null),
}))

const USER_ID = 'user-1'
const SERVER_ID = 'srv_a'
const DIRECTORY = '/remote/repo'

const sendResult = { delivered: 0, expired: 0, failed: 0, total: 0 }

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

function createService(server: { name: string; enabled: boolean } | null = { name: 'Studio', enabled: true }) {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  const registry = { get: vi.fn(() => server) }
  const service = new NotificationService(db, registry)
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
  return { service, registry }
}

describe('NotificationService remote server events', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a server session URL with the server name and skips repo resolution', async () => {
    const { service, registry } = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_remote'), SERVER_ID)

    expect(repoService.resolveRepoForDirectory).not.toHaveBeenCalled()
    expect(registry.get).toHaveBeenCalledWith(SERVER_ID)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[1] as PushNotificationPayload
    expect(payload.title).toBe('Run Command')
    expect(payload.body).toBe('Studio · ls -la')
    expect(payload.data?.url).toBe('/servers/srv_a/sessions/ses_remote')
    expect(payload.data?.serverId).toBe(SERVER_ID)
    expect(payload.data?.serverName).toBe('Studio')
    expect(payload.data?.repoId).toBeUndefined()
    expect(payload.data?.repoName).toBeUndefined()
  })

  it('drops events for a disabled server', async () => {
    const { service } = createService({ name: 'Studio', enabled: false })
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_remote'), SERVER_ID)

    expect(send).not.toHaveBeenCalled()
  })

  it('drops events for a deleted server', async () => {
    const { service } = createService(null)
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_remote'), SERVER_ID)

    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses a remote subagent session using the server-scoped check', async () => {
    const { service } = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    const isSubagent = vi.spyOn(sseAggregator, 'isSubagentSession').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_sub'), SERVER_ID)

    expect(isSubagent).toHaveBeenCalledWith('ses_sub', SERVER_ID)
    expect(send).not.toHaveBeenCalled()
  })

  it('suppresses a remote session the user is viewing on that server', async () => {
    const { service } = createService()
    const send = vi.spyOn(service, 'sendToUser').mockResolvedValue(sendResult)
    const viewed = vi.spyOn(sseAggregator, 'isSessionBeingViewed').mockReturnValue(true)

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_remote'), SERVER_ID)

    expect(viewed).toHaveBeenCalledWith('ses_remote', SERVER_ID)
    expect(send).not.toHaveBeenCalled()
  })
})
