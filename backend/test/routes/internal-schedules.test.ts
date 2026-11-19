import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { ScheduleService } from '../../src/services/schedules'
import { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createGitAuthService } from '../helpers/git-fixtures'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const JobsResponseSchema = z.object({ jobs: z.array(z.object({ id: z.number() })) })
const RunsResponseSchema = z.object({ runs: z.array(z.object({ id: z.number() })) })

describe('internal-schedules routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let scheduleService: ScheduleService
  let app: Hono
  let token: string

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  beforeEach(() => {
    db = createTestDatabase()
    const openCodeClient = createStubOpenCodeClient()
    scheduleService = new ScheduleService(
      db,
      openCodeClient,
      new ScheduleWorktreeManager(createGitAuthService(), db),
    )
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { scheduleService }))
  })

  afterEach(() => {
    db.close()
  })

  it('GET /api/internal/schedules/all returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/schedules/all returns the jobs with bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all', { headers: authHeaders() })
    const body = await readJson(res, JobsResponseSchema)

    expect(res.status).toBe(200)
    expect(body.jobs).toEqual([])
  })

  it('GET /api/internal/schedules/all/runs returns the runs with bearer token', async () => {
    const res = await app.request('/api/internal/schedules/all/runs', { headers: authHeaders() })
    const body = await readJson(res, RunsResponseSchema)

    expect(res.status).toBe(200)
    expect(body.runs).toEqual([])
  })

  it('POST /api/internal/repos/:id/schedules/:jobId/run returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/schedules/1/run', { method: 'POST' })

    expect(res.status).toBe(401)
  })
})
