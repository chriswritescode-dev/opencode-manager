import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { SettingsService } from '../../src/services/settings'
import { ScheduleService } from '../../src/services/schedules'
import { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createGitAuthService } from '../helpers/git-fixtures'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const RepoSummarySchema = z.object({
  id: z.number(),
  localPath: z.string(),
  fullPath: z.string(),
  cloneStatus: z.string(),
})

const ReposResponseSchema = z.object({ repos: z.array(RepoSummarySchema) })
const SchedulesResponseSchema = z.object({ jobs: z.array(z.object({ id: z.number() })) })
const ErrorResponseSchema = z.object({ error: z.string() })

describe('internal-repos routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let settingsService: SettingsService
  let app: Hono
  let token: string

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  function jsonHeaders() {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  beforeEach(() => {
    db = createTestDatabase()
    const openCodeClient = createStubOpenCodeClient()
    const gitAuthService = createGitAuthService()
    const scheduleService = new ScheduleService(
      db,
      openCodeClient,
      new ScheduleWorktreeManager(gitAuthService, db),
    )
    settingsService = new SettingsService(db)
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { scheduleService, settingsService, gitAuthService }))
  })

  afterEach(() => {
    db.close()
  })

  it('GET /api/internal/repos returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/repos returns every repo', async () => {
    const first = seedRepo(db, { localPath: 'repo1' })
    const second = seedRepo(db, { localPath: 'repo2' })

    const res = await app.request('/api/internal/repos', { headers: authHeaders() })
    const body = await readJson(res, ReposResponseSchema)

    expect(res.status).toBe(200)
    expect(body.repos.map((repo) => repo.id)).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(body.repos.map((repo) => repo.localPath)).toEqual(expect.arrayContaining(['repo1', 'repo2']))
  })

  it('GET /api/internal/repos respects the repoOrder preference', async () => {
    const first = seedRepo(db, { localPath: 'repo1' })
    const second = seedRepo(db, { localPath: 'repo2' })
    settingsService.updateSettings({ repoOrder: [second.id, first.id] })

    const res = await app.request('/api/internal/repos', { headers: authHeaders() })
    const body = await readJson(res, ReposResponseSchema)

    expect(res.status).toBe(200)
    expect(body.repos.map((repo) => repo.id)).toEqual([second.id, first.id])
  })

  it('POST /api/internal/repos returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://github.com/owner/name' }),
    })

    expect(res.status).toBe(401)
  })

  it.each([
    { label: 'a missing repoUrl', body: JSON.stringify({}) },
    { label: 'an unknown localPath key', body: JSON.stringify({ repoUrl: 'https://github.com/owner/name', localPath: '/etc' }) },
    { label: 'invalid JSON', body: 'not json' },
  ])('POST /api/internal/repos rejects $label', async ({ body: requestBody }) => {
    const res = await app.request('/api/internal/repos', {
      method: 'POST',
      headers: jsonHeaders(),
      body: requestBody,
    })
    const body = await readJson(res, ErrorResponseSchema)

    expect(res.status).toBe(400)
    expect(body.error).not.toBe('')
  })

  it('POST /api/internal/repos returns the already registered repo for the same URL', async () => {
    const existing = seedRepo(db, {
      localPath: 'name',
      cloneStatus: 'ready',
      isLocal: false,
      repoUrl: 'https://github.com/owner/name',
    })

    const res = await app.request('/api/internal/repos', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ repoUrl: 'https://github.com/owner/name.git' }),
    })
    const body = await readJson(res, RepoSummarySchema)

    expect(res.status).toBe(200)
    expect(body.id).toBe(existing.id)
  })

  it('GET /api/internal/repos/:id/schedules returns the schedule jobs', async () => {
    const repo = seedRepo(db, { localPath: 'test-repo' })

    const res = await app.request(`/api/internal/repos/${repo.id}/schedules`, { headers: authHeaders() })
    const body = await readJson(res, SchedulesResponseSchema)

    expect(res.status).toBe(200)
    expect(body.jobs).toEqual([])
  })
})
