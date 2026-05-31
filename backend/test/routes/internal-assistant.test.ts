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
import { getAssistantModeDirectory } from '../../src/services/assistant-mode'
import type { OpenCodeClient } from '../../src/services/opencode/client'

describe('internal/assistant routes', () => {
  let db: Database
  let scheduleService: ScheduleService
  let notificationService: NotificationService
  let settingsService: SettingsService
  let app: Hono
  let token: string
  let forwardMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)

    forwardMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    const openCodeClient = {
      forward: forwardMock,
      forwardRaw: vi.fn(),
      getJson: vi.fn(),
      postJson: vi.fn(),
      setProviderAuth: vi.fn(),
      deleteProviderAuth: vi.fn(),
      startMcpAuth: vi.fn(),
      authenticateMcp: vi.fn(),
    } as unknown as OpenCodeClient

    scheduleService = new ScheduleService(db, openCodeClient)
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

  it('forwards POST /instance/dispose with correct directory', async () => {
    await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(forwardMock).toHaveBeenCalledTimes(1)
    expect(forwardMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/instance/dispose',
      directory: getAssistantModeDirectory(),
    })
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

  it('returns 502 when OpenCode responds non-2xx', async () => {
    forwardMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }),
    )
    const res = await app.request('/api/internal/assistant/reload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Failed to reload assistant workspace')
  })

})
