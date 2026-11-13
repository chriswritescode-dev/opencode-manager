import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { Hono } from 'hono'
import { AssistantNotificationResponseSchema } from '@opencode-manager/shared/schemas'
import type { AssistantNotificationRequest } from '@opencode-manager/shared'
import { NotificationService } from '../../src/services/notification'
import type { NotificationRoutesService } from '../../src/routes/internal/notifications'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

type SendToUser = NotificationRoutesService['sendToUser']

function sentUrl(sendToUser: MockInstance<SendToUser>): string | undefined {
  const call = sendToUser.mock.calls[0]
  if (!call) throw new Error('expected the notification to be sent')
  return call[1].data?.url
}

describe('internal/notifications routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let notificationService: NotificationService
  let app: Hono
  let token: string

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  function jsonHeaders() {
    return { 'content-type': 'application/json', ...authHeaders() }
  }

  function send(payload: Partial<AssistantNotificationRequest>, headers: Headers = new Headers(jsonHeaders())) {
    return app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body', ...payload }),
      headers,
    })
  }

  function configureNotifications() {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
  }

  beforeEach(() => {
    db = createTestDatabase()
    notificationService = new NotificationService(db)
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { notificationService }))
  })

  afterEach(() => {
    db.close()
  })

  it.each([
    { label: 'a missing bearer token', headers: () => new Headers({ 'content-type': 'application/json' }) },
    { label: 'an invalid bearer token', headers: () => new Headers({ 'content-type': 'application/json', authorization: 'Bearer invalid-token' }) },
  ])('POST /api/internal/notifications/send returns 401 for $label', async ({ headers }) => {
    const res = await send({}, headers())

    expect(res.status).toBe(401)
  })

  it('POST /api/internal/notifications/send returns 503 when push notifications are not configured', async () => {
    const res = await send({})

    expect(res.status).toBe(503)
  })

  it('POST /api/internal/notifications/send reports no subscriptions', async () => {
    configureNotifications()
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await send({})
    const body = await readJson(res, AssistantNotificationResponseSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({ delivered: 0, expired: 0, failed: 0, noSubscriptions: true })
  })

  it.each([
    { label: 'a missing title', payload: { title: undefined } },
    { label: 'a title longer than 120 characters', payload: { title: 'a'.repeat(121) } },
    { label: 'a body longer than 500 characters', payload: { body: 'b'.repeat(501) } },
    { label: 'a url longer than 500 characters', payload: { url: `/${'u'.repeat(500)}` } },
  ])('POST /api/internal/notifications/send returns 400 for $label', async ({ payload }) => {
    configureNotifications()
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await send(payload)

    expect(res.status).toBe(400)
  })

  describe('notification url', () => {
    beforeEach(() => {
      configureNotifications()
    })

    it('links a scheduled run session to its run report, even when the agent passes a url', async () => {
      db.exec('PRAGMA foreign_keys = OFF')
      const run = createScheduleRun(db, {
        jobId: 7,
        repoId: 0,
        triggerSource: 'schedule',
        status: 'running',
        startedAt: 1,
        createdAt: 1,
      })
      updateScheduleRunMetadata(db, 0, 7, run.id, { sessionId: 'ses_scheduled' })
      const sendToUser = vi.spyOn(notificationService, 'sendToUser')
        .mockResolvedValue({ delivered: 1, expired: 0, failed: 0, total: 1 })

      const res = await send({ sessionId: 'ses_scheduled', url: '/repos/my-repo' })

      expect(res.status).toBe(200)
      expect(sentUrl(sendToUser)).toBe(`/schedules?scheduleTab=runs&runId=${run.id}`)
    })

    it('keeps the agent url for sessions that are not scheduled runs', async () => {
      const sendToUser = vi.spyOn(notificationService, 'sendToUser')
        .mockResolvedValue({ delivered: 1, expired: 0, failed: 0, total: 1 })

      const res = await send({ sessionId: 'ses_manual', url: '/repos/3' })

      expect(res.status).toBe(200)
      expect(sentUrl(sendToUser)).toBe('/repos/3')
    })
  })

  it('POST /api/internal/notifications/send returns 429 after 10 calls within the rate window', async () => {
    configureNotifications()
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await send({})
      expect(res.status).toBe(200)
    }

    const limited = await send({})
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
  })
})
