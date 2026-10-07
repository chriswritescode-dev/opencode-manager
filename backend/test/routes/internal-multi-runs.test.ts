import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionPermissionModeService } from '../../src/services/session-permission-modes'
import type { RepoWorkspaceService } from '../../src/services/repo-workspace'
import type { GitAuthService } from '../../src/services/git-auth'
import type { SessionGoalService } from '../../src/services/session-goals'
import type { MultiRunService } from '../../src/services/multi-runs'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'

function createMultiRunStub() {
  return {
    list: vi.fn(),
    launch: vi.fn(),
    discard: vi.fn(),
    fuse: vi.fn(),
  }
}

function createRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    repoId: 1,
    name: 'Sweep',
    prompt: 'go',
    isolated: true,
    baseRef: null,
    createdAt: 1,
    entries: [],
    fusions: [],
    ...overrides,
  }
}

function fuseBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    entryIds: [1, 2],
    model: 'openai/a',
    isolate: true,
    ...overrides,
  }
}

describe('internal-multi-runs routes', () => {
  let db: Database
  let multiRuns: ReturnType<typeof createMultiRunStub>
  let app: Hono
  let token: string

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    multiRuns = createMultiRunStub()
    app = new Hono()
    app.route(
      '/api/internal',
      createInternalRoutes(
        db,
        {} as ScheduleService,
        {} as NotificationService,
        {} as SettingsService,
        {} as OpenCodeClient,
        {} as SessionPermissionModeService,
        {} as unknown as RepoWorkspaceService,
        {} as unknown as GitAuthService,
        {} as unknown as SessionGoalService,
        multiRuns as unknown as MultiRunService,
      ),
    )
    token = getOrCreateInternalToken(db)
  })

  it('GET /api/internal/multi-runs returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/multi-runs?repoId=1')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/multi-runs returns the repository runs with a bearer token', async () => {
    multiRuns.list.mockReturnValue([])

    const res = await app.request('/api/internal/multi-runs?repoId=1', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ runs: [] })
    expect(multiRuns.list).toHaveBeenCalledWith(1)
  })

  it('POST /api/internal/multi-runs/3/entries/4/discard discards the entry', async () => {
    multiRuns.discard.mockResolvedValue(createRun())

    const res = await app.request('/api/internal/multi-runs/3/entries/4/discard', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(multiRuns.discard).toHaveBeenCalledWith(3, 4)
  })

  it('POST /api/internal/multi-runs/3/fusions fuses the run', async () => {
    multiRuns.fuse.mockResolvedValue({ run: createRun(), created: true })
    const body = fuseBody()

    const res = await app.request('/api/internal/multi-runs/3/fusions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ run: createRun() })
    expect(multiRuns.fuse).toHaveBeenCalledWith(3, body)
  })
})
