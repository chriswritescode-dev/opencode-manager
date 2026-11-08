import { describe, it, expect, beforeEach, vi } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { NotificationService } from '../../src/services/notification'
import { ExpoPushService, type ExpoPushClient } from '../../src/services/expo-push'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import { createInternalTestApp } from '../helpers/internal-test-app'

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function fakeExpoClient(sendPushNotificationsAsync: ReturnType<typeof vi.fn>): ExpoPushClient {
  return {
    chunkPushNotifications: (messages) => chunkItems(messages, 100),
    chunkPushNotificationReceiptIds: (receiptIds) => chunkItems(receiptIds, 1000),
    sendPushNotificationsAsync,
    getPushNotificationReceiptsAsync: async () => ({}),
  }
}

describe('internal/notifications routes', () => {
  let db: Database
  let notificationService: NotificationService
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    notificationService = new NotificationService(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { notificationService }))
    token = getOrCreateInternalToken(db)
  })

  it('POST /api/internal/notifications/send returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/notifications/send returns 401 with invalid bearer token', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer invalid-token',
      },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/notifications/send returns 200 without devices when VAPID is not configured', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      delivered: 0,
      expired: 0,
      failed: 0,
      noSubscriptions: true,
    })
  })

  it('POST /api/internal/notifications/send delivers to a registered Expo device without VAPID', async () => {
    notificationService.saveExpoToken('default', 'ExponentPushToken[phone]')
    const sendPushNotificationsAsync = vi.fn(
      async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
        messages.map((_, index): ExpoPushTicket => ({ status: 'ok', id: `receipt-${index}` })),
    )
    const expoService = new NotificationService(
      db,
      null,
      new ExpoPushService(db, fakeExpoClient(sendPushNotificationsAsync)),
    )
    const expoApp = new Hono()
    expoApp.route('/api/internal', createInternalTestApp(db, { notificationService: expoService }))

    const res = await expoApp.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { delivered: number; noSubscriptions: boolean }
    expect(body.delivered).toBe(1)
    expect(body.noSubscriptions).toBe(false)
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const messages = sendPushNotificationsAsync.mock.calls[0]?.[0] as ExpoPushMessage[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ to: 'ExponentPushToken[phone]', title: 'Test' })
  })

  it('POST /api/internal/notifications/send returns 400 on invalid body (missing title)', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on title > 120 chars', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'a'.repeat(121), body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on body > 500 chars', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'b'.repeat(501) }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/notifications/send returns 400 on url > 500 chars', async () => {
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body', url: 'u'.repeat(501) }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  describe('notification url', () => {
    const send = (payload: Record<string, unknown>) =>
      app.request('/api/internal/notifications/send', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', body: 'Body', ...payload }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      })

    const sentUrl = (sendToUser: ReturnType<typeof vi.spyOn>) =>
      (sendToUser.mock.calls[0]?.[1] as { data: { url: string } }).data.url

    it('links a scheduled run session to its run report, even when the agent passes a url', async () => {
      db.exec('PRAGMA foreign_keys = OFF')
      const run = createScheduleRun(db, { jobId: 7, repoId: 0, triggerSource: 'schedule', status: 'running', startedAt: 1, createdAt: 1 })
      updateScheduleRunMetadata(db, 0, 7, run.id, { sessionId: 'ses_scheduled' })
      const sendToUser = vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 1, expired: 0, failed: 0, total: 1 })

      const res = await send({ sessionId: 'ses_scheduled', url: '/repos/my-repo' })

      expect(res.status).toBe(200)
      expect(sentUrl(sendToUser)).toBe(`/schedules?scheduleTab=runs&runId=${run.id}`)
    })

    it('keeps the agent url for sessions that are not scheduled runs', async () => {
      const sendToUser = vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 1, expired: 0, failed: 0, total: 1 })

      await send({ sessionId: 'ses_manual', url: '/repos/3' })

      expect(sentUrl(sendToUser)).toBe('/repos/3')
    })
  })

  it('POST /api/internal/notifications/send returns 429 after 10 calls within rate window', async () => {
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const makeRequest = async () => {
      return app.request('/api/internal/notifications/send', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test', body: 'Body' }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
      })
    }

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest()
      expect(res.status).toBe(200)
    }

    const res = await makeRequest()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
