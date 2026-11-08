import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import webpush from 'web-push'
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo } from '../../src/db/queries'
import { NotificationService, type NotificationServerRegistry } from '../../src/services/notification'
import { ExpoPushService, type ExpoPushClient } from '../../src/services/expo-push'
import { SettingsService } from '../../src/services/settings'
import { sseAggregator, type SSEEvent } from '../../src/services/sse-aggregator'
import { logger } from '../../src/utils/logger'
import { ensureAuthSessionTable, insertAuthSession } from '../helpers/auth-sessions'
import type { NotificationPreferences, PushNotificationPayload } from '@opencode-manager/shared/types'
import type { GoalState } from '@opencode-manager/shared/opencode'
import type { SessionGoalOutcome } from '../../src/services/goal-outcomes'

const DIRECTORY = '/abs/repo'
const USER_ID = 'user-1'
const EXPO_TOKEN = 'ExponentPushToken[test-device]'
const SERVER_ID = 'srv_a'

let openDatabases: Database[] = []

function freshDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  openDatabases.push(db)
  return db
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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

function idleEvent(sessionID: string): SSEEvent {
  return {
    id: 'evt_idle_1',
    created: 1700000000000,
    type: 'session.idle',
    location: { directory: DIRECTORY },
    data: { sessionID },
  } as SSEEvent
}

function pushPayload(): PushNotificationPayload {
  return {
    title: 'Title',
    body: 'Body',
    data: { eventType: 'permission.asked', url: '/repos/1/sessions/ses_perm' },
  }
}

interface HarnessOptions {
  expoToken?: string | null
  webPushSubscription?: boolean
  vapidConfigured?: boolean
  registry?: NotificationServerRegistry | null
  tickets?: (messages: ExpoPushMessage[]) => ExpoPushTicket[]
  notificationEvents?: Partial<NotificationPreferences['events']>
}

function createHarness(options: HarnessOptions = {}) {
  const db = freshDb()
  createRepo(db, {
    localPath: 'repo-one',
    sourcePath: DIRECTORY,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })

  const sendPushNotificationsAsync = vi.fn(
    async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
      options.tickets
        ? options.tickets(messages)
        : messages.map((_, index): ExpoPushTicket => ({ status: 'ok', id: `receipt-${index}` })),
  )

  const client: ExpoPushClient = {
    chunkPushNotifications: (messages) => chunkItems(messages, 100),
    chunkPushNotificationReceiptIds: (receiptIds) => chunkItems(receiptIds, 1000),
    sendPushNotificationsAsync,
    getPushNotificationReceiptsAsync: async () => ({}),
  }

  const expo = new ExpoPushService(db, client, () => 1_000)
  const service = new NotificationService(db, options.registry ?? null, expo)

  if (options.vapidConfigured) {
    vi.spyOn(service, 'isConfigured').mockReturnValue(true)
  }
  if (options.webPushSubscription) {
    service.saveSubscription(USER_ID, 'https://push.example.com/sub-1', 'p256dh-key', 'auth-key')
  }

  const expoToken = options.expoToken === undefined ? EXPO_TOKEN : options.expoToken
  if (expoToken) {
    service.saveExpoToken(USER_ID, expoToken)
  }

  new SettingsService(db).updateSettings(
    {
      notifications: {
        enabled: true,
        events: {
          permissionAsked: true,
          questionAsked: true,
          sessionError: true,
          sessionIdle: true,
          ...options.notificationEvents,
        },
      },
    },
    USER_ID,
  )

  return { db, service, sendPushNotificationsAsync, expoToken }
}

function sentMessages(sendPushNotificationsAsync: ReturnType<typeof vi.fn>): ExpoPushMessage[] {
  return (sendPushNotificationsAsync.mock.calls[0]?.[0] as ExpoPushMessage[] | undefined) ?? []
}

beforeEach(() => {
  sseAggregator.shutdown()
})

afterEach(() => {
  for (const db of openDatabases) db.close()
  openDatabases = []
  vi.restoreAllMocks()
})

describe('NotificationService Expo delivery', () => {
  it('delivers a local permission to an Expo-only user without VAPID configured', async () => {
    const { service, sendPushNotificationsAsync, expoToken } = createHarness()
    const webPushSend = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} })

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_perm'))

    expect(webPushSend).not.toHaveBeenCalled()
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const messages = sentMessages(sendPushNotificationsAsync)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      to: expoToken,
      title: 'Run Command',
      data: { eventType: 'permission.asked', url: '/repos/1/sessions/ses_perm' },
    })
  })

  it('delivers a remote server event to Expo without VAPID configured', async () => {
    const registry: NotificationServerRegistry = {
      get: (serverId) => (serverId === SERVER_ID ? { name: 'Studio', enabled: true } : null),
    }
    const { service, sendPushNotificationsAsync, expoToken } = createHarness({ registry })
    const webPushSend = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} })

    await service.handleSSEEvent(DIRECTORY, permissionAskedEvent('ses_remote'), SERVER_ID)

    expect(webPushSend).not.toHaveBeenCalled()
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const messages = sentMessages(sendPushNotificationsAsync)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      to: expoToken,
      data: { serverId: SERVER_ID, url: '/servers/srv_a/sessions/ses_remote' },
    })
  })

  it('sends to both Web Push and Expo when both are registered', async () => {
    const { service, sendPushNotificationsAsync } = createHarness({
      webPushSubscription: true,
      vapidConfigured: true,
    })
    const webPushSend = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} })

    const result = await service.sendToUser(USER_ID, pushPayload())

    expect(webPushSend).toHaveBeenCalledTimes(1)
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ delivered: 2, expired: 0, failed: 0, total: 2 })
  })

  it('keeps filtering Expo delivery by notification preferences', async () => {
    const { service, sendPushNotificationsAsync } = createHarness({
      notificationEvents: { sessionIdle: false },
    })

    await service.handleSSEEvent(DIRECTORY, idleEvent('ses_idle'))

    expect(sendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('refuses to register a token for an expired auth session', () => {
    const { db, service } = createHarness({ expoToken: null })
    ensureAuthSessionTable(db)
    insertAuthSession(db, 'ses_expired', { expiresAt: Date.now() - 1_000 })

    const saved = service.saveExpoToken(USER_ID, EXPO_TOKEN, 'Phone', 'ses_expired')

    expect(saved).toBeNull()
    expect(service.getExpoTokens(USER_ID)).toEqual([])
  })

  it('prunes a token that Expo reports as DeviceNotRegistered', async () => {
    const { service, sendPushNotificationsAsync } = createHarness({
      tickets: (messages) =>
        messages.map(
          (): ExpoPushTicket => ({
            status: 'error',
            message: 'Device not registered',
            details: { error: 'DeviceNotRegistered' },
          }),
        ),
    })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    const result = await service.sendToUser(USER_ID, pushPayload())

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ delivered: 0, expired: 1, failed: 0, total: 1 })
    expect(service.getExpoTokens(USER_ID)).toEqual([])
  })

  it('delivers a goal outcome to an Expo-only user without VAPID configured', async () => {
    const goal: GoalState = {
      id: 'goal_1',
      objective: 'Ship the feature',
      status: 'complete',
      reason: 'Objective achieved',
      rounds: 1,
      maxRounds: 5,
      boot: 'boot-1',
      updatedAt: 3,
    }
    const outcome: SessionGoalOutcome = {
      serverId: 'local',
      sessionId: 'ses_goal',
      directory: DIRECTORY,
      goal,
    }
    const { service, sendPushNotificationsAsync, expoToken } = createHarness()

    await service.notifyGoalOutcome(outcome)

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const messages = sentMessages(sendPushNotificationsAsync)
    expect(messages).toHaveLength(1)
    const [message] = messages
    expect(message?.to).toBe(expoToken)
    expect(message?.data?.eventType).toBe('session.goal.outcome')
    expect(message?.body).toContain('Ship the feature')
    expect(message?.data?.url).toBe('/repos/1/sessions/ses_goal')
  })
})
