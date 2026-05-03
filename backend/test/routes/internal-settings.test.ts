import { describe, it, expect, beforeEach } from 'bun:test'
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

describe('internal/settings routes', () => {
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
    scheduleService = new ScheduleService(db, openCodeClient)
    notificationService = new NotificationService(db)
    settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/settings returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: unknown; updatedAt: number }
    expect(body).toHaveProperty('preferences')
    expect(body).toHaveProperty('updatedAt')
  })

  it('GET /api/internal/settings returns merged defaults', async () => {
    const res = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { preferences: { theme: string; mode: string } }
    expect(body.preferences.theme).toBe('dark')
    expect(body.preferences.mode).toBe('build')
  })

  it('PATCH /api/internal/settings returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('PATCH /api/internal/settings with { theme: "dark" } persists and returns new settings', async () => {
    const patchRes = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'dark' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(patchRes.status).toBe(200)

    const getRes = await app.request('/api/internal/settings', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const body = await getRes.json() as { preferences: { theme: string } }
    expect(body.preferences.theme).toBe('dark')
  })

  it('PATCH /api/internal/settings with { gitCredentials: [...] } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ gitCredentials: [{ name: 'test', token: 'secret' }] }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { tts: { apiKey: "secret" } } returns 400 (strict reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ tts: { apiKey: 'secret' } }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/internal/settings with { theme: "rainbow" } returns 400 (enum reject)', async () => {
    const res = await app.request('/api/internal/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme: 'rainbow' }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    })
    expect(res.status).toBe(400)
  })
})
