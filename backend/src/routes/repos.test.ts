import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import { getReposPath } from '@opencode-manager/shared/config/env'
import { RepoSandboxResourcesSchema, type SessionSandboxResources } from '@opencode-manager/shared/schemas'
import { createRepo, getRepoById, getRepoSandboxResources, setRepoSetting } from '../db/queries'
import type { CreateRepoInput } from '../types/repo'
import { createRepoRoutes } from './repos'
import { SandboxRestartError } from '../services/sandbox/runtime'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { createGitService } from '../services/git/GitService'
import { ProjectConfigService } from '../services/project-config'
import { SecretsService } from '../services/secrets'
import { SettingsService } from '../services/settings'
import { RepoWorkspaceService } from '../services/repo-workspace'
import { ScheduleService } from '../services/schedules'
import { ScheduleWorktreeManager } from '../services/schedule-worktree'
import { TerminalService } from '../services/terminal'
import { CredentialProvider } from '../services/credential-provider'
import { createStubRepoEnvService } from '../../test/helpers/stub-repo-env-service'
import type { OpenCodeClient } from '../services/opencode/client'
import { createCommittedRepo, cloneOrigin, createGitAuthService, createOrigin, git } from '../../test/helpers/git-fixtures'
import { createTestDatabase } from '../../test/helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../../test/helpers/test-env'
import { readJson } from '../../test/helpers/read-json'

const SiblingSchema = z.looseObject({
  id: z.number(),
  fullPath: z.string(),
  localPath: z.string(),
  worktreeSource: z.string().optional(),
  currentBranch: z.string().nullable().optional(),
})

const ErrorSchema = z.object({ error: z.string() })

const SuccessSchema = z.object({ success: z.boolean() })

const WorktreeSetupSchema = z.union([
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('started'), repoCommandsSkipped: z.boolean() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
])

const WorkspaceSchema = z.object({ directory: z.string(), worktreeSetup: WorktreeSetupSchema })

const RenamedRepoSchema = z.looseObject({ name: z.string().nullable().optional() })

const DeletedRepoSchema = z.object({
  success: z.boolean(),
  branch: z
    .object({
      name: z.string(),
      deleted: z.boolean(),
      remoteDeleted: z.boolean(),
      error: z.string().optional(),
    })
    .optional(),
})

const jsonHeaders = { 'Content-Type': 'application/json' }

type SandboxRuntimeStub = {
  getCheckoutResources: (
    directory: string,
  ) => Promise<{ effective: SessionSandboxResources; running: SessionSandboxResources | null }>
  restartCheckoutSandbox: (directory: string) => Promise<void>
}

function createSandboxRuntimeStub(): SandboxRuntimeStub {
  return {
    getCheckoutResources: mock(async () => ({ effective: { cpus: 2, memoryMib: 2048 }, running: null })),
    restartCheckoutSandbox: mock(async () => undefined),
  }
}

function createTestApp(
  db: Database,
  openCodeClient: OpenCodeClient = createStubOpenCodeClient(),
  sandboxRuntime: SandboxRuntimeStub = createSandboxRuntimeStub(),
): Hono {
  const gitAuthService = createGitAuthService()
  const terminalService = new TerminalService(
    { client: openCodeClient, baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: false },
    new CredentialProvider(db),
    createStubRepoEnvService(),
  )
  const projectConfigService = new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
  const scheduleService = new ScheduleService(db, openCodeClient, new ScheduleWorktreeManager(gitAuthService, db))
  const repoWorkspaces = new RepoWorkspaceService(
    db,
    openCodeClient,
    gitAuthService,
    projectConfigService,
    terminalService,
    scheduleService,
  )
  const app = new Hono()
  app.route('/repos', createRepoRoutes(
    db,
    gitAuthService,
    scheduleService,
    openCodeClient,
    terminalService,
    projectConfigService,
    repoWorkspaces,
    new SecretsService(db),
    sandboxRuntime,
  ))
  return app
}

function createDistinctRootRepo(dir: string, message: string): void {
  mkdirSync(dir, { recursive: true })
  git(['init', '-b', 'main'], dir)
  git(['config', 'user.email', 'other@test.com'], dir)
  git(['config', 'user.name', 'Other'], dir)
  git(['commit', '--allow-empty', '-m', message], dir)
}

function createThrowingDb(): Database {
  const db = createTestDatabase()
  db.run('DROP TABLE repos')
  return db
}

interface LocalRepoOverrides {
  cloneStatus?: CreateRepoInput['cloneStatus']
  branch?: string
  isWorktree?: boolean
}

function createLocalRepo(db: Database, localPath: string, overrides: LocalRepoOverrides = {}) {
  return createRepo(db, {
    localPath,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
    ...overrides,
  })
}

describe('GET /api/repos/:id/siblings', () => {
  let workspace: TempWorkspace
  let db: Database

  beforeEach(() => {
    workspace = createTempWorkspace('repos-siblings-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  function cloneSharedProject(names: string[]): void {
    const originPath = path.join(workspace.path, 'origin.git')
    const workPath = path.join(workspace.path, 'work')
    createOrigin(originPath, workPath)
    for (const name of names) {
      cloneOrigin(originPath, path.join(getReposPath(), name))
    }
  }

  it('returns siblings including self with currentBranch', async () => {
    cloneSharedProject(['repo-a', 'repo-b', 'repo-c'])
    createDistinctRootRepo(path.join(getReposPath(), 'repo-unrelated'), 'unrelated root')
    for (const name of ['repo-a', 'repo-b', 'repo-c', 'repo-unrelated']) {
      createLocalRepo(db, name)
    }

    const res = await createTestApp(db).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
    expect(data).toHaveLength(3)
    expect(data.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(data.every((entry) => entry.currentBranch === 'main')).toBe(true)
  })

  it('includes OpenCode worktrees that are not manager repo rows', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const worktreeDir = path.join(workspace.path, 'plugin-workspace')
    mkdirSync(worktreeDir, { recursive: true })
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [{ directory: worktreeDir, strategy: 'plugin-strategy' }]),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
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
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const worktreeDir = path.join(workspace.path, 'duplicate-workspace')
    mkdirSync(worktreeDir, { recursive: true })
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [
            { directory: worktreeDir, strategy: 'git' },
            { directory: `${worktreeDir}/`, strategy: 'git' },
          ]),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
    expect(data.filter((entry) => entry.worktreeSource !== undefined)).toHaveLength(1)
  })

  it('excludes a worktree pointing at the repo directory so it cannot be deleted', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const repoDirectory = path.join(getReposPath(), 'repo-a')
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [{ directory: `${repoDirectory}/`, strategy: 'git' }]),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
    expect(data).toHaveLength(1)
    expect(data.some((entry) => entry.worktreeSource !== undefined)).toBe(false)
  })

  it('excludes a worktree that is a git main checkout so the main repo cannot be deleted', async () => {
    const mainRepoDir = path.join(workspace.path, 'main-repo')
    const featureDir = path.join(workspace.path, 'worktrees', 'feature-x')
    createCommittedRepo(mainRepoDir)
    git(['worktree', 'add', featureDir], mainRepoDir)
    createCommittedRepo(path.join(getReposPath(), 'repo-wt'))
    createLocalRepo(db, 'repo-wt')
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [
            { directory: mainRepoDir, strategy: 'git' },
            { directory: featureDir, strategy: 'git' },
          ]),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
    expect(data.some((entry) => entry.fullPath === mainRepoDir)).toBe(false)
    expect(data.some((entry) => entry.fullPath === featureDir)).toBe(true)
  })

  it('excludes repos with non-matching projectID', async () => {
    createDistinctRootRepo(path.join(getReposPath(), 'repo-only'), 'repo-only root')
    createDistinctRootRepo(path.join(getReposPath(), 'repo-other'), 'repo-other root')
    createLocalRepo(db, 'repo-only')
    createLocalRepo(db, 'repo-other')

    const res = await createTestApp(db).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    const data = await readJson(res, z.array(SiblingSchema))
    expect(data).toHaveLength(1)
    expect(data[0]?.id).toBe(1)
  })

  it('returns empty when target has no projectID', async () => {
    mkdirSync(path.join(getReposPath(), 'repo-no-project'), { recursive: true })
    createLocalRepo(db, 'repo-no-project')

    const res = await createTestApp(db).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    expect(await readJson(res, z.array(SiblingSchema))).toEqual([])
  })

  it('returns empty when target cloneStatus !== ready', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-cloning'))
    createLocalRepo(db, 'repo-cloning', { cloneStatus: 'cloning' })

    const res = await createTestApp(db).request('/repos/1/siblings')

    expect(res.status).toBe(200)
    expect(await readJson(res, z.array(SiblingSchema))).toEqual([])
  })

  it('returns empty when target missing', async () => {
    const res = await createTestApp(db).request('/repos/9999/siblings')

    expect(res.status).toBe(200)
    expect(await readJson(res, z.array(SiblingSchema))).toEqual([])
  })

  it('invalid id returns 400', async () => {
    const res = await createTestApp(db).request('/repos/abc/siblings')

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('Invalid repo id')
  })

  it('returns 500 when listing siblings throws', async () => {
    const throwingDb = createThrowingDb()
    try {
      const res = await createTestApp(throwingDb).request('/repos/1/siblings')
      expect(res.status).toBe(500)
    } finally {
      throwingDb.close()
    }
  })
})

describe('DELETE /api/repos/:id/workspaces', () => {
  let workspace: TempWorkspace
  let db: Database

  beforeEach(() => {
    workspace = createTempWorkspace('repos-delete-workspace-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('removes a worktree sibling of the repo', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const worktreeDir = path.join(workspace.path, 'worktree-one')
    mkdirSync(worktreeDir, { recursive: true })
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [{ directory: worktreeDir, strategy: 'git' }]),
          remove,
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ directory: worktreeDir }),
    })

    expect(res.status).toBe(200)
    expect(await readJson(res, SuccessSchema)).toEqual({ success: true })
    expect(remove).toHaveBeenCalledWith({ projectID: 'commit-A', directory: worktreeDir, force: true })
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const res = await createTestApp(db).request('/repos/abc/workspaces', { method: 'DELETE' })

    expect(res.status).toBe(400)
  })

  it('returns 404 when the repo is missing or not ready', async () => {
    const app = createTestApp(db)

    const missing = await app.request('/repos/1/workspaces', { method: 'DELETE' })
    expect(missing.status).toBe(404)

    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a', { cloneStatus: 'cloning' })
    const notReady = await app.request('/repos/1/workspaces', { method: 'DELETE' })
    expect(notReady.status).toBe(404)
  })

  it('returns 400 when the body has no directory', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')

    const res = await createTestApp(db).request('/repos/1/workspaces', { method: 'DELETE' })

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('directory is required')
  })

  it('returns 400 for null, primitive, and array JSON bodies without calling worktree removal', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient({ api: { worktree: { remove } } })
    const app = createTestApp(db, client)

    for (const body of ['null', '42', '"directory"', '[]']) {
      const res = await app.request('/repos/1/workspaces', {
        method: 'DELETE',
        headers: jsonHeaders,
        body,
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBe('directory is required')
    }

    expect(remove).not.toHaveBeenCalled()
  })

  it('returns 400 when directory is missing or not a nonempty string', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const remove = mock(async () => undefined)
    const client = createStubOpenCodeClient({ api: { worktree: { remove } } })
    const app = createTestApp(db, client)

    for (const body of ['{}', '{"directory":42}', '{"directory":""}', '{"directory":"   "}']) {
      const res = await app.request('/repos/1/workspaces', {
        method: 'DELETE',
        headers: jsonHeaders,
        body,
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBe('directory is required')
    }

    expect(remove).not.toHaveBeenCalled()
  })

  it('returns 400 when the directory is not a deletable worktree sibling', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const otherWorktree = path.join(workspace.path, 'other-worktree')
    mkdirSync(otherWorktree, { recursive: true })
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [{ directory: otherWorktree, strategy: 'git' }]),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ directory: path.join(workspace.path, 'unknown-worktree') }),
    })

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('Not a deletable worktree of this repo')
  })

  it('returns 409 with the worktree error message', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const worktreeDir = path.join(workspace.path, 'worktree-one')
    mkdirSync(worktreeDir, { recursive: true })
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          list: mock(async () => [{ directory: worktreeDir, strategy: 'git' }]),
          remove: mock(async () => {
            throw Object.assign(new Error('cannot remove'), {
              _tag: 'WorktreeError',
              name: 'WorktreeError',
              data: { message: 'cannot remove' },
            })
          }),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ directory: worktreeDir }),
    })

    expect(res.status).toBe(409)
    expect((await readJson(res, ErrorSchema)).error).toBe('cannot remove')
  })

  it('returns 500 when reading the repo throws', async () => {
    const throwingDb = createThrowingDb()
    try {
      const res = await createTestApp(throwingDb).request('/repos/1/workspaces', {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: path.join(workspace.path, 'worktree-one') }),
      })
      expect(res.status).toBe(500)
    } finally {
      throwingDb.close()
    }
  })
})

describe('POST /api/repos/:id/workspaces', () => {
  let workspace: TempWorkspace
  let db: Database

  beforeEach(() => {
    workspace = createTempWorkspace('repos-create-workspace-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('creates a worktree through the V2 API', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const create = mock(async () => ({ directory: '/tmp/wrk-test' }))
    const client = createStubOpenCodeClient({ api: { worktree: { create } } })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await readJson(res, WorkspaceSchema)).toEqual({ directory: '/tmp/wrk-test', worktreeSetup: { status: 'none' } })
    expect(create).toHaveBeenCalledWith({ projectID: 'commit-A' })
  })

  it('still returns 200 with a failed worktree setup when the setup terminal cannot start', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    setRepoSetting(db, 1, 'worktreeSetupCommands', JSON.stringify(['pnpm install']))
    const client = createStubOpenCodeClient({
      api: {
        worktree: { create: mock(async () => ({ directory: '/tmp/wrk-test' })) },
        pty: {
          create: mock(async () => {
            throw new Error('spawn failed')
          }),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await readJson(res, WorkspaceSchema)).toEqual({
      directory: '/tmp/wrk-test',
      worktreeSetup: { status: 'failed', error: 'spawn failed' },
    })
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const res = await createTestApp(db).request('/repos/abc/workspaces', { method: 'POST' })

    expect(res.status).toBe(400)
  })

  it('returns 404 when the repo is missing or not ready', async () => {
    const app = createTestApp(db)

    const missing = await app.request('/repos/1/workspaces', { method: 'POST' })
    expect(missing.status).toBe(404)

    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a', { cloneStatus: 'cloning' })
    const notReady = await app.request('/repos/1/workspaces', { method: 'POST' })
    expect(notReady.status).toBe(404)
  })

  it('returns 409 on a worktree error', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const client = createStubOpenCodeClient({
      api: {
        worktree: {
          create: mock(async () => {
            throw Object.assign(new Error('cannot create'), {
              _tag: 'WorktreeError',
              name: 'WorktreeError',
              data: { message: 'cannot create' },
            })
          }),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(409)
    expect((await readJson(res, ErrorSchema)).error).toBe('cannot create')
  })

  it('returns 500 on an unexpected error', async () => {
    createCommittedRepo(path.join(getReposPath(), 'repo-a'))
    createLocalRepo(db, 'repo-a')
    const client = createStubOpenCodeClient({
      api: {
        location: {
          get: mock(async () => {
            throw new Error('location failed')
          }),
        },
      },
    })

    const res = await createTestApp(db, client).request('/repos/1/workspaces', { method: 'POST' })

    expect(res.status).toBe(500)
    expect((await readJson(res, ErrorSchema)).error).toBe('location failed')
  })
})

describe('PATCH /api/repos/:id', () => {
  let workspace: TempWorkspace
  let db: Database
  let app: Hono

  beforeEach(() => {
    workspace = createTempWorkspace('repos-rename-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
    app = createTestApp(db)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  function seedRenamableRepo(): void {
    mkdirSync(path.join(getReposPath(), 'repo-a'), { recursive: true })
    createLocalRepo(db, 'repo-a')
  }

  it('sets a custom name on a ready repo', async () => {
    seedRenamableRepo()

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: 'My Fork' }), headers: jsonHeaders })

    expect(res.status).toBe(200)
    expect((await readJson(res, RenamedRepoSchema)).name).toBe('My Fork')
    expect(getRepoById(db, 1)?.name).toBe('My Fork')
  })

  it('clears a custom name (reverts to derived)', async () => {
    seedRenamableRepo()
    await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: 'My Fork' }), headers: jsonHeaders })

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: '' }), headers: jsonHeaders })

    expect(res.status).toBe(200)
    expect((await readJson(res, RenamedRepoSchema)).name).toBeUndefined()
    expect(getRepoById(db, 1)?.name).toBeUndefined()
  })

  it('trims whitespace from the name', async () => {
    seedRenamableRepo()

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({ name: '  Spaced  ' }), headers: jsonHeaders })

    expect(res.status).toBe(200)
    expect((await readJson(res, RenamedRepoSchema)).name).toBe('Spaced')
  })

  it('returns 404 for non-existent repo', async () => {
    const res = await app.request('/repos/999999', { method: 'PATCH', body: JSON.stringify({ name: 'Test' }), headers: jsonHeaders })

    expect(res.status).toBe(404)
    expect((await readJson(res, ErrorSchema)).error).toBe('Repo not found')
  })

  it('returns 400 for assistant repo', async () => {
    const res = await app.request('/repos/0', { method: 'PATCH', body: JSON.stringify({ name: 'Test' }), headers: jsonHeaders })

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('Assistant repository cannot be renamed')
  })

  it('returns 400 for name exceeding 100 characters', async () => {
    seedRenamableRepo()

    const res = await app.request('/repos/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'a'.repeat(101) }),
      headers: jsonHeaders,
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const res = await app.request('/repos/abc', { method: 'PATCH', body: JSON.stringify({ name: 'new-name' }), headers: jsonHeaders })

    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid body', async () => {
    seedRenamableRepo()

    const res = await app.request('/repos/1', { method: 'PATCH', body: JSON.stringify({}), headers: jsonHeaders })

    expect(res.status).toBe(400)
  })

  it('returns 500 when reading the repo throws', async () => {
    const throwingDb = createThrowingDb()
    try {
      const res = await createTestApp(throwingDb).request('/repos/1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'new-name' }),
        headers: jsonHeaders,
      })
      expect(res.status).toBe(500)
    } finally {
      throwingDb.close()
    }
  })
})

describe('DELETE /api/repos/:id', () => {
  let workspace: TempWorkspace
  let db: Database
  let app: Hono

  beforeEach(() => {
    workspace = createTempWorkspace('repos-delete-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
    app = createTestApp(db)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('rejects deleteBranch for a non-worktree repo', async () => {
    mkdirSync(path.join(getReposPath(), 'repo-a'), { recursive: true })
    createLocalRepo(db, 'repo-a')

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ deleteBranch: 'local' }),
    })

    expect(res.status).toBe(400)
    expect((await readJson(res, ErrorSchema)).error).toBe('Only worktrees can delete their branch')
    expect(getRepoById(db, 1)).not.toBeNull()
  })

  it('deletes a repo with no body and keeps the previous response shape', async () => {
    mkdirSync(path.join(getReposPath(), 'repo-a'), { recursive: true })
    createLocalRepo(db, 'repo-a')

    const res = await app.request('/repos/1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson(res, DeletedRepoSchema)).toEqual({ success: true })
    expect(getRepoById(db, 1)).toBeNull()
  })

  it('returns 200 with branch.error when branch cleanup fails after the worktree removal', async () => {
    createLocalRepo(db, 'wt-missing', {
      branch: 'feature',
      isWorktree: true,
    })

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ deleteBranch: 'local' }),
    })

    expect(res.status).toBe(200)
    const data = await readJson(res, DeletedRepoSchema)
    expect(data.success).toBe(true)
    expect(data.branch?.name).toBe('feature')
    expect(data.branch?.deleted).toBe(false)
    expect(data.branch?.remoteDeleted).toBe(false)
    expect(data.branch?.error).toBeTruthy()
    expect(getRepoById(db, 1)).toBeNull()
  })

  it('returns 400 for an invalid deleteBranch value', async () => {
    mkdirSync(path.join(getReposPath(), 'repo-a'), { recursive: true })
    createLocalRepo(db, 'repo-a')

    const res = await app.request('/repos/1', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ deleteBranch: 'remote-only' }),
    })

    expect(res.status).toBe(400)
    expect(getRepoById(db, 1)).not.toBeNull()
  })
})

describe('repo sandbox resources', () => {
  let workspace: TempWorkspace
  let db: Database

  beforeEach(() => {
    workspace = createTempWorkspace('repos-sandbox-resources-')
    db = createTestDatabase()
    mkdirSync(getReposPath(), { recursive: true })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  function enableSandboxing(): void {
    new SettingsService(db).updateSettings({ sandbox: { enabled: true } })
  }

  function seedRepoTarget(name: string) {
    mkdirSync(path.join(getReposPath(), name), { recursive: true })
    return createLocalRepo(db, name)
  }

  describe('GET /api/repos/:id/sandbox/resources', () => {
    it('returns 404 for an unknown repo', async () => {
      const res = await createTestApp(db).request('/repos/999/sandbox/resources')

      expect(res.status).toBe(404)
      expect((await readJson(res, ErrorSchema)).error).toBe('Repo not found')
    })

    it('returns 409 when sandboxing is disabled', async () => {
      seedRepoTarget('repo-a')

      const res = await createTestApp(db).request('/repos/1/sandbox/resources')

      expect(res.status).toBe(409)
      expect((await readJson(res, ErrorSchema)).error).toBe('Sandboxing is not enabled for this server')
    })

    it('returns the override, effective and running resources', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/resources')

      expect(res.status).toBe(200)
      expect(await readJson(res, RepoSandboxResourcesSchema)).toEqual({
        override: null,
        effective: { cpus: 2, memoryMib: 2048 },
        running: null,
      })
      expect(runtime.getCheckoutResources).toHaveBeenCalledWith(repo.fullPath)
    })

    it('returns the stored override', async () => {
      seedRepoTarget('repo-a')
      enableSandboxing()
      const override = { cpus: 2, memoryMib: 2048 }
      const app = createTestApp(db)
      await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(override),
      })

      const res = await app.request('/repos/1/sandbox/resources')

      expect(res.status).toBe(200)
      expect((await readJson(res, RepoSandboxResourcesSchema)).override).toEqual(override)
    })

    it('returns 400 when the directory belongs to another repo', async () => {
      seedRepoTarget('repo-a')
      seedRepoTarget('repo-b')
      enableSandboxing()
      const directory = path.join(getReposPath(), 'repo-b')

      const res = await createTestApp(db).request(
        `/repos/1/sandbox/resources?directory=${encodeURIComponent(directory)}`,
      )

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBe('directory does not belong to this repository')
    })
  })

  describe('PUT /api/repos/:id/sandbox/resources', () => {
    it('stores and returns the override', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()
      const override = { cpus: 2, memoryMib: 2048 }

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(override),
      })

      expect(res.status).toBe(200)
      expect(await readJson(res, RepoSandboxResourcesSchema)).toEqual({
        override,
        effective: { cpus: 2, memoryMib: 2048 },
        running: null,
      })
      expect(getRepoSandboxResources(db, repo.id)).toEqual(override)
      expect(runtime.getCheckoutResources).toHaveBeenCalledWith(repo.fullPath)
    })

    it('rejects cpus above the host limit and keeps the stored override', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const stored = { cpus: 2, memoryMib: 2048 }
      const app = createTestApp(db)
      await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(stored),
      })

      const res = await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: os.availableParallelism() + 1, memoryMib: 2048 }),
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBeTruthy()
      expect(getRepoSandboxResources(db, repo.id)).toEqual(stored)
    })

    it('rejects memory above the host limit and keeps the stored override', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const stored = { cpus: 2, memoryMib: 2048 }
      const app = createTestApp(db)
      await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(stored),
      })

      const res = await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: 2, memoryMib: Math.floor(os.totalmem() / 1048576) + 1024 }),
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBeTruthy()
      expect(getRepoSandboxResources(db, repo.id)).toEqual(stored)
    })

    it('returns 400 for an invalid body', async () => {
      seedRepoTarget('repo-a')
      enableSandboxing()

      const res = await createTestApp(db).request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: 0, memoryMib: 1024 }),
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBeTruthy()
    })

    it('clears the stored override when the body is null', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const app = createTestApp(db)
      await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: 2, memoryMib: 2048 }),
      })

      const res = await app.request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: 'null',
      })

      expect(res.status).toBe(200)
      expect((await readJson(res, RepoSandboxResourcesSchema)).override).toBeNull()
      expect(getRepoSandboxResources(db, repo.id)).toBeNull()
    })

    it('returns 404 for an unknown repo and 409 when sandboxing is disabled', async () => {
      const missing = await createTestApp(db).request('/repos/999/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: 2, memoryMib: 2048 }),
      })
      expect(missing.status).toBe(404)

      seedRepoTarget('repo-a')
      const disabled = await createTestApp(db).request('/repos/1/sandbox/resources', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ cpus: 2, memoryMib: 2048 }),
      })
      expect(disabled.status).toBe(409)
    })
  })

  describe('POST /api/repos/:id/sandbox/restart', () => {
    it('restarts the checkout sandbox and returns 204', async () => {
      const repo = seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
      })

      expect(res.status).toBe(204)
      expect(runtime.restartCheckoutSandbox).toHaveBeenCalledWith(repo.fullPath)
    })

    it('restarts the same-repo directory passed in the body', async () => {
      const alternateDirectory = path.join(workspace.path, 'alternate-checkout')
      createRepo(db, {
        localPath: 'repo-a',
        sourcePath: alternateDirectory,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isLocal: true,
      })
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()
      const directory = path.join(getReposPath(), 'repo-a')

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory }),
      })

      expect(res.status).toBe(204)
      expect(runtime.restartCheckoutSandbox).toHaveBeenCalledWith(directory)
    })

    it('returns 400 when the directory belongs to another repo', async () => {
      seedRepoTarget('repo-a')
      seedRepoTarget('repo-b')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: path.join(getReposPath(), 'repo-b') }),
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBe('directory does not belong to this repository')
      expect(runtime.restartCheckoutSandbox).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown repo and 409 when sandboxing is disabled', async () => {
      const missing = await createTestApp(db).request('/repos/999/sandbox/restart', { method: 'POST' })
      expect(missing.status).toBe(404)

      seedRepoTarget('repo-a')
      const disabled = await createTestApp(db).request('/repos/1/sandbox/restart', { method: 'POST' })
      expect(disabled.status).toBe(409)
    })

    it('maps an unavailable sandbox runtime to 409', async () => {
      seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()
      runtime.restartCheckoutSandbox = mock(async () => {
        throw new SandboxRestartError('The sandbox runtime is unavailable on this host', 409)
      })

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
      })

      expect(res.status).toBe(409)
      expect((await readJson(res, ErrorSchema)).error).toBe('The sandbox runtime is unavailable on this host')
    })

    it('maps an unresolvable repository checkout to 400', async () => {
      seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()
      runtime.restartCheckoutSandbox = mock(async () => {
        throw new SandboxRestartError('Could not resolve the repository checkout for /workspace/repos/repo-a', 400)
      })

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
      })

      expect(res.status).toBe(400)
      expect((await readJson(res, ErrorSchema)).error).toBe(
        'Could not resolve the repository checkout for /workspace/repos/repo-a',
      )
    })

    it('keeps an unexpected restart failure at 500', async () => {
      seedRepoTarget('repo-a')
      enableSandboxing()
      const runtime = createSandboxRuntimeStub()
      runtime.restartCheckoutSandbox = mock(async () => {
        throw new Error('msb rm failed with code 1: operation not permitted')
      })

      const res = await createTestApp(db, createStubOpenCodeClient(), runtime).request('/repos/1/sandbox/restart', {
        method: 'POST',
      })

      expect(res.status).toBe(500)
      expect((await readJson(res, ErrorSchema)).error).toBe('msb rm failed with code 1: operation not permitted')
    })
  })
})
