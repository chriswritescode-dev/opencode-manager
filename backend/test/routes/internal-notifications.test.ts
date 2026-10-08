import { describe, it, expect, beforeEach, vi } from 'bun:test'
import type { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import type { RepoWorkspaceService } from '../../src/services/repo-workspace'
import type { GitAuthService } from '../../src/services/git-auth'
import type { SessionGoalService } from '../../src/services/session-goals'
import type { MultiRunService } from '../../src/services/multi-runs'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { createScheduleRun, updateScheduleRunMetadata } from '../../src/db/schedules'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

describe('internal/notifications routes', () => {
  let db: Database
  let scheduleService: ScheduleService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    scheduleService = new ScheduleService(db, openCodeClient, stubWorktreeManager)
    notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient, {} as SessionPermissionModeService, {} as unknown as RepoWorkspaceService, {} as unknown as GitAuthService, {} as unknown as SessionGoalService, {} as unknown as MultiRunService))
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

  it('POST /api/internal/notifications/send returns 503 when VAPID not configured', async () => {
    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(503)
  })

  it('POST /api/internal/notifications/send returns 200 with valid request (no subscriptions)', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
    vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ delivered: 0, expired: 0, failed: 0, total: 0 })

    const res = await app.request('/api/internal/notifications/send', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', body: 'Body' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { delivered: number; expired: number; failed: number; noSubscriptions: boolean }
    expect(body.delivered).toBe(0)
    expect(body.expired).toBe(0)
    expect(body.failed).toBe(0)
    expect(body.noSubscriptions).toBe(true)
  })

  it('POST /api/internal/notifications/send returns 400 on invalid body (missing title)', async () => {
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

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
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

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
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)

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
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
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

    beforeEach(() => {
      vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
    })

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
    vi.spyOn(notificationService, 'isConfigured').mockReturnValue(true)
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
