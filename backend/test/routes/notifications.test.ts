import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNotificationRoutes } from '../../src/routes/notifications'
import type { NotificationService } from '../../src/services/notification'

interface NotificationServiceStub {
  getVapidPublicKey: ReturnType<typeof vi.fn>
  saveSubscription: ReturnType<typeof vi.fn>
  removeSubscription: ReturnType<typeof vi.fn>
  getSubscriptions: ReturnType<typeof vi.fn>
  removeSubscriptionById: ReturnType<typeof vi.fn>
  isConfigured: ReturnType<typeof vi.fn>
  sendTestNotification: ReturnType<typeof vi.fn>
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
      isConfigured: vi.fn(),
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
      )
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
    it('returns 503 when push notifications are not configured', async () => {
      service.isConfigured.mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: 'Push notifications are not configured' })
      expect(service.getSubscriptions).not.toHaveBeenCalled()
    })

    it('returns 404 when the user has no subscriptions', async () => {
      service.isConfigured.mockReturnValue(true)
      service.getSubscriptions.mockReturnValue([])

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'No push subscriptions registered' })
      expect(service.sendTestNotification).not.toHaveBeenCalled()
    })

    it('sends a test notification and reports the device count', async () => {
      service.isConfigured.mockReturnValue(true)
      service.getSubscriptions.mockReturnValue([{ id: 1 }, { id: 2 }])
      service.sendTestNotification.mockResolvedValue(undefined)

      const res = await app.fetch(new Request('http://localhost/test?userId=user-9', { method: 'POST' }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true, devicesNotified: 2 })
      expect(service.sendTestNotification).toHaveBeenCalledWith('user-9')
    })
  })
})
