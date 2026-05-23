import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import { createOpenCodeTargetProxyRoutes } from '../../src/routes/opencode-targets'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { RepoOpenCodeTargetManager } from '../../src/services/opencode/repo-target-manager'
import type { EnsureOpenCodeTargetResponse, Repo } from '@opencode-manager/shared/types'
import { createRepoTargetToken } from '../../src/services/opencode/repo-target-token'

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

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
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

describe('internal-opencode-target routes', () => {
  let app: Hono
  let token: string
  let targetManager: RepoOpenCodeTargetManager

  beforeEach(() => {
    vi.clearAllMocks()
    targetManager = createMockTargetManager()
    const scheduleService = {} as ScheduleService
    const notificationService = {} as NotificationService
    const settingsService = {} as SettingsService
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(mockDb, scheduleService, notificationService, settingsService, targetManager))
    token = 'test-internal-token'
  })

  it('POST /api/internal/repos/:repoId/opencode-target returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/repos/1/opencode-target', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /api/internal/repos/:repoId/opencode-target returns 400 for invalid repoId', async () => {
    const res = await app.request('/api/internal/repos/invalid/opencode-target', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/internal/repos/:repoId/opencode-target returns 404 for non-existent repo', async () => {
    const res = await app.request('/api/internal/repos/999/opencode-target', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/internal/repos/:repoId/opencode-target calls targetManager.ensureTarget', async () => {
    const { getRepoById } = await import('../../src/db/queries')
    const repo = { id: 1, localPath: 'test-repo' } as Repo
    vi.mocked(getRepoById).mockReturnValue(repo)

    const res = await app.request('/api/internal/repos/1/opencode-target', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(targetManager.ensureTarget).toHaveBeenCalledWith(repo)

    const body = await res.json() as { repoId: number; state: string; openCodeUrl: string }
    expect(body.repoId).toBe(1)
    expect(body.state).toBe('healthy')
    expect(body.openCodeUrl).toBe('/api/opencode-targets/repo/1')
  })
})

describe('opencode-target proxy routes', () => {
  let db: Database
  let targetManager: RepoOpenCodeTargetManager

  beforeEach(() => {
    vi.clearAllMocks()
    db = mockDb
    targetManager = createMockTargetManager()
  })

  it('returns 401 without bearer token', async () => {
    const app = new Hono()
    app.route('/api/opencode-targets', createOpenCodeTargetProxyRoutes(db, targetManager))

    const res = await app.request('/api/opencode-targets/repo/1/test')
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid repoId', async () => {
    const app = new Hono()
    app.route('/api/opencode-targets', createOpenCodeTargetProxyRoutes(db, targetManager))

    const res = await app.request('/api/opencode-targets/repo/invalid/test', {
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(res.status).toBe(400)
  })

  it('returns 503 when target is not available', async () => {
    const app = new Hono()
    app.route('/api/opencode-targets', createOpenCodeTargetProxyRoutes(db, targetManager))

    // Generate a valid token for repoId 1
    const token = createRepoTargetToken(1)
    const res = await app.request('/api/opencode-targets/repo/1/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(503)
    expect(targetManager.getTarget).toHaveBeenCalledWith(1)
  })

  it('returns 401 when token repo ID does not match path repo ID', async () => {
    const app = new Hono()
    app.route('/api/opencode-targets', createOpenCodeTargetProxyRoutes(db, targetManager))

    // Token for repoId 2 but path is repoId 1
    const token = createRepoTargetToken(2)
    const res = await app.request('/api/opencode-targets/repo/1/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 501 for WebSocket upgrade requests', async () => {
    const app = new Hono()
    app.route('/api/opencode-targets', createOpenCodeTargetProxyRoutes(db, targetManager))

    const token = createRepoTargetToken(1)
    const res = await app.request('/api/opencode-targets/repo/1/ws', {
      headers: {
        Authorization: `Bearer ${token}`,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
      },
    })
    expect(res.status).toBe(501)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('WebSocket')
  })
})
