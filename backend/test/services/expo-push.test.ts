import { afterEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import Expo, { type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk'
import type { PushNotificationPayload } from '@opencode-manager/shared/types'
import { NotificationEventType } from '@opencode-manager/shared/schemas'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { insertExpoPushReceipts, upsertExpoPushToken } from '../../src/db/expo-push-tokens'
import {
  EXPO_RECEIPT_DELAY_MS,
  EXPO_RECEIPT_MAX_AGE_MS,
  ExpoPushService,
  buildExpoPushMessage,
  type ExpoPushClient,
} from '../../src/services/expo-push'
import { logger } from '../../src/utils/logger'

function freshDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function fakeClient(overrides: Partial<ExpoPushClient> = {}): ExpoPushClient {
  return {
    chunkPushNotifications: (messages) => chunkItems(messages, 100),
    chunkPushNotificationReceiptIds: (receiptIds) => chunkItems(receiptIds, 1000),
    sendPushNotificationsAsync: async (messages) =>
      messages.map((_, index) => ({ status: 'ok', id: `receipt-${index}` })),
    getPushNotificationReceiptsAsync: async () => ({}),
    ...overrides,
  }
}

function payload(overrides: Partial<PushNotificationPayload> = {}): PushNotificationPayload {
  return {
    title: 'Title',
    body: 'Body',
    data: { eventType: NotificationEventType.SESSION_IDLE },
    ...overrides,
  }
}

function registerToken(db: Database, token: string, now = 100): void {
  upsertExpoPushToken(db, { userId: 'user-a', token, now })
}

function countOf(db: Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ExpoPushService.send', () => {
  it('sends one message per token in chunks of at most 100', async () => {
    const db = freshDb()
    const tokens = Array.from({ length: 250 }, (_, index) => `ExpoPushToken[${index}]`)
    let nextReceipt = 1
    const sendPushNotificationsAsync = vi.fn(async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
      messages.map(() => ({ status: 'ok', id: `receipt-${nextReceipt++}` })),
    )
    const service = new ExpoPushService(db, fakeClient({ sendPushNotificationsAsync }), () => 1_000)

    const result = await service.send(tokens, payload())

    expect(result).toEqual({ delivered: 250, expired: 0, failed: 0 })
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(3)
    const chunkSizes = sendPushNotificationsAsync.mock.calls.map((call) => call[0].length)
    expect(chunkSizes).toEqual([100, 100, 50])
    const sentTokens = sendPushNotificationsAsync.mock.calls.flatMap((call) => call[0].map((message) => message.to))
    expect(sentTokens).toEqual(tokens)
    expect(countOf(db, 'expo_push_receipts')).toBe(250)
    db.close()
  })

  it('maps ok, DeviceNotRegistered and other error tickets to delivered, expired and failed', async () => {
    const db = freshDb()
    const okToken = 'ExpoPushToken[ok]'
    const expiredToken = 'ExpoPushToken[expired]'
    const failedToken = 'ExpoPushToken[failed]'
    for (const token of [okToken, expiredToken, failedToken]) registerToken(db, token)

    const client = fakeClient({
      sendPushNotificationsAsync: vi.fn(async (messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> =>
        messages.map((_, index) => {
          if (index === 0) return { status: 'ok', id: 'receipt-ok' }
          if (index === 1) {
            return {
              status: 'error',
              message: 'Device not registered',
              details: { error: 'DeviceNotRegistered' },
            }
          }
          return {
            status: 'error',
            message: 'Rate limited',
            details: { error: 'MessageRateExceeded' },
          }
        }),
      ),
    })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const service = new ExpoPushService(db, client, () => 1_000)

    const result = await service.send([okToken, expiredToken, failedToken], payload())

    expect(result).toEqual({ delivered: 1, expired: 1, failed: 1 })
    expect(db.prepare('SELECT token, last_used_at FROM expo_push_tokens ORDER BY token').all()).toEqual([
      { token: failedToken, last_used_at: 100 },
      { token: okToken, last_used_at: 1_000 },
    ])
    expect(db.prepare('SELECT receipt_id, token, check_after FROM expo_push_receipts').all()).toEqual([
      {
        receipt_id: 'receipt-ok',
        token: okToken,
        check_after: 1_000 + EXPO_RECEIPT_DELAY_MS,
      },
    ])
    db.close()
  })

  it('counts a rejected chunk as failed and still sends the remaining chunks', async () => {
    const db = freshDb()
    const tokens = Array.from({ length: 101 }, (_, index) => `ExpoPushToken[${index}]`)
    const sendPushNotificationsAsync = vi
      .fn<ExpoPushClient['sendPushNotificationsAsync']>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementationOnce(async (messages) => messages.map(() => ({ status: 'ok', id: 'receipt-late' })))
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const service = new ExpoPushService(db, fakeClient({ sendPushNotificationsAsync }), () => 1_000)

    const result = await service.send(tokens, payload())

    expect(result).toEqual({ delivered: 1, expired: 0, failed: 100 })
    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(2)
    expect(countOf(db, 'expo_push_receipts')).toBe(1)
    db.close()
  })
})

describe('ExpoPushService.checkDueReceipts', () => {
  it('checks nothing before the receipt is due', async () => {
    const db = freshDb()
    registerToken(db, 'ExpoPushToken[phone]')
    const send = new ExpoPushService(
      db,
      fakeClient({
        sendPushNotificationsAsync: async () => [{ status: 'ok', id: 'receipt-1' }],
      }),
      () => 1_000,
    )
    await send.send(['ExpoPushToken[phone]'], payload())

    const getReceipts = vi.fn(async (): Promise<Record<string, ExpoPushReceipt>> => ({
      'receipt-1': { status: 'ok' },
    }))
    const beforeDue = new ExpoPushService(
      db,
      fakeClient({ getPushNotificationReceiptsAsync: getReceipts }),
      () => 1_000 + EXPO_RECEIPT_DELAY_MS - 1,
    )

    expect(await beforeDue.checkDueReceipts()).toEqual({ checked: 0, pruned: 0 })
    expect(getReceipts).not.toHaveBeenCalled()
    expect(countOf(db, 'expo_push_receipts')).toBe(1)
    expect(countOf(db, 'expo_push_tokens')).toBe(1)
    db.close()
  })

  it('prunes receipts persisted by an earlier service instance', async () => {
    const db = freshDb()
    registerToken(db, 'ExpoPushToken[phone]')
    const firstInstance = new ExpoPushService(
      db,
      fakeClient({
        sendPushNotificationsAsync: async () => [{ status: 'ok', id: 'receipt-1' }],
      }),
      () => 1_000,
    )
    await firstInstance.send(['ExpoPushToken[phone]'], payload())

    const getReceipts = vi.fn(async (): Promise<Record<string, ExpoPushReceipt>> => ({
      'receipt-1': {
        status: 'error',
        message: 'Device not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    }))
    const secondInstance = new ExpoPushService(
      db,
      fakeClient({ getPushNotificationReceiptsAsync: getReceipts }),
      () => 1_000 + EXPO_RECEIPT_DELAY_MS,
    )

    expect(await secondInstance.checkDueReceipts()).toEqual({ checked: 1, pruned: 1 })
    expect(getReceipts).toHaveBeenCalledTimes(1)
    expect(countOf(db, 'expo_push_tokens')).toBe(0)
    expect(countOf(db, 'expo_push_receipts')).toBe(0)
    db.close()
  })

  it('keeps rejected chunks for the next sweep and drops receipts older than 24 hours', async () => {
    const db = freshDb()
    const now = 1_000
    insertExpoPushReceipts(
      db,
      [{ receiptId: 'receipt-old', token: 'ExpoPushToken[old]', checkAfter: 0 }],
      now - EXPO_RECEIPT_MAX_AGE_MS - 1,
    )
    insertExpoPushReceipts(
      db,
      [{ receiptId: 'receipt-recent', token: 'ExpoPushToken[recent]', checkAfter: 0 }],
      now,
    )
    const getReceipts = vi.fn(async (): Promise<Record<string, ExpoPushReceipt>> => {
      throw new Error('expo unavailable')
    })
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const service = new ExpoPushService(db, fakeClient({ getPushNotificationReceiptsAsync: getReceipts }), () => now)

    expect(await service.checkDueReceipts()).toEqual({ checked: 0, pruned: 0 })
    expect(getReceipts).toHaveBeenCalledTimes(1)
    expect(db.prepare('SELECT receipt_id FROM expo_push_receipts ORDER BY receipt_id').all()).toEqual([
      { receipt_id: 'receipt-recent' },
    ])
    db.close()
  })

  it('keeps a due receipt the response omits and checks it on the next sweep', async () => {
    const db = freshDb()
    const now = 5_000
    insertExpoPushReceipts(
      db,
      [
        { receiptId: 'receipt-answered', token: 'ExpoPushToken[answered]', checkAfter: 0 },
        { receiptId: 'receipt-pending', token: 'ExpoPushToken[pending]', checkAfter: 0 },
      ],
      now,
    )
    const firstSweep = new ExpoPushService(
      db,
      fakeClient({
        getPushNotificationReceiptsAsync: async (): Promise<Record<string, ExpoPushReceipt>> => ({
          'receipt-answered': { status: 'ok' },
        }),
      }),
      () => now,
    )

    expect(await firstSweep.checkDueReceipts()).toEqual({ checked: 1, pruned: 0 })
    expect(db.prepare('SELECT receipt_id FROM expo_push_receipts').all()).toEqual([
      { receipt_id: 'receipt-pending' },
    ])

    registerToken(db, 'ExpoPushToken[pending]', now)
    const getReceipts = vi.fn(async (): Promise<Record<string, ExpoPushReceipt>> => ({
      'receipt-pending': {
        status: 'error',
        message: 'Device not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    }))
    const secondSweep = new ExpoPushService(
      db,
      fakeClient({ getPushNotificationReceiptsAsync: getReceipts }),
      () => now,
    )

    expect(await secondSweep.checkDueReceipts()).toEqual({ checked: 1, pruned: 1 })
    expect(getReceipts).toHaveBeenCalledWith(['receipt-pending'])
    expect(countOf(db, 'expo_push_receipts')).toBe(0)
    expect(countOf(db, 'expo_push_tokens')).toBe(0)
    db.close()
  })

  it('prunes tokens reported as DeviceNotRegistered and deletes checked receipts', async () => {
    const db = freshDb()
    const now = 5_000
    registerToken(db, 'ExpoPushToken[keep]', now)
    registerToken(db, 'ExpoPushToken[gone]', now)
    insertExpoPushReceipts(
      db,
      [
        { receiptId: 'receipt-keep', token: 'ExpoPushToken[keep]', checkAfter: 0 },
        { receiptId: 'receipt-gone', token: 'ExpoPushToken[gone]', checkAfter: 0 },
      ],
      now,
    )
    const service = new ExpoPushService(
      db,
      fakeClient({
        getPushNotificationReceiptsAsync: async (): Promise<Record<string, ExpoPushReceipt>> => ({
          'receipt-keep': { status: 'ok' },
          'receipt-gone': {
            status: 'error',
            message: 'Device not registered',
            details: { error: 'DeviceNotRegistered' },
          },
        }),
      }),
      () => now,
    )

    expect(await service.checkDueReceipts()).toEqual({ checked: 2, pruned: 1 })
    expect(db.prepare('SELECT token FROM expo_push_tokens').all()).toEqual([{ token: 'ExpoPushToken[keep]' }])
    expect(countOf(db, 'expo_push_receipts')).toBe(0)
    db.close()
  })
})

describe('ExpoPushService.startReceiptSweep', () => {
  it('checks receipts on the interval until stopped', async () => {
    vi.useFakeTimers()
    const db = freshDb()
    const service = new ExpoPushService(db, fakeClient(), () => 1_000)
    const checkDueReceipts = vi.spyOn(service, 'checkDueReceipts').mockResolvedValue({ checked: 0, pruned: 0 })

    const stop = service.startReceiptSweep(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(checkDueReceipts).toHaveBeenCalledTimes(1)

    stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(checkDueReceipts).toHaveBeenCalledTimes(1)
    db.close()
  })
})

describe('buildExpoPushMessage', () => {
  it('marks permission and form messages as time sensitive', () => {
    const permission = buildExpoPushMessage('ExpoPushToken[phone]', {
      title: 'Permission',
      body: 'Approve',
      data: { eventType: NotificationEventType.PERMISSION_ASKED },
    })
    const form = buildExpoPushMessage('ExpoPushToken[phone]', {
      title: 'Question',
      body: 'Answer',
      data: { eventType: NotificationEventType.FORM_CREATED },
    })

    expect(permission).toMatchObject({ priority: 'high', interruptionLevel: 'time-sensitive' })
    expect(form).toMatchObject({ priority: 'high', interruptionLevel: 'time-sensitive' })
  })

  it('honours an explicit high priority data flag', () => {
    const message = buildExpoPushMessage('ExpoPushToken[phone]', {
      title: 'Urgent',
      body: 'Look now',
      data: { eventType: 'test', priority: 'high' },
    })

    expect(message).toMatchObject({ priority: 'high', interruptionLevel: 'time-sensitive' })
  })

  it('uses the default channel and default priority for session idle', () => {
    const message = buildExpoPushMessage(
      'ExpoPushToken[phone]',
      payload({
        title: 'Session complete',
        body: 'Done',
        data: { eventType: NotificationEventType.SESSION_IDLE, repoId: 7 },
      }),
    )

    expect(message).toEqual({
      to: 'ExpoPushToken[phone]',
      title: 'Session complete',
      body: 'Done',
      data: { eventType: NotificationEventType.SESSION_IDLE, repoId: 7 },
      sound: 'default',
      channelId: 'default',
      priority: 'default',
    })
  })

  it('defaults missing data to an empty object', () => {
    const message = buildExpoPushMessage('ExpoPushToken[phone]', { title: 'Title', body: 'Body' })

    expect(message.data).toEqual({})
    expect(message.channelId).toBe('default')
  })
})

describe('ExpoPushService with the real Expo client', () => {
  it('posts the messages to the Expo send endpoint without an authorization header', async () => {
    const db = freshDb()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'receipt-real' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const service = new ExpoPushService(db, new Expo(), () => 1_000)

    const result = await service.send(['ExpoPushToken[real]'], payload({ title: 'Hello', body: 'World' }))

    expect(result).toEqual({ delivered: 1, expired: 0, failed: 0 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBeNull()
    expect(JSON.parse(String(init?.body))).toEqual([
      expect.objectContaining({
        to: 'ExpoPushToken[real]',
        title: 'Hello',
        body: 'World',
        channelId: 'default',
      }),
    ])
    db.close()
  })
})
