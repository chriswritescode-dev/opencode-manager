import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createInternalRoutes } from '../../src/routes/internal'
import type { ScheduleService } from '../../src/services/schedules'
import type { NotificationService } from '../../src/services/notification'
import type { SettingsService } from '../../src/services/settings'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'

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
vi.mock('../../src/db/queries', () => ({
  listRepos: (...args: unknown[]) => mockListRepos(...args),
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
    const openCodeClient = {
      forward: vi.fn(),
      forwardRaw: vi.fn(),
      getJson: vi.fn(),
      postJson: vi.fn(),
      setProviderAuth: vi.fn(),
      deleteProviderAuth: vi.fn(),
      startMcpAuth: vi.fn(),
      authenticateMcp: vi.fn(),
    } as unknown as OpenCodeClient
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(mockDb, scheduleService, notificationService, settingsService, openCodeClient))
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
