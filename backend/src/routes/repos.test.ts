import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { createRepoRoutes } from './repos'
import { createRepo, getRepoById, setRepoSetting } from '../db/queries'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { createGitService } from '../services/git/GitService'
import { ProjectConfigService } from '../services/project-config'
import { RepoWorkspaceService } from '../services/repo-workspace'
import type { GitAuthService } from '../services/git-auth'
import type { TerminalService } from '../services/terminal'
import type { OpenCodeClient } from '../services/opencode/client'
import type { Repo } from '@opencode-manager/shared/types'
import { getReposPath } from '@opencode-manager/shared/config/env'
import path from 'path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const tempDirs: string[] = []

function createTempDir(name?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'repos-test-'))
  tempDirs.push(root)
  if (!name) return root
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  mock.module('../services/project-id-resolver', () => ({
    resolveProjectId: (() => null) as any,
    isGitMainCheckout: (() => Promise.resolve(false)) as any,
  }))
})

afterEach(() => {
  mock.restore()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const stubGitAuthService = {
  getGitEnvironment: () => ({}),
  getGitCredentials: async () => [],
} as unknown as GitAuthService

const stubTerminalService = {
  removeAll: mock(async () => undefined),
} as unknown as TerminalService

function createTestApp(
  db: Database,
  openCodeClient: OpenCodeClient = createStubOpenCodeClient(),
  terminalService: TerminalService = stubTerminalService,
): Hono {
  const app = new Hono()
  const scheduleService = {
    createSchedule: () => {},
    getScheduleById: () => null,
    listSchedules: () => [],
    updateSchedule: () => {},
    deleteSchedule: () => {},
    prepareRepoDelete: async () => {},
  } as any
  const projectConfigService = new ProjectConfigService(db, createGitService(stubGitAuthService), stubGitAuthService)
  const repoWorkspaces = new RepoWorkspaceService(db, openCodeClient, stubGitAuthService, projectConfigService, terminalService, scheduleService)
  app.route('/repos', createRepoRoutes(db, stubGitAuthService, scheduleService, openCodeClient, terminalService, projectConfigService, repoWorkspaces))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createThrowingDb(): Database {
  return {
    prepare: () => {
      throw new Error('repo failed')
    },
    query: () => {
      throw new Error('repo failed')
    },
  } as unknown as Database
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

  it('includes OpenCode worktrees that are not manager repo rows', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const worktreeDir = createTempDir('plugin-workspace')
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([{
      directory: worktreeDir,
      strategy: 'plugin-strategy',
    }])) as any
    app = createTestApp(db, client)

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; fullPath?: string; localPath?: string; worktreeSource?: string; currentBranch?: string }>
    expect(data).toHaveLength(2)
    expect(data[1]).toMatchObject({
      id: -1,
      fullPath: worktreeDir,
      localPath: 'plugin-workspace',
      worktreeSource: 'opencode',
    })
    expect(data[1]?.currentBranch).toBeUndefined()
  })

  it('deduplicates OpenCode worktrees with the same directory', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const worktreeDir = createTempDir('duplicate-workspace')
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([
      { directory: worktreeDir, strategy: 'git' },
      { directory: `${worktreeDir}/`, strategy: 'git' },
    ])) as any
    app = createTestApp(db, client)

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ worktreeSource?: string }>
    expect(data.filter((entry) => entry.worktreeSource !== undefined)).toHaveLength(1)
  })

  it('excludes a worktree pointing at the repo directory so it cannot be deleted', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const repoDirectory = path.join(getReposPath(), 'repo-a')
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([{
      directory: `${repoDirectory}/`,
      strategy: 'git',
    }])) as any
    app = createTestApp(db, client)

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; worktreeSource?: string }>
    expect(data).toHaveLength(1)
    expect(data.some((d) => d.worktreeSource !== undefined)).toBe(false)
  })

  it('excludes a worktree that is a git main checkout so the main repo cannot be deleted', async () => {
    const mainRepoDir = createTempDir('main-repo')
    const featureDir = createTempDir('worktrees/feature-x')
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: ((dir: string) =>
        Promise.resolve(dir === mainRepoDir)) as any,
    }))

    createRepo(db, { localPath: 'repo-wt', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([
      { directory: mainRepoDir, strategy: 'git' },
      { directory: featureDir, strategy: 'git' },
    ])) as any
    app = createTestApp(db, client)

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ worktreeSource?: string; fullPath?: string }>
    expect(data.some((d) => d.fullPath === mainRepoDir)).toBe(false)
    expect(data.some((d) => d.fullPath === featureDir)).toBe(true)
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

  it('returns 500 when listing siblings throws', async () => {
    const res = await createTestApp(createThrowingDb()).request('/repos/1/siblings')
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/repos/:id/workspaces', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('removes a worktree sibling of the repo', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const worktreeDir = createTempDir('worktree-one')
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([{ directory: worktreeDir, strategy: 'git' }])) as any
    client.api.worktree.remove = remove as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: worktreeDir }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(remove).toHaveBeenCalledWith({ projectID: 'commit-A', directory: worktreeDir, force: true })
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const app = createTestApp(db)
    const res = await app.request('/repos/abc/workspaces', { method: 'DELETE' })

    expect(res.status).toBe(400)
  })

  it('returns 404 when the repo is missing or not ready', async () => {
    const app = createTestApp(db)

    const missing = await app.request('/repos/1/workspaces', { method: 'DELETE' })
    expect(missing.status).toBe(404)

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'cloning', clonedAt: Date.now(), isLocal: true })
    const notReady = await app.request('/repos/1/workspaces', { method: 'DELETE' })
    expect(notReady.status).toBe(404)
  })

  it('returns 400 when the body has no directory', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const app = createTestApp(db)
    const res = await app.request('/repos/1/workspaces', { method: 'DELETE' })

    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('directory is required')
  })

  it('returns 400 for null, primitive, and array JSON bodies without calling worktree removal', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient()
    client.api.worktree.remove = remove as any
    const app = createTestApp(db, client)

    for (const body of ['null', '42', '"directory"', '[]']) {
      const res = await app.request('/repos/1/workspaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      expect(res.status).toBe(400)
      const data = await res.json() as { error: string }
      expect(data.error).toBe('directory is required')
    }

    expect(remove).not.toHaveBeenCalled()
  })

  it('returns 400 when directory is missing or not a nonempty string', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient()
    client.api.worktree.remove = remove as any
    const app = createTestApp(db, client)

    for (const body of ['{}', '{"directory":42}', '{"directory":""}', '{"directory":"   "}']) {
      const res = await app.request('/repos/1/workspaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      expect(res.status).toBe(400)
      const data = await res.json() as { error: string }
      expect(data.error).toBe('directory is required')
    }

    expect(remove).not.toHaveBeenCalled()
  })

  it('returns 400 when the directory is not a deletable worktree sibling', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([{ directory: '/tmp/other-worktree', strategy: 'git' }])) as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/tmp/unknown-worktree' }),
    })

    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Not a deletable worktree of this repo')
  })

  it('returns 409 with the worktree error message', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => Promise.resolve('commit-A')) as any,
      isGitMainCheckout: (() => Promise.resolve(false)) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const worktreeDir = createTempDir('worktree-one')
    const client = createStubOpenCodeClient()
    client.api.worktree.list = mock(async () => ([{ directory: worktreeDir, strategy: 'git' }])) as any
    client.api.worktree.remove = mock(async () => {
      throw Object.assign(new Error('cannot remove'), {
        _tag: 'WorktreeError',
        name: 'WorktreeError',
        data: { message: 'cannot remove' },
      })
    }) as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: worktreeDir }),
    })

    expect(res.status).toBe(409)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('cannot remove')
  })

  it('returns 500 when reading the repo throws', async () => {
    const res = await createTestApp(createThrowingDb()).request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/tmp/worktree-one' }),
    })

    expect(res.status).toBe(500)
  })
})

describe('POST /api/repos/:id/workspaces', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('creates a worktree through the V2 API', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const create = mock(async () => ({ directory: '/tmp/wrk-test' }))
    const client = createStubOpenCodeClient()
    client.api.worktree.create = create as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ directory: '/tmp/wrk-test', worktreeSetup: { status: 'none' } })
    expect(create).toHaveBeenCalledWith({ projectID: 'commit-A' })
  })

  it('still returns 200 with a failed worktree setup when the setup terminal cannot start', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    setRepoSetting(db, 1, 'worktreeSetupCommands', JSON.stringify(['pnpm install']))
    const client = createStubOpenCodeClient()
    client.api.worktree.create = mock(async () => ({ directory: '/tmp/wrk-test' })) as any
    const failingTerminalService = {
      removeAll: mock(async () => undefined),
      create: mock(async () => {
        throw new Error('spawn failed')
      }),
    } as unknown as TerminalService
    const app = createTestApp(db, client, failingTerminalService)

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      directory: '/tmp/wrk-test',
      worktreeSetup: { status: 'failed', error: 'spawn failed' },
    })
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const app = createTestApp(db)
    const res = await app.request('/repos/abc/workspaces', { method: 'POST' })

    expect(res.status).toBe(400)
  })

  it('returns 404 when the repo is missing or not ready', async () => {
    const app = createTestApp(db)

    const missing = await app.request('/repos/1/workspaces', { method: 'POST' })
    expect(missing.status).toBe(404)

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'cloning', clonedAt: Date.now(), isLocal: true })
    const notReady = await app.request('/repos/1/workspaces', { method: 'POST' })
    expect(notReady.status).toBe(404)
  })

  it('returns 409 on a worktree error', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const client = createStubOpenCodeClient()
    client.api.worktree.create = mock(async () => {
      throw Object.assign(new Error('cannot create'), {
        _tag: 'WorktreeError',
        name: 'WorktreeError',
        data: { message: 'cannot create' },
      })
    }) as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(409)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('cannot create')
  })

  it('returns 500 on an unexpected error', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    const client = createStubOpenCodeClient()
    client.api.location.get = mock(async () => {
      throw new Error('location failed')
    }) as any
    const app = createTestApp(db, client)

    const res = await app.request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(500)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('location failed')
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

  it('returns 400 for a non-numeric repo id', async () => {
    const res = await app.request('/repos/abc', { method: 'PATCH', body: JSON.stringify({ name: 'new-name' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid body', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(400)
  })

  it('returns 500 when reading the repo throws', async () => {
    const res = await createTestApp(createThrowingDb()).request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: 'new-name' }), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/repos/:id', () => {
  let db: Database
  let app: Hono
  let workspacePath: string
  const originalWorkspacePath = process.env.WORKSPACE_PATH

  beforeEach(() => {
    workspacePath = mkdtempSync(path.join(tmpdir(), 'repos-delete-'))
    process.env.WORKSPACE_PATH = workspacePath
    mkdirSync(path.join(workspacePath, 'repos'), { recursive: true })
    db = createTestDb()
    app = createTestApp(db)
  })

  afterEach(() => {
    db.close()
    rmSync(workspacePath, { recursive: true, force: true })
    if (originalWorkspacePath === undefined) {
      delete process.env.WORKSPACE_PATH
    } else {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    }
  })

  it('rejects deleteBranch for a non-worktree repo', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteBranch: 'local' }),
    })

    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Only worktrees can delete their branch')
    expect(getRepoById(db, 1)).not.toBeNull()
  })

  it('deletes a repo with no body and keeps the previous response shape', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(getRepoById(db, 1)).toBeNull()
  })

  it('returns 200 with branch.error when branch cleanup fails after the worktree removal', async () => {
    createRepo(db, {
      localPath: 'wt-missing',
      branch: 'feature',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
      isWorktree: true,
    })

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteBranch: 'local' }),
    })

    expect(res.status).toBe(200)
    const data = await res.json() as { success: boolean; branch?: { name: string; deleted: boolean; remoteDeleted: boolean; error?: string } }
    expect(data.success).toBe(true)
    expect(data.branch?.name).toBe('feature')
    expect(data.branch?.deleted).toBe(false)
    expect(data.branch?.remoteDeleted).toBe(false)
    expect(data.branch?.error).toBeTruthy()
    expect(getRepoById(db, 1)).toBeNull()
  })

  it('returns 400 for an invalid deleteBranch value', async () => {
    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteBranch: 'remote-only' }),
    })

    expect(res.status).toBe(400)
    expect(getRepoById(db, 1)).not.toBeNull()
  })
})
