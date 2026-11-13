import path from 'node:path'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { isWorktreeSibling, type RepoSibling } from '@opencode-manager/shared/utils'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'
import { createScheduleRun, updateScheduleRunWorktree } from '../../src/db/schedules'
import { getRepoByLocalPath } from '../../src/db/queries'
import {
  discoverLocalRepos,
  getSiblingRepos,
  initLocalRepo,
  listRepoSiblings,
  relinkReposFromSessionDirectories,
  resolveRepoForDirectory,
} from '../../src/services/repo'
import { cloneOrigin, createCommittedRepo, createGitAuthService, createOrigin, git } from '../helpers/git-fixtures'
import { createStubOpenCodeClient, type OpenCodeApiOverrides } from '../helpers/stub-opencode-client'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

interface WorktreeEntry {
  directory: string
  strategy?: string
}

const gitAuthService = createGitAuthService()

describe('repo service', () => {
  let workspace: TempWorkspace
  let db: Database

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-repo-service-')
    db = createTestDatabase()
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('creates a new empty git repo for a relative path', async () => {
    const result = await initLocalRepo(db, gitAuthService, 'my-new-repo')

    expect(result.cloneStatus).toBe('ready')
    expect(result.fullPath).toBe(path.join(getReposPath(), 'my-new-repo'))
    expect(git(['rev-parse', '--git-dir'], result.fullPath)).toBe('.git')
    expect(getRepoByLocalPath(db, 'my-new-repo')?.cloneStatus).toBe('ready')
  })

  it('links an absolute git repo in place and preserves its source path', async () => {
    const sourcePath = path.join(workspace.path, 'outside', 'existing-repo')
    createCommittedRepo(sourcePath)

    const result = await initLocalRepo(db, gitAuthService, sourcePath)

    expect(result.localPath).toBe('existing-repo')
    expect(result.sourcePath).toBe(sourcePath)
    expect(result.fullPath).toBe(sourcePath)
    expect(result.cloneStatus).toBe('ready')
    expect(lstatSync(path.join(getReposPath(), 'existing-repo')).isSymbolicLink()).toBe(true)
    expect(lstatSync(path.join(getReposPath(), 'existing-repo', '.git')).isDirectory()).toBe(true)
  })

  it('discovers nested repos and keeps existing registrations', async () => {
    const rootPath = path.join(workspace.path, 'projects')
    const appOne = path.join(rootPath, 'app-one')
    const appTwo = path.join(rootPath, 'nested', 'app-two')
    createCommittedRepo(appOne)
    createCommittedRepo(appTwo)
    const existing = seedRepo(db, { localPath: 'app-two', sourcePath: appTwo, isLocal: true, isWorktree: true })

    const result = await discoverLocalRepos(db, gitAuthService, rootPath)

    expect(result.discoveredCount).toBe(1)
    expect(result.existingCount).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.repos.map((repo) => repo.fullPath)).toEqual([appOne, existing.fullPath])
    expect(lstatSync(path.join(getReposPath(), 'app-one')).isSymbolicLink()).toBe(true)
  })

  it('continues discovery when a nested directory cannot be read', async () => {
    const rootPath = path.join(workspace.path, 'projects')
    const appOne = path.join(rootPath, 'app-one')
    const restricted = path.join(rootPath, 'restricted')
    createCommittedRepo(appOne)
    mkdirSync(restricted, { recursive: true })
    chmodSync(restricted, 0o111)

    try {
      const result = await discoverLocalRepos(db, gitAuthService, rootPath)

      expect(result.discoveredCount).toBe(1)
      expect(result.existingCount).toBe(0)
      expect(result.repos.map((repo) => repo.fullPath)).toEqual([appOne])
      expect(result.errors).toEqual([{ path: restricted, error: expect.stringContaining('EACCES') }])
    } finally {
      chmodSync(restricted, 0o755)
    }
  })

  it('relinks imported session directories to nearest git repo roots', async () => {
    const repoRoot = path.join(workspace.path, 'projects', 'app-one')
    const webDirectory = path.join(repoRoot, 'apps', 'web')
    const apiDirectory = path.join(repoRoot, 'packages', 'api')
    const nonRepoDirectory = path.join(workspace.path, 'projects', 'not-a-repo')
    createCommittedRepo(repoRoot)
    mkdirSync(webDirectory, { recursive: true })
    mkdirSync(apiDirectory, { recursive: true })
    mkdirSync(nonRepoDirectory, { recursive: true })

    const result = await relinkReposFromSessionDirectories(db, gitAuthService, [
      webDirectory,
      apiDirectory,
      nonRepoDirectory,
    ])

    expect(result.relinkedCount).toBe(1)
    expect(result.existingCount).toBe(0)
    expect(result.nonRepoPathCount).toBe(1)
    expect(result.duplicatePathCount).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.repos.map((repo) => repo.fullPath)).toEqual([repoRoot])
  })
})

describe('getSiblingRepos worktree API', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let originPath: string

  function worktreeDirectory(name: string): string {
    const directory = path.join(workspace.path, 'worktrees', name)
    mkdirSync(directory, { recursive: true })
    return directory
  }

  function createClient(overrides: {
    worktrees?: WorktreeEntry[]
    list?: () => Promise<WorktreeEntry[]>
    locationGet?: OpenCodeApi['location']['get']
  } = {}): OpenCodeClient {
    const list = overrides.list ?? (async () => overrides.worktrees ?? [])
    const api: OpenCodeApiOverrides = { worktree: { list } }
    if (overrides.locationGet) {
      api.location = { get: overrides.locationGet }
    }
    return createStubOpenCodeClient({ api })
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-repo-siblings-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, 'origin.git')
    createOrigin(originPath, path.join(workspace.path, 'seed'))
    repo = seedRepo(db, { localPath: 'repo-a' })
    cloneOrigin(originPath, repo.fullPath)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('skips worktrees OpenCode still records but that no longer exist on disk', async () => {
    const featureWorktree = worktreeDirectory('feature-x')
    const client = createClient({
      worktrees: [
        { directory: path.join(workspace.path, 'worktrees', 'removed-run'), strategy: 'git' },
        { directory: featureWorktree, strategy: 'git' },
      ],
    })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings.filter((sibling) => sibling.id === -1).map((sibling) => sibling.fullPath)).toEqual([featureWorktree])
  })

  it('maps worktree entries to worktree siblings', async () => {
    const featureWorktree = worktreeDirectory('feature-x')
    const client = createClient({ worktrees: [{ directory: featureWorktree, strategy: 'git' }] })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings).toHaveLength(2)
    expect(siblings[1]).toMatchObject({
      id: -1,
      fullPath: featureWorktree,
      localPath: 'feature-x',
      worktreeSource: 'opencode',
    })
    expect(siblings[1]?.branch).toBeUndefined()
    expect(siblings[1]?.currentBranch).toBeUndefined()
  })

  it('excludes the target repo, repos root, known siblings, and main checkouts', async () => {
    const repoB = path.join(getReposPath(), 'repo-b')
    cloneOrigin(originPath, repoB)
    seedRepo(db, { localPath: 'repo-b' })
    const mainCheckout = path.join(workspace.path, 'worktrees', 'main-checkout')
    cloneOrigin(originPath, mainCheckout)
    const featureWorktree = worktreeDirectory('feature-x')
    mkdirSync(getReposPath(), { recursive: true })
    const client = createClient({
      worktrees: [
        { directory: repo.fullPath, strategy: 'git' },
        { directory: getReposPath(), strategy: 'git' },
        { directory: repoB, strategy: 'git' },
        { directory: mainCheckout, strategy: 'git' },
        { directory: featureWorktree, strategy: 'git' },
      ],
    })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings).toHaveLength(3)
    expect(siblings.filter((sibling) => sibling.id === -1).map((sibling) => sibling.fullPath)).toEqual([featureWorktree])
  })

  it('marks an active schedule run worktree as an in-use schedule worktree', async () => {
    const activeWorktree = worktreeDirectory('active-run')
    const featureWorktree = worktreeDirectory('feature-x')
    const job = seedScheduleJob(db, repo.id, { name: 'nightly' })
    const run = createScheduleRun(db, {
      jobId: job.id,
      repoId: repo.id,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunWorktree(db, repo.id, job.id, run.id, { worktreePath: activeWorktree })
    const client = createClient({
      worktrees: [
        { directory: activeWorktree, strategy: 'git' },
        { directory: featureWorktree, strategy: 'git' },
      ],
    })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings).toHaveLength(3)
    expect(siblings[1]).toMatchObject({
      fullPath: activeWorktree,
      worktreeSource: 'schedule',
      schedule: { repoId: repo.id, jobId: job.id, runId: run.id, inUse: true, name: 'nightly' },
    })
    expect(siblings[2]).toMatchObject({ fullPath: featureWorktree, worktreeSource: 'opencode' })
  })

  it('returns only repo siblings when the location lookup rejects', async () => {
    const client = createClient({
      locationGet: async () => {
        throw new Error('location unavailable')
      },
    })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings).toHaveLength(1)
    expect(siblings[0]?.id).toBe(repo.id)
  })

  it('returns only repo siblings when the worktree list rejects', async () => {
    const client = createClient({
      list: async () => {
        throw new Error('worktree list unavailable')
      },
    })

    const siblings = await getSiblingRepos(db, repo.id, {}, client)

    expect(siblings).toHaveLength(1)
    expect(siblings[0]?.id).toBe(repo.id)
  })

  describe('listRepoSiblings', () => {
    it('returns every sibling without branch resolution when no filter is given', async () => {
      const featureWorktree = worktreeDirectory('feature-x')
      const client = createClient({ worktrees: [{ directory: featureWorktree, strategy: 'git' }] })

      const siblings: RepoSibling[] = await listRepoSiblings(db, repo.id, {}, client)

      expect(siblings.map((sibling) => sibling.fullPath)).toEqual([repo.fullPath, featureWorktree])
      expect(siblings.every((sibling) => sibling.currentBranch === undefined)).toBe(true)
    })

    it('applies the filter to the listed siblings', async () => {
      const firstWorktree = worktreeDirectory('feature-x')
      const secondWorktree = worktreeDirectory('feature-y')
      const client = createClient({
        worktrees: [
          { directory: firstWorktree, strategy: 'git' },
          { directory: secondWorktree, strategy: 'git' },
        ],
      })

      const siblings = await listRepoSiblings(db, repo.id, {}, client, isWorktreeSibling)

      expect(siblings.map((sibling) => sibling.fullPath)).toEqual([firstWorktree, secondWorktree])
    })
  })
})

describe('resolveRepoForDirectory', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let originPath: string

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-resolve-repo-')
    db = createTestDatabase()
    originPath = path.join(workspace.path, 'origin.git')
    createOrigin(originPath, path.join(workspace.path, 'seed'))
    repo = seedRepo(db, { localPath: 'repo-a' })
    cloneOrigin(originPath, repo.fullPath)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('resolves a workspace directory that shares a repo OpenCode project id', async () => {
    const worktreePath = path.join(workspace.path, 'worktrees', 'feature-x')
    mkdirSync(path.dirname(worktreePath), { recursive: true })
    git(['worktree', 'add', '-b', 'feature/x', worktreePath], repo.fullPath)

    await expect(resolveRepoForDirectory(db, worktreePath)).resolves.toEqual(repo)
  })

  it('returns null for a matching project id that is not the registered checkout', async () => {
    const clonePath = path.join(workspace.path, 'clones', 'repo-a')
    cloneOrigin(originPath, clonePath)

    await expect(resolveRepoForDirectory(db, clonePath)).resolves.toBeNull()
  })

  it('returns null for a directory that matches no repo', async () => {
    mkdirSync(path.join(workspace.path, 'unknown', 'directory'), { recursive: true })

    await expect(resolveRepoForDirectory(db, path.join(workspace.path, 'unknown', 'directory'))).resolves.toBeNull()
  })
})
