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
import { createRepo } from '../../src/db/queries'
import type { CreateRepoInput } from '../../src/types/repo'

describe('internal-repos routes', () => {
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

  it('GET /api/internal/repos returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/repos returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: unknown[] }
    expect(body).toHaveProperty('repos')
    expect(Array.isArray(body.repos)).toBe(true)
  })

  it('GET /api/internal/repos returns repos in default order', async () => {
    const repo1Input: CreateRepoInput = {
      localPath: 'repo1',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo2Input: CreateRepoInput = {
      localPath: 'repo2',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    createRepo(db, repo1Input)
    createRepo(db, repo2Input)

    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: Array<{ id: number; localPath: string }> }
    expect(body.repos.length).toBe(2)
  })

  it('GET /api/internal/repos respects repoOrder preference', async () => {
    const repo1Input: CreateRepoInput = {
      localPath: 'repo1',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo2Input: CreateRepoInput = {
      localPath: 'repo2',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo1 = createRepo(db, repo1Input)
    const repo2 = createRepo(db, repo2Input)

    settingsService.updateSettings({
      repoOrder: [repo2.id, repo1.id],
    })

    const res = await app.request('/api/internal/repos', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { repos: Array<{ id: number; localPath: string }> }
    expect(body.repos.length).toBe(2)
    expect(body.repos[0]?.id).toBe(repo2.id)
    expect(body.repos[1]?.id).toBe(repo1.id)
  })

  it('GET /api/internal/repos/:id/schedules still works after adding repos route', async () => {
    const repoInput: CreateRepoInput = {
      localPath: 'test-repo',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    }
    const repo = createRepo(db, repoInput)

    const res = await app.request(`/api/internal/repos/${repo.id}/schedules`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { jobs: unknown[] }
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})