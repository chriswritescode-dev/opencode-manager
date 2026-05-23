import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { Repo } from '../../src/types/repo'
import type { RepoOpenCodeTargetManager } from '../../src/services/opencode/repo-target-manager'
import type { EnsureOpenCodeTargetResponse } from '@opencode-manager/shared/types'

const mockDb = {
  prepare: vi.fn().mockReturnValue({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  }),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn((fn: () => void) => fn()),
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb),
}))

const mockListRepos = vi.fn()
const mockGetRepoById = vi.fn()
vi.mock('../../src/db/queries', () => ({
  listRepos: (...args: unknown[]) => mockListRepos(...args),
  getRepoById: (...args: unknown[]) => mockGetRepoById(...args),
}))

vi.mock('../../src/db/migration-runner', () => ({
  migrate: vi.fn(),
}))

vi.mock('../../src/services/internal-token', () => ({
  getOrCreateInternalToken: vi.fn().mockReturnValue('test-internal-token'),
}))

vi.mock('../../src/services/schedules', () => ({
  ScheduleService: vi.fn(),
}))

vi.mock('../../src/services/notification', () => ({
  NotificationService: vi.fn(),
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn(),
}))

vi.mock('../../src/services/opencode/client', () => ({
  createOpenCodeClient: vi.fn(),
}))

vi.mock('../../src/services/opencode/repo-session-sync', () => ({
  RepoSessionSyncService: vi.fn().mockImplementation(() => ({
    syncSession: vi.fn().mockResolvedValue({ replayedEvents: 5 }),
  })),
}))

function makeRepo(overrides: Partial<Repo>): Repo {
  return {
    id: 1,
    localPath: 'test-repo',
    fullPath: '/tmp/test-repo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    ...overrides,
  }
}

describe('internal-opencode-workspaces routes', () => {
  let app: Hono
  let token: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockListRepos.mockReturnValue([])
    const scheduleService = {} as ScheduleService
    const notificationService = {} as NotificationService
    const settingsService = {} as SettingsService
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(mockDb, scheduleService, notificationService, settingsService))
    token = 'test-internal-token'
  })

  it('GET /api/internal/opencode-workspaces returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-workspaces')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-workspaces returns 200 with bearer token', async () => {
    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: unknown[] }
    expect(body).toHaveProperty('workspaces')
    expect(Array.isArray(body.workspaces)).toBe(true)
  })

  it('GET /api/internal/opencode-workspaces only returns ready repos', async () => {
    mockListRepos.mockReturnValue([
      makeRepo({ id: 1, cloneStatus: 'ready', localPath: 'ready-repo' }),
      makeRepo({ id: 2, cloneStatus: 'cloning', localPath: 'cloning-repo' }),
      makeRepo({ id: 3, cloneStatus: 'error', localPath: 'error-repo' }),
    ])

    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: Array<{ repoId: number; cloneStatus: string }> }
    expect(body.workspaces.length).toBe(1)
    expect(body.workspaces[0]?.cloneStatus).toBe('ready')
    expect(body.workspaces[0]?.repoId).toBeDefined()
  })

  it('GET /api/internal/opencode-workspaces returns workspace structure', async () => {
    mockListRepos.mockReturnValue([
      makeRepo({ id: 1, localPath: 'test-repo', cloneStatus: 'ready' }),
    ])

    const res = await app.request('/api/internal/opencode-workspaces', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { workspaces: Array<{ repoId: number; name: string; branch: string | null; cloneStatus: string; directory: string; extra: { repoId: number; localPath: string; fullPath: string } }> }
    expect(body.workspaces.length).toBe(1)
    const workspace = body.workspaces[0]!
    expect(workspace).toHaveProperty('repoId')
    expect(workspace).toHaveProperty('name')
    expect(workspace).toHaveProperty('branch')
    expect(workspace).toHaveProperty('cloneStatus')
    expect(workspace).toHaveProperty('directory')
    expect(workspace).toHaveProperty('extra')
    expect(workspace.extra).toHaveProperty('repoId')
    expect(workspace.extra).toHaveProperty('localPath')
    expect(workspace.extra).toHaveProperty('fullPath')
  })
})

function createMockTargetManager(): RepoOpenCodeTargetManager {
  return {
    ensureTarget: vi.fn().mockResolvedValue({
      repoId: 1,
      state: 'healthy',
      openCodeUrl: '/api/opencode-targets/repo/1',
      headers: { Authorization: 'Bearer test-token' },
      reused: false,
    } as EnsureOpenCodeTargetResponse),
    getTarget: vi.fn().mockReturnValue(null),
    stopTarget: vi.fn().mockResolvedValue(undefined),
  } as unknown as RepoOpenCodeTargetManager
}

describe('POST /api/internal/repos/:repoId/sessions/:sessionId/sync', () => {
  let app: Hono
  let token: string
  let targetManager: RepoOpenCodeTargetManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRepoById.mockReset()
    mockListRepos.mockReturnValue([])
    targetManager = createMockTargetManager()
    const scheduleService = {} as ScheduleService
    const notificationService = {} as NotificationService
    const settingsService = {} as SettingsService
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(mockDb, scheduleService, notificationService, settingsService, targetManager))
    token = 'test-internal-token'
  })

  it('returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/sessions/session-123/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid repoId', async () => {
    const res = await app.request('/api/internal/repos/invalid/sessions/session-123/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty sessionId', async () => {
    const res = await app.request('/api/internal/repos/1/sessions//sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid reason', async () => {
    const res = await app.request('/api/internal/repos/1/sessions/session-123/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent repo', async () => {
    mockGetRepoById.mockReturnValue(null)

    const res = await app.request('/api/internal/repos/999/sessions/session-123/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 503 when target is not healthy', async () => {
    const repo = makeRepo({ id: 1, fullPath: '/tmp/test-repo' })
    mockGetRepoById.mockReturnValue(repo)
    targetManager.getTarget = vi.fn().mockReturnValue(null)

    const res = await app.request('/api/internal/repos/1/sessions/session-123/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })
    expect(res.status).toBe(503)
  })

  it('returns 200 with valid request and healthy target', async () => {
    const repo = makeRepo({ id: 1, fullPath: '/tmp/test-repo' })
    mockGetRepoById.mockReturnValue(repo)
    
    const mockRuntime = {
      repoId: 1,
      port: 3000,
      token: 'test-token',
      state: 'healthy',
      process: null,
      startedAt: Date.now(),
      lastUsedAt: Date.now(),
    }
    targetManager.getTarget = vi.fn().mockReturnValue(mockRuntime)

    const res = await app.request('/api/internal/repos/1/sessions/session-123/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { repoId: number; sessionId: string; replayedEvents: number }
    expect(body.repoId).toBe(1)
    expect(body.sessionId).toBe('session-123')
    expect(body.replayedEvents).toBe(5)
  })
})
