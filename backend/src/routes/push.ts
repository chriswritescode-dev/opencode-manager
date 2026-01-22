import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushNotification,
  initPushTable,
  type PushSubscription,
  type PushPayload,
} from '../services/push'

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

const SendNotificationSchema = z.object({
  title: z.string(),
  body: z.string(),
  tag: z.string().optional(),
  url: z.string().optional(),
  sessionId: z.string().optional(),
  repoId: z.string().optional(),
  requireInteraction: z.boolean().optional(),
})

export function createPushRoutes(db: Database) {
  initPushTable(db)
  
  const app = new Hono()

  app.get('/vapid-public-key', (c) => {
    return c.json({ publicKey: getVapidPublicKey() })
  })

  app.post('/subscribe', async (c) => {
    try {
      const body = await c.req.json()
      const subscription = SubscribeSchema.parse(body) as PushSubscription
      const userId = c.req.query('userId') || 'default'
      
      saveSubscription(db, subscription, userId)
      
      return c.json({ success: true, message: 'Subscription saved' })
    } catch (error) {
      logger.error('Failed to save push subscription:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid subscription data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to save subscription' }, 500)
    }
  })

  app.post('/unsubscribe', async (c) => {
    try {
      const body = await c.req.json()
      const { endpoint } = UnsubscribeSchema.parse(body)
      
      removeSubscription(db, endpoint)
      
      return c.json({ success: true, message: 'Subscription removed' })
    } catch (error) {
      logger.error('Failed to remove push subscription:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to remove subscription' }, 500)
    }
  })

  app.post('/send', async (c) => {
    try {
      const body = await c.req.json()
      const payload = SendNotificationSchema.parse(body) as PushPayload
      const userId = c.req.query('userId')
      
      const result = await sendPushNotification(db, payload, userId)
      
      return c.json({ sent: true, ...result })
    } catch (error) {
      logger.error('Failed to send push notification:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid notification data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to send notification' }, 500)
    }
  })

  app.post('/test', async (c) => {
    try {
      const userId = c.req.query('userId')
      
      const payload: PushPayload = {
        title: 'Test Notification',
        body: 'Push notifications are working!',
        tag: 'test-notification',
      }
      
      const result = await sendPushNotification(db, payload, userId)
      
      if (result.success === 0) {
        return c.json({ 
          sent: false, 
          message: 'No active subscriptions found. Please enable push notifications first.',
          successCount: result.success,
          failedCount: result.failed,
        })
      }
      
      return c.json({ 
        sent: true, 
        message: 'Test notification sent', 
        successCount: result.success, 
        failedCount: result.failed,
      })
    } catch (error) {
      logger.error('Failed to send test notification:', error)
      return c.json({ error: 'Failed to send test notification' }, 500)
    }
  })

  return app
}
