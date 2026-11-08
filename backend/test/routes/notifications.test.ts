import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { createNotificationRoutes } from '../../src/routes/notifications'
import { NotificationService } from '../../src/services/notification'
import { ExpoPushService, type ExpoPushClient } from '../../src/services/expo-push'
import type { Session } from '../../src/auth'
import { ensureAuthSessionTable, insertAuthSession } from '../helpers/auth-sessions'

interface NotificationServiceStub {
  getVapidPublicKey: ReturnType<typeof vi.fn>
  saveSubscription: ReturnType<typeof vi.fn>
  removeSubscription: ReturnType<typeof vi.fn>
  getSubscriptions: ReturnType<typeof vi.fn>
  removeSubscriptionById: ReturnType<typeof vi.fn>
  saveExpoToken: ReturnType<typeof vi.fn>
  removeExpoToken: ReturnType<typeof vi.fn>
  countReachableDevices: ReturnType<typeof vi.fn>
  sendTestNotification: ReturnType<typeof vi.fn>
}

function sessionScopedApp(service: NotificationService, sessionId: string) {
  const sessionApp = new Hono<{ Variables: { session?: Session['session'] } }>()
  sessionApp.use('*', async (c, next) => {
    c.set('session', { id: sessionId } as Session['session'])
    await next()
  })
  sessionApp.route('/', createNotificationRoutes(service))
  return sessionApp
}

function subscriptionBody(endpoint: string, deviceName?: string): string {
  return JSON.stringify({
    endpoint,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    ...(deviceName ? { deviceName } : {}),
  })
}

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

describe('Notification Routes', () => {
  let service: NotificationServiceStub
  let app: ReturnType<typeof createNotificationRoutes>

  beforeEach(() => {
    vi.clearAllMocks()
    service = {
      getVapidPublicKey: vi.fn(),
      saveSubscription: vi.fn(),
      removeSubscription: vi.fn(),
      getSubscriptions: vi.fn(),
      removeSubscriptionById: vi.fn(),
      saveExpoToken: vi.fn(),
      removeExpoToken: vi.fn(),
      countReachableDevices: vi.fn(),
      sendTestNotification: vi.fn(),
    }
    app = createNotificationRoutes(service as unknown as NotificationService)
  })

  describe('GET /vapid-public-key', () => {
    it('returns the public key when configured', async () => {
      service.getVapidPublicKey.mockReturnValue('public-key')

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ publicKey: 'public-key' })
    })

    it('returns 503 when push notifications are not configured', async () => {
      service.getVapidPublicKey.mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: 'Push notifications are not configured' })
    })
  })

  describe('POST /subscribe', () => {
    it('saves a subscription with the default userId', async () => {
      const subscription = {
        id: 1,
        userId: 'default',
        endpoint: 'https://push.example.com/abc',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        deviceName: 'Phone',
        createdAt: 1,
        lastUsedAt: null,
      }
      service.saveSubscription.mockReturnValue(subscription)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          deviceName: 'Phone',
        }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscription })
      expect(service.saveSubscription).toHaveBeenCalledWith(
        'default',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        'Phone',
        undefined,
      )
    })

    it('saves a subscription with an overridden userId', async () => {
      const subscription = { id: 2 }
      service.saveSubscription.mockReturnValue(subscription)

      const res = await app.fetch(new Request('http://localhost/subscribe?userId=user-9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscription })
      expect(service.saveSubscription).toHaveBeenCalledWith(
        'user-9',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        undefined,
        undefined,
      )
    })

    it('saves the session of the device that subscribed', async () => {
      service.saveSubscription.mockReturnValue({ id: 3 })

      const sessionApp = sessionScopedApp(service as unknown as NotificationService, 'ses_phone')

      const res = await sessionApp.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          deviceName: 'Phone',
        }),
      }))

      expect(res.status).toBe(200)
      expect(service.saveSubscription).toHaveBeenCalledWith(
        'default',
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        'Phone',
        'ses_phone',
      )
    })

    it('returns 401 when the registering session is no longer valid', async () => {
      service.saveSubscription.mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      }))

      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Session is no longer valid' })
    })

    it('updates the stored session id and keeps the device name when the same endpoint subscribes again without one', async () => {
      const db = new Database(':memory:')
      ensureAuthSessionTable(db)
      const service = new NotificationService(db)
      const endpoint = 'https://push.example.com/phone'

      try {
        const subscribes: Array<[sessionId: string, deviceName: string | undefined]> = [
          ['ses_old', 'Phone'],
          ['ses_new', undefined],
        ]

        for (const [sessionId, deviceName] of subscribes) {
          insertAuthSession(db, sessionId)
          const sessionApp = sessionScopedApp(service, sessionId)

          const res = await sessionApp.fetch(new Request('http://localhost/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: subscriptionBody(endpoint, deviceName),
          }))
          expect(res.status).toBe(200)
        }

        const rows = db
          .prepare('SELECT session_id, device_name FROM push_subscriptions WHERE endpoint = ?')
          .all(endpoint)
        expect(rows).toEqual([{ session_id: 'ses_new', device_name: 'Phone' }])
      } finally {
        db.close()
      }
    })

    it('keeps the newer session registration when a revoked session saves afterwards', async () => {
      const db = new Database(':memory:')
      ensureAuthSessionTable(db)
      const service = new NotificationService(db)
      const endpoint = 'https://push.example.com/phone'

      try {
        insertAuthSession(db, 'ses_new')
        const newSessionApp = sessionScopedApp(service, 'ses_new')
        const newSessionRes = await newSessionApp.fetch(new Request('http://localhost/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: subscriptionBody(endpoint),
        }))
        expect(newSessionRes.status).toBe(200)

        const staleSessionApp = sessionScopedApp(service, 'ses_old')
        const staleSessionRes = await staleSessionApp.fetch(new Request('http://localhost/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: subscriptionBody(endpoint),
        }))

        expect(staleSessionRes.status).toBe(401)
        const rows = db
          .prepare('SELECT session_id FROM push_subscriptions WHERE endpoint = ?')
          .all(endpoint)
        expect(rows).toEqual([{ session_id: 'ses_new' }])
      } finally {
        db.close()
      }
    })

    it('returns 400 for invalid subscription data', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url', keys: {} }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Invalid subscription data')
      expect(service.saveSubscription).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /subscribe', () => {
    it('removes a subscription with the default userId', async () => {
      service.removeSubscription.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/abc' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(service.removeSubscription).toHaveBeenCalledWith('https://push.example.com/abc', 'default')
    })

    it('returns 400 for an invalid endpoint', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Valid endpoint URL is required')
      expect(service.removeSubscription).not.toHaveBeenCalled()
    })
  })

  describe('POST /expo-tokens', () => {
    it('saves an Expo token with the default userId', async () => {
      const record = {
        id: 1,
        userId: 'default',
        token: 'ExponentPushToken[x]',
        deviceName: 'Phone',
        createdAt: 1,
        lastUsedAt: null,
      }
      service.saveExpoToken.mockReturnValue(record)

      const res = await app.fetch(new Request('http://localhost/expo-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ExponentPushToken[x]', deviceName: 'Phone' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ token: record })
      expect(service.saveExpoToken).toHaveBeenCalledWith(
        'default',
        'ExponentPushToken[x]',
        'Phone',
        undefined,
      )
    })

    it('saves an Expo token for an overridden userId and the reporting session', async () => {
      const record = { id: 2 }
      service.saveExpoToken.mockReturnValue(record)

      const sessionApp = sessionScopedApp(service as unknown as NotificationService, 'ses_phone')

      const res = await sessionApp.fetch(new Request('http://localhost/expo-tokens?userId=user-9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ExponentPushToken[x]' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ token: record })
      expect(service.saveExpoToken).toHaveBeenCalledWith(
        'user-9',
        'ExponentPushToken[x]',
        undefined,
        'ses_phone',
      )
    })

    it('returns 400 for a malformed Expo token', async () => {
      const res = await app.fetch(new Request('http://localhost/expo-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-token' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Invalid Expo push token')
      expect(service.saveExpoToken).not.toHaveBeenCalled()
    })

    it('returns 401 when the registering session is no longer valid', async () => {
      service.saveExpoToken.mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/expo-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ExponentPushToken[x]' }),
      }))

      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Session is no longer valid' })
    })
  })

  describe('DELETE /expo-tokens', () => {
    it('removes an Expo token with the default userId', async () => {
      service.removeExpoToken.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/expo-tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ExponentPushToken[x]' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(service.removeExpoToken).toHaveBeenCalledWith('ExponentPushToken[x]', 'default')
    })

    it('returns 400 for an empty Expo token', async () => {
      const res = await app.fetch(new Request('http://localhost/expo-tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Expo push token is required')
      expect(service.removeExpoToken).not.toHaveBeenCalled()
    })
  })

  describe('GET /subscriptions', () => {
    it('lists subscriptions for the requested user', async () => {
      const subscriptions = [{ id: 1 }, { id: 2 }]
      service.getSubscriptions.mockReturnValue(subscriptions)

      const res = await app.fetch(new Request('http://localhost/subscriptions?userId=user-9'))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscriptions })
      expect(service.getSubscriptions).toHaveBeenCalledWith('user-9')
    })
  })

  describe('DELETE /subscriptions/:id', () => {
    it('removes a subscription by numeric id', async () => {
      service.removeSubscriptionById.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/subscriptions/12?userId=user-9', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(service.removeSubscriptionById).toHaveBeenCalledWith(12, 'user-9')
    })

    it('returns 400 for a non-numeric id', async () => {
      const res = await app.fetch(new Request('http://localhost/subscriptions/abc', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'Invalid subscription ID' })
      expect(service.removeSubscriptionById).not.toHaveBeenCalled()
    })
  })

  describe('POST /test', () => {
    it('returns 404 when the user has no registered devices', async () => {
      service.getSubscriptions.mockReturnValue([])
      service.countReachableDevices.mockReturnValue({ webPush: 0, expo: 0 })

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'No push subscriptions registered' })
      expect(service.sendTestNotification).not.toHaveBeenCalled()
    })

    it('returns 503 when Web Push rows exist but VAPID is not configured', async () => {
      service.getSubscriptions.mockReturnValue([{ id: 1 }])
      service.countReachableDevices.mockReturnValue({ webPush: 0, expo: 0 })

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: 'Push notifications are not configured' })
      expect(service.sendTestNotification).not.toHaveBeenCalled()
    })

    it('sends a test notification to Web Push devices', async () => {
      service.getSubscriptions.mockReturnValue([{ id: 1 }, { id: 2 }])
      service.countReachableDevices.mockReturnValue({ webPush: 2, expo: 0 })
      service.sendTestNotification.mockResolvedValue({ delivered: 2, expired: 0, failed: 0, total: 2 })

      const res = await app.fetch(new Request('http://localhost/test?userId=user-9', { method: 'POST' }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true, devicesNotified: 2, delivered: 2 })
      expect(service.sendTestNotification).toHaveBeenCalledWith('user-9')
    })

    it('sends a test notification to an Expo-only user', async () => {
      service.getSubscriptions.mockReturnValue([])
      service.countReachableDevices.mockReturnValue({ webPush: 0, expo: 1 })
      service.sendTestNotification.mockResolvedValue({ delivered: 1, expired: 0, failed: 0, total: 1 })

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true, devicesNotified: 1, delivered: 1 })
    })

    it('registers an Expo token and delivers a test notification without VAPID', async () => {
      const db = new Database(':memory:')
      const sendPushNotificationsAsync = vi.fn(
        async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
          messages.map((_, index): ExpoPushTicket => ({ status: 'ok', id: `receipt-${index}` })),
      )
      const service = new NotificationService(
        db,
        null,
        new ExpoPushService(db, fakeExpoClient(sendPushNotificationsAsync)),
      )

      try {
        ensureAuthSessionTable(db)
        insertAuthSession(db, 'ses_phone')

        const sessionApp = sessionScopedApp(service, 'ses_phone')
        const token = 'ExponentPushToken[x]'

        const registerRes = await sessionApp.fetch(new Request('http://localhost/expo-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, deviceName: 'Phone' }),
        }))
        expect(registerRes.status).toBe(200)
        await expect(registerRes.json()).resolves.toEqual({
          token: expect.objectContaining({ userId: 'default', token, deviceName: 'Phone' }),
        })

        const testRes = await sessionApp.fetch(new Request('http://localhost/test', { method: 'POST' }))

        expect(testRes.status).toBe(200)
        await expect(testRes.json()).resolves.toEqual({ success: true, devicesNotified: 1, delivered: 1 })
        expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
        const messages = sendPushNotificationsAsync.mock.calls[0]?.[0] as ExpoPushMessage[]
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({ to: token, title: 'Test Notification' })
      } finally {
        db.close()
      }
    })
  })
})
