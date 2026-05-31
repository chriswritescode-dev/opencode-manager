import { describe, it, expect, beforeEach } from 'vitest'
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

describe('internal-schedules routes', () => {
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
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/schedules/all returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/schedules/all returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: unknown[] }
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  it('GET /api/internal/schedules/all/runs returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all/runs', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { runs: unknown[] }
    expect(body).toHaveProperty('runs')
  })

  it('POST /api/internal/repos/:id/schedules/:jobId/run returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/schedules/1/run', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
  })
})
