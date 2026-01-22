import webpush from 'web-push'
import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEsTZT_8wnxMiqK2r8nwZc23zdrUJzoBsMMe51q2oM4y5S42_agpvOIGrCd7lTVh-UanS-D2SvzXLWW8-U6_IVE'
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'rq6W9J-4vu4svUui3kBK6dzCF-dMzQXofjDUkDlXFaE'
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@opencode.ai'

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export interface PushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface StoredSubscription {
  id: number
  endpoint: string
  keys_p256dh: string
  keys_auth: string
  user_id: string
  created_at: number
}

export function initPushTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'default',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
  `)
  logger.info('Push subscriptions table initialized')
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY
}

export function saveSubscription(db: Database, subscription: PushSubscription, userId: string = 'default'): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_p256dh, keys_auth, user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userId, Date.now())
  logger.info('Push subscription saved', { endpoint: subscription.endpoint.slice(0, 50) })
}

export function removeSubscription(db: Database, endpoint: string): void {
  const stmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
  stmt.run(endpoint)
  logger.info('Push subscription removed', { endpoint: endpoint.slice(0, 50) })
}

export function getAllSubscriptions(db: Database, userId?: string): StoredSubscription[] {
  if (userId) {
    const stmt = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?')
    return stmt.all(userId) as StoredSubscription[]
  }
  const stmt = db.prepare('SELECT * FROM push_subscriptions')
  return stmt.all() as StoredSubscription[]
}

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
  sessionId?: string
  repoId?: string
  requireInteraction?: boolean
}

export async function sendPushNotification(
  db: Database,
  payload: PushPayload,
  userId?: string
): Promise<{ success: number; failed: number }> {
  const subscriptions = getAllSubscriptions(db, userId)
  let success = 0
  let failed = 0

  const payloadStr = JSON.stringify(payload)

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.keys_p256dh,
        auth: sub.keys_auth,
      },
    }

    try {
      await webpush.sendNotification(pushSubscription, payloadStr)
      success++
      logger.debug('Push notification sent', { endpoint: sub.endpoint.slice(0, 50) })
    } catch (error: unknown) {
      failed++
      const err = error as { statusCode?: number }
      if (err.statusCode === 410 || err.statusCode === 404) {
        removeSubscription(db, sub.endpoint)
        logger.info('Removed expired subscription', { endpoint: sub.endpoint.slice(0, 50) })
      } else {
        logger.error('Failed to send push notification', { error, endpoint: sub.endpoint.slice(0, 50) })
      }
    }
  }

  logger.info('Push notifications sent', { success, failed, total: subscriptions.length })
  return { success, failed }
}

export async function sendSessionCompleteNotification(
  db: Database,
  sessionId: string,
  repoId?: string,
  sessionTitle?: string
): Promise<void> {
  const payload: PushPayload = {
    title: 'Session Complete',
    body: sessionTitle ? `"${sessionTitle}" has finished` : 'Your OpenCode session has finished',
    tag: `session-complete-${sessionId}`,
    sessionId,
    repoId,
    url: repoId ? `/repos/${repoId}/sessions/${sessionId}` : '/',
  }

  await sendPushNotification(db, payload)
}

export async function sendPermissionRequestNotification(
  db: Database,
  sessionId: string,
  toolName: string,
  repoId?: string
): Promise<void> {
  const payload: PushPayload = {
    title: 'Permission Required',
    body: `${toolName} requires your approval`,
    tag: `permission-${sessionId}`,
    sessionId,
    repoId,
    url: repoId ? `/repos/${repoId}/sessions/${sessionId}` : '/',
    requireInteraction: true,
  }

  await sendPushNotification(db, payload)
}
