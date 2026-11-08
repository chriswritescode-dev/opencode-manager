import type { Database } from 'bun:sqlite'
import Expo, { type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'
import { NotificationEventType } from '@opencode-manager/shared/schemas'
import { logger } from '../utils/logger'
import {
  deleteExpoPushReceipts,
  deleteExpoPushReceiptsCreatedBefore,
  deleteExpoPushTokensByValue,
  insertExpoPushReceipts,
  listDueExpoPushReceipts,
  markExpoPushTokensUsed,
  type ExpoPushReceiptInput,
} from '../db/expo-push-tokens'

export type ExpoPushClient = Pick<
  Expo,
  | 'chunkPushNotifications'
  | 'sendPushNotificationsAsync'
  | 'chunkPushNotificationReceiptIds'
  | 'getPushNotificationReceiptsAsync'
>

export const EXPO_RECEIPT_DELAY_MS = 15 * 60_000
export const EXPO_RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000
export const EXPO_RECEIPT_SWEEP_INTERVAL_MS = 5 * 60_000

const LOGGED_TOKEN_LENGTH = 30

/** Builds the Expo wire message for one device token. */
export function buildExpoPushMessage(token: string, payload: PushNotificationPayload): ExpoPushMessage {
  const data = payload.data
  const needsImmediateAttention =
    data?.eventType === NotificationEventType.PERMISSION_ASKED ||
    data?.eventType === NotificationEventType.FORM_CREATED ||
    data?.priority === 'high'

  return {
    to: token,
    title: payload.title,
    body: payload.body,
    data: data ?? {},
    sound: 'default',
    channelId: 'default',
    ...(needsImmediateAttention
      ? { priority: 'high', interruptionLevel: 'time-sensitive' }
      : { priority: 'default' }),
  }
}

/** Sends Expo push notifications and prunes tokens and receipts reported as undeliverable. */
export class ExpoPushService {
  constructor(
    private db: Database,
    private client: ExpoPushClient = new Expo(),
    private now: () => number = Date.now,
  ) {}

  async send(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<{ delivered: number; expired: number; failed: number }> {
    if (tokens.length === 0) return { delivered: 0, expired: 0, failed: 0 }

    const chunks = this.client.chunkPushNotifications(
      tokens.map((token) => buildExpoPushMessage(token, payload)),
    )
    const receipts: ExpoPushReceiptInput[] = []
    const expiredTokens: string[] = []
    const deliveredTokens: string[] = []
    let delivered = 0
    let expired = 0
    let failed = 0

    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[]
      try {
        tickets = await this.client.sendPushNotificationsAsync(chunk)
      } catch (error) {
        failed += chunk.length
        logger.error('Expo push chunk failed:', error)
        continue
      }

      chunk.forEach((message, index) => {
        const token = typeof message.to === 'string' ? message.to : ''
        const ticket = tickets[index]
        if (!ticket) {
          failed++
          logger.error(`Expo push ticket missing for ${token.slice(0, LOGGED_TOKEN_LENGTH)}`)
          return
        }
        if (ticket.status === 'ok') {
          delivered++
          deliveredTokens.push(token)
          receipts.push({
            receiptId: ticket.id,
            token,
            checkAfter: this.now() + EXPO_RECEIPT_DELAY_MS,
          })
          return
        }
        if (ticket.details?.error === 'DeviceNotRegistered') {
          expired++
          expiredTokens.push(token)
          return
        }
        failed++
        logger.error(`Expo push failed for ${token.slice(0, LOGGED_TOKEN_LENGTH)}:`, ticket.message)
      })
    }

    this.db.transaction(() => {
      insertExpoPushReceipts(this.db, receipts, this.now())
      deleteExpoPushTokensByValue(this.db, expiredTokens)
      markExpoPushTokensUsed(this.db, deliveredTokens, this.now())
    })()

    return { delivered, expired, failed }
  }

  /** Checks receipts that are due and reports how many were checked and how many tokens were pruned. */
  async checkDueReceipts(): Promise<{ checked: number; pruned: number }> {
    const due = listDueExpoPushReceipts(this.db, this.now(), 1000)
    if (due.length === 0) return { checked: 0, pruned: 0 }

    const tokenByReceiptId = new Map(due.map((row) => [row.receiptId, row.token]))
    const chunks = this.client.chunkPushNotificationReceiptIds(due.map((row) => row.receiptId))
    const expiredTokens: string[] = []
    let checked = 0

    for (const chunk of chunks) {
      let receipts: Record<string, ExpoPushReceipt>
      try {
        receipts = await this.client.getPushNotificationReceiptsAsync(chunk)
      } catch (error) {
        logger.error('Expo receipt chunk failed:', error)
        continue
      }

      for (const receiptId of chunk) {
        const receipt = receipts[receiptId]
        if (receipt?.status !== 'error' || receipt.details?.error !== 'DeviceNotRegistered') continue
        const token = tokenByReceiptId.get(receiptId)
        if (token) expiredTokens.push(token)
      }

      const answered = chunk.filter((receiptId) => receipts[receiptId] !== undefined)
      deleteExpoPushReceipts(this.db, answered)
      checked += answered.length
    }

    const pruned = deleteExpoPushTokensByValue(this.db, expiredTokens)
    deleteExpoPushReceiptsCreatedBefore(this.db, this.now() - EXPO_RECEIPT_MAX_AGE_MS)

    return { checked, pruned }
  }

  /** Starts the periodic receipt sweep and returns the function that stops it. */
  startReceiptSweep(intervalMs = EXPO_RECEIPT_SWEEP_INTERVAL_MS): () => void {
    const timer = setInterval(() => {
      void this.checkDueReceipts().catch((error: unknown) => {
        logger.error('Expo receipt sweep failed:', error)
      })
    }, intervalMs)
    timer.unref?.()
    return () => clearInterval(timer)
  }
}
