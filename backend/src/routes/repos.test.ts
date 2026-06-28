import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { createRepoRoutes } from './repos'
import { createRepo, getRepoById } from '../db/queries'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeClient } from '../services/opencode/client'
import type { Repo } from '@opencode-manager/shared/types'
import { getReposPath } from '@opencode-manager/shared/config/env'
import path from 'path'

beforeEach(() => {
  mock.module('../services/project-id-resolver', () => ({
    resolveProjectId: (() => null) as any,
    isGitMainCheckout: (() => Promise.resolve(false)) as any,
  }))
})

afterEach(() => {
  mock.restore()
})

const stubGitAuthService = {
  getGitEnvironment: () => ({}),
  getGitCredentials: async () => [],
} as unknown as GitAuthService

function createTestApp(db: Database, openCodeClient: OpenCodeClient = createStubOpenCodeClient({
  getJson: mock(async () => []) as any,
})): Hono {
  const app = new Hono()
  const scheduleService = {
    createSchedule: () => {},
    getScheduleById: () => null,
    listSchedules: () => [],
    updateSchedule: () => {},
    deleteSchedule: () => {},
    prepareRepoDelete: () => {},
  } as any
  app.route('/repos', createRepoRoutes(db, stubGitAuthService, scheduleService, openCodeClient))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('GET /api/repos/:id/siblings', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
  })

  it('returns siblings including self with currentBranch', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: ((path: string) => Promise.resolve(
        path.includes('repo-unrelated') ? 'commit-B' : 'commit-A'
      )) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-b', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-c', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-unrelated', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; currentBranch: string | null | undefined }>
    expect(data).toHaveLength(3)
    expect(data.map((d) => d.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('includes OpenCode workspaces that are not manager repo rows', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(db, createStubOpenCodeClient({
      getJson: mock(async () => ([{
        id: 'wrk_test',
        type: 'worktree',
        name: 'plugin-workspace',
        branch: 'plugin-branch',
        directory: '/tmp/plugin-workspace',
        projectID: 'commit-A',
      }])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; workspaceId?: string; currentBranch?: string }>
    expect(data).toHaveLength(2)
    expect(data[1]).toMatchObject({
      id: -1,
      workspaceId: 'wrk_test',
      currentBranch: 'plugin-branch',
    })
  })

  it('deduplicates OpenCode workspaces with the same directory', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(db, createStubOpenCodeClient({
      getJson: mock(async () => ([
        {
          id: 'wrk_first',
          type: 'worktree',
          name: 'duplicate-workspace',
          branch: 'duplicate-branch',
          directory: '/tmp/duplicate-workspace',
          projectID: 'commit-A',
        },
        {
          id: 'wrk_second',
          type: 'worktree',
          name: 'duplicate-workspace',
          branch: 'duplicate-branch',
          directory: '/tmp/duplicate-workspace/',
          projectID: 'commit-A',
        },
      ])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ workspaceId?: string }>
    expect(data.filter((entry) => entry.workspaceId)).toHaveLength(1)
    expect(data.some((entry) => entry.workspaceId === 'wrk_first')).toBe(true)
  })

  it('excludes a workspace pointing at the repo directory so it cannot be deleted', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const repoDirectory = path.join(getReposPath(), 'repo-a')
    app = createTestApp(db, createStubOpenCodeClient({
      getJson: mock(async () => ([{
        id: 'wrk_self',
        type: 'worktree',
        name: 'self-workspace',
        branch: 'main',
        directory: `${repoDirectory}/`,
        projectID: 'commit-A',
      }])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; workspaceId?: string }>
    expect(data).toHaveLength(1)
    expect(data.some((d) => d.workspaceId === 'wrk_self')).toBe(false)
  })

  it('excludes a workspace that is a git main checkout so the main repo cannot be deleted', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: ((dir: string) =>
        Promise.resolve(dir === '/Users/dev/main-repo')) as any,
    }))

    createRepo(db, { localPath: 'repo-wt', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    app = createTestApp(db, createStubOpenCodeClient({
      getJson: mock(async () => ([
        {
          id: 'wrk_main',
          type: 'worktree',
          name: 'main-checkout',
          branch: 'dev',
          directory: '/Users/dev/main-repo',
          projectID: 'commit-A',
        },
        {
          id: 'wrk_linked',
          type: 'worktree',
          name: 'feature',
          branch: 'feature/x',
          directory: '/Users/dev/worktrees/feature-x',
          projectID: 'commit-A',
        },
      ])) as any,
    }))

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ workspaceId?: string }>
    expect(data.some((d) => d.workspaceId === 'wrk_main')).toBe(false)
    expect(data.some((d) => d.workspaceId === 'wrk_linked')).toBe(true)
  })

  it('excludes repos with non-matching projectID', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: ((path: string) => Promise.resolve(
        path.includes('repo-only') ? 'commit-X' : 'commit-Y'
      )) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-only', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-other', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number }>
    expect(data).toHaveLength(1)
    expect(data[0]!.id).toBe(1)
  })

  it('returns empty when target has no projectID', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => null) as any,
    }))

    createRepo(db, { localPath: 'repo-no-project', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target cloneStatus !== ready', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => 'commit-A') as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-cloning', defaultBranch: 'main', cloneStatus: 'cloning', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target missing', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => 'commit-A') as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    const res = await app.request('/repos/9999/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('invalid id returns 400', async () => {
    const res = await app.request('/repos/abc/siblings')
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Invalid repo id')
  })
})

describe('DELETE /api/repos/:id/workspaces/:workspaceId', () => {
  let db: Database
  let captured: { path: string; directory?: string } | null

  beforeEach(() => {
    db = createTestDb()
    captured = null
  })

  afterEach(() => {
    db.close()
  })

  it('forwards workspace delete to OpenCode with repo directory', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const forward = mock(async (req: Parameters<OpenCodeClient['forward']>[0]) => {
      captured = { path: req.path, directory: req.directory }
      return new Response(JSON.stringify({ id: 'wrk_test' }), { status: 200 })
    })
    const app = createTestApp(db, createStubOpenCodeClient({
      forward,
    }))

    const res = await app.request('/repos/1/workspaces/wrk_test', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(captured?.path).toBe('/experimental/workspace/wrk_test')
    expect(captured?.directory?.endsWith('/repos/repo-a')).toBe(true)
  })
})

describe('POST /api/repos/:id/workspaces', () => {
  let db: Database
  let captured: { path: string; directory?: string; body?: string } | null

  beforeEach(() => {
    db = createTestDb()
    captured = null
  })

  afterEach(() => {
    db.close()
  })

  it('forwards workspace creation to OpenCode with repo directory', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const forward = mock(async (req: Parameters<OpenCodeClient['forward']>[0]) => {
      captured = { path: req.path, directory: req.directory, body: req.body }
      return new Response(JSON.stringify({ id: 'wrk_test', type: 'worktree', directory: '/tmp/wrk-test' }), { status: 200 })
    })
    const app = createTestApp(db, createStubOpenCodeClient({
      forward,
    }))

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(captured?.path).toBe('/experimental/workspace')
    expect(captured?.directory?.endsWith('/repos/repo-a')).toBe(true)
    expect(JSON.parse(captured?.body ?? '{}')).toEqual({ type: 'worktree', branch: null })
    expect(await res.json()).toMatchObject({ id: 'wrk_test', type: 'worktree' })
  })
})

describe('PATCH /api/repos/:id', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
  })

  afterEach(() => {
    db.close()
  })

  it('sets a custom name on a ready repo', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: 'My Fork' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(200)
    const data = await res.json() as Repo
    expect(data.name).toBe('My Fork')

    const stored = getRepoById(db, 1)
    expect(stored?.name).toBe('My Fork')
  })

  it('clears a custom name (reverts to derived)', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: 'My Fork' }), headers: { 'Content-Type': 'application/json' } })

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: '' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(200)
    const data = await res.json() as Repo
    expect(data.name).toBeUndefined()

    const stored = getRepoById(db, 1)
    expect(stored?.name).toBeUndefined()
  })

  it('trims whitespace from the name', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: '  Spaced  ' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(200)
    const data = await res.json() as Repo
    expect(data.name).toBe('Spaced')
  })

  it('returns 404 for non-existent repo', async () => {
    const res = await app.request('/repos/999999', { method: 'PATCH', body: JSON.stringify({ name: 'Test' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(404)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Repo not found')
  })

  it('returns 400 for assistant repo', async () => {
    const res = await app.request('/repos/0', { method: 'PATCH', body: JSON.stringify({ name: 'Test' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Assistant repository cannot be renamed')
  })

  it('returns 400 for name exceeding 100 characters', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const longName = 'a'.repeat(101)
    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: longName }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(400)
  })
})
