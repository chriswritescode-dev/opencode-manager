import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import webpush from 'web-push'
import { PushSubscriptionRecordSchema } from '@opencode-manager/shared/schemas'
import { createNotificationRoutes, type NotificationRoutesService } from '../../src/routes/notifications'
import { NotificationService } from '../../src/services/notification'
import type { Session } from '../../src/auth'
import { selectRow, selectRows } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'
import { ensureAuthSessionTable, insertAuthSession } from '../helpers/auth-sessions'

const ENDPOINT = 'https://push.example.com/abc'

const SubscriptionResponseSchema = z.object({ subscription: PushSubscriptionRecordSchema })
const SubscriptionsResponseSchema = z.object({ subscriptions: z.array(PushSubscriptionRecordSchema) })
const SuccessResponseSchema = z.object({ success: z.boolean() })
const ErrorResponseSchema = z.object({ error: z.string() })
const TestNotificationResponseSchema = z.object({ success: z.boolean(), devicesNotified: z.number() })

const StoredSubscriptionSchema = z.object({
  userId: z.string(),
  sessionId: z.string().nullish(),
  deviceName: z.string().nullish(),
})

function createNotificationRoutesService(
  overrides: Partial<NotificationRoutesService> = {},
): NotificationRoutesService {
  return {
    getVapidPublicKey: vi.fn<NotificationRoutesService['getVapidPublicKey']>(() => null),
    saveSubscription: vi.fn<NotificationRoutesService['saveSubscription']>(() => null),
    removeSubscription: vi.fn<NotificationRoutesService['removeSubscription']>(() => false),
    getSubscriptions: vi.fn<NotificationRoutesService['getSubscriptions']>(() => []),
    removeSubscriptionById: vi.fn<NotificationRoutesService['removeSubscriptionById']>(() => false),
    isConfigured: vi.fn<NotificationRoutesService['isConfigured']>(() => false),
    sendTestNotification: vi.fn<NotificationRoutesService['sendTestNotification']>(async () => {}),
    ...overrides,
  }
}

function deviceSession(sessionId: string): Session['session'] {
  const timestamp = new Date()
  return {
    id: sessionId,
    userId: 'default',
    token: `token-${sessionId}`,
    expiresAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function sessionScopedApp(service: NotificationRoutesService, sessionId: string) {
  const sessionApp = new Hono<{ Variables: { session?: Session['session'] } }>()
  sessionApp.use('*', async (c, next) => {
    c.set('session', deviceSession(sessionId))
    await next()
  })
  sessionApp.route('/', createNotificationRoutes(service))
  return sessionApp
}

function subscribeRequest(query = ''): Request {
  return new Request(`http://localhost/subscribe${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      deviceName: 'Phone',
    }),
  })
}

function readStoredSubscription(db: Database): z.infer<typeof StoredSubscriptionSchema> | null {
  return selectRow(
    db,
    StoredSubscriptionSchema,
    'SELECT user_id AS userId, session_id AS sessionId, device_name AS deviceName FROM push_subscriptions WHERE endpoint = ?',
    ENDPOINT,
  )
}

describe('Notification Routes', () => {
  let db: Database
  let service: NotificationService

  beforeEach(() => {
    db = createTestDatabase()
    ensureAuthSessionTable(db)
    service = new NotificationService(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('GET /vapid-public-key', () => {
    it('returns the public key when configured', async () => {
      const keys = webpush.generateVAPIDKeys()
      service.configureVapid({ ...keys, subject: 'mailto:test@example.com' })
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(200)
      expect(await readJson(res, z.object({ publicKey: z.string() }))).toEqual({ publicKey: keys.publicKey })
    })

    it('returns 503 when push notifications are not configured', async () => {
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(503)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Push notifications are not configured' })
    })
  })

  describe('POST /subscribe', () => {
    it.each([
      ['', 'default'],
      ['?userId=user-9', 'user-9'],
    ])('stores a subscription for the requested user (%s)', async (query, expectedUserId) => {
      const app = createNotificationRoutes(service)

      const res = await app.fetch(subscribeRequest(query))

      expect(res.status).toBe(200)
      const body = await readJson(res, SubscriptionResponseSchema)
      expect(body.subscription).toMatchObject({ userId: expectedUserId, endpoint: ENDPOINT, deviceName: 'Phone' })
      expect(readStoredSubscription(db)).toEqual({
        userId: expectedUserId,
        sessionId: null,
        deviceName: 'Phone',
      })
    })

    it('stores the session of the device that subscribed', async () => {
      insertAuthSession(db, 'ses_phone')
      const sessionApp = sessionScopedApp(service, 'ses_phone')

      const res = await sessionApp.fetch(subscribeRequest())

      expect(res.status).toBe(200)
      expect(readStoredSubscription(db)?.sessionId).toBe('ses_phone')
    })

    it('returns 401 and stores nothing when the registering session is no longer valid', async () => {
      const sessionApp = sessionScopedApp(service, 'ses_revoked')

      const res = await sessionApp.fetch(subscribeRequest())

      expect(res.status).toBe(401)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Session is no longer valid' })
      expect(selectRows(db, StoredSubscriptionSchema, 'SELECT user_id AS userId FROM push_subscriptions')).toEqual([])
    })

    it('returns 400 for invalid subscription data', async () => {
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url', keys: {} }),
      }))

      expect(res.status).toBe(400)
      expect(await readJson(res, ErrorResponseSchema)).toMatchObject({ error: 'Invalid subscription data' })
      expect(readStoredSubscription(db)).toBeNull()
    })
  })

  describe('DELETE /subscribe', () => {
    it('removes the stored subscription and reports whether one existed', async () => {
      const app = createNotificationRoutes(service)
      await app.fetch(subscribeRequest())
      const request = new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: ENDPOINT }),
      })

      const res = await app.fetch(request)

      expect(res.status).toBe(200)
      expect(await readJson(res, SuccessResponseSchema)).toEqual({ success: true })
      expect(readStoredSubscription(db)).toBeNull()

      const repeated = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: ENDPOINT }),
      }))
      expect(await readJson(repeated, SuccessResponseSchema)).toEqual({ success: false })
    })

    it('returns 400 for an invalid endpoint', async () => {
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url' }),
      }))

      expect(res.status).toBe(400)
      expect(await readJson(res, ErrorResponseSchema)).toMatchObject({ error: 'Valid endpoint URL is required' })
      expect(service.getSubscriptions('default')).toEqual([])
    })
  })

  describe('GET /subscriptions', () => {
    it('lists subscriptions for the requested user', async () => {
      service.saveSubscription('default', 'https://push.example.com/default', 'p256dh-key', 'auth-key')
      service.saveSubscription('user-9', ENDPOINT, 'p256dh-key', 'auth-key', 'Phone')
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/subscriptions?userId=user-9'))

      expect(res.status).toBe(200)
      const body = await readJson(res, SubscriptionsResponseSchema)
      expect(body.subscriptions.map((subscription) => subscription.endpoint)).toEqual([ENDPOINT])
    })
  })

  describe('DELETE /subscriptions/:id', () => {
    it('removes a subscription by numeric id', async () => {
      const subscription = service.saveSubscription('user-9', ENDPOINT, 'p256dh-key', 'auth-key')
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request(`http://localhost/subscriptions/${subscription?.id}?userId=user-9`, {
        method: 'DELETE',
      }))

      expect(res.status).toBe(200)
      expect(await readJson(res, SuccessResponseSchema)).toEqual({ success: true })
      expect(service.getSubscriptions('user-9')).toEqual([])
    })

    it('returns 400 for a non-numeric id', async () => {
      const app = createNotificationRoutes(service)

      const res = await app.fetch(new Request('http://localhost/subscriptions/abc', { method: 'DELETE' }))

      expect(res.status).toBe(400)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Invalid subscription ID' })
    })
  })

  describe('POST /test', () => {
    it('returns 503 when push notifications are not configured', async () => {
      const app = createNotificationRoutes(createNotificationRoutesService({ isConfigured: () => false }))

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(503)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'Push notifications are not configured' })
    })

    it('returns 404 when the user has no subscriptions', async () => {
      const app = createNotificationRoutes(createNotificationRoutesService({ isConfigured: () => true }))

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(404)
      expect(await readJson(res, ErrorResponseSchema)).toEqual({ error: 'No push subscriptions registered' })
    })

    it('sends a test notification and reports the device count', async () => {
      const sendTestNotification = vi.fn<NotificationRoutesService['sendTestNotification']>(async () => {})
      const app = createNotificationRoutes(createNotificationRoutesService({
        isConfigured: () => true,
        getSubscriptions: () => [
          { id: 1, userId: 'user-9', endpoint: ENDPOINT, p256dh: 'p256dh-key', auth: 'auth-key', deviceName: null, createdAt: 1, lastUsedAt: null },
          { id: 2, userId: 'user-9', endpoint: `${ENDPOINT}-2`, p256dh: 'p256dh-key', auth: 'auth-key', deviceName: null, createdAt: 2, lastUsedAt: null },
        ],
        sendTestNotification,
      }))

      const res = await app.fetch(new Request('http://localhost/test?userId=user-9', { method: 'POST' }))

      expect(res.status).toBe(200)
      expect(await readJson(res, TestNotificationResponseSchema)).toEqual({ success: true, devicesNotified: 2 })
      expect(sendTestNotification).toHaveBeenCalledWith('user-9')
    })
  })
})
