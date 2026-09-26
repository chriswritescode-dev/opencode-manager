import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

const readOpenCodeConfigFileMock = vi.hoisted(() => vi.fn())

vi.mock('../../src/services/opencode-config-file', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/opencode-config-file')>(),
  readOpenCodeConfigFile: readOpenCodeConfigFileMock,
}))

describe('internal/assistant routes', () => {
  let db: Database
  let scheduleService: ScheduleService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    readOpenCodeConfigFileMock.mockReset().mockResolvedValue({ isValid: true })
    reloadMock = vi.fn().mockResolvedValue(undefined)
    const openCodeClient = {
      api: { location: { reload: reloadMock } },
      forwardRaw: vi.fn(),
    } as unknown as OpenCodeClient

    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    scheduleService = new ScheduleService(db, openCodeClient, stubWorktreeManager)
    notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
  })

  it('POST /api/internal/assistant/reload returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/assistant/reload', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/assistant/reload returns 200 with valid token', async () => {
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('reloads OpenCode through the shared location reload without a directory argument', async () => {
    await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(reloadMock).toHaveBeenCalledWith()
  })

  it('returns 429 after exceeding rate limit (5 calls/min)', async () => {
    const results: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await app.request('/api/internal/assistant/reload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      results.push(res.status)
    }

    // First 5 should succeed
    expect(results.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    // 6th should be rate limited
    expect(results[5]).toBe(429)
  })

  it('429 response includes Retry-After header', async () => {
    // Burn through the 5 allowed calls
    for (let i = 0; i < 5; i++) {
      await app.request('/api/internal/assistant/reload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    }

    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('returns 502 when the location reload fails', async () => {
    reloadMock.mockRejectedValue(new Error('reload failed'))
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Failed to reload assistant workspace')
  })

  it('returns 400 without reloading when the OpenCode config is invalid', async () => {
    const validationIssues = [{ path: 'model', message: 'Invalid model' }]
    readOpenCodeConfigFileMock.mockResolvedValue({ isValid: false, validationIssues })
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; validationIssues: unknown }
    expect(body).toEqual({ error: 'OpenCode global configuration is invalid', validationIssues })
    expect(reloadMock).not.toHaveBeenCalled()
  })

})
