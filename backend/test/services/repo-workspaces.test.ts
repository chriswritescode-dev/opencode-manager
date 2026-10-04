import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { Repo } from '../../src/types/repo'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

const executeCommand = vi.fn()
const listRepos = vi.fn()
const resolveProjectId = vi.fn()
const isGitMainCheckout = vi.fn()
const getSettings = vi.fn()
const mkdirSafe = vi.fn()

vi.mock('../../src/utils/fs-safe', () => ({
  mkdirSafe,
  mkdirSyncSafe: vi.fn(),
  canonicalPathSync: (target: string) => target,
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({ getSettings })),
}))

vi.mock('../../src/services/project-id-resolver', () => ({
  resolveProjectId,
  isGitMainCheckout,
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../src/db/queries', () => ({
  listRepos,
}))

describe('repo workspace service', () => {
  type WorktreeEntry = { directory: string; strategy?: string }

  let db: Database

  function createRepoRow(id: number, localPath: string, overrides: Partial<Repo> = {}): Repo {
    return {
      id,
      repoUrl: 'https://github.com/test/repo',
      localPath,
      fullPath: path.join(getReposPath(), localPath),
      sourcePath: path.join(getReposPath(), localPath),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      ...overrides,
    }
  }

  function createClient(worktrees: WorktreeEntry[], overrides: {
    create?: OpenCodeClient['api']['worktree']['create']
    remove?: OpenCodeClient['api']['worktree']['remove']
  } = {}): OpenCodeClient {
    return {
      api: {
        location: {
          get: async () => ({
            directory: path.join(getReposPath(), 'repo-a'),
            project: { id: 'commit-A', directory: path.join(getReposPath(), 'repo-a'), canonical: path.join(getReposPath(), 'repo-a') },
          }),
        },
        worktree: {
          list: async () => worktrees,
          create: overrides.create ?? (async () => ({ directory: '/worktrees/feature-x' })),
          remove: overrides.remove ?? (async () => undefined),
        },
      },
    } as unknown as OpenCodeClient
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mkdirSafe.mockResolvedValue(undefined)
    db = new Database(':memory:')
    migrate(db, allMigrations)
    getSettings.mockReturnValue({ preferences: { repoOrder: [] }, updatedAt: Date.now() })
    resolveProjectId.mockResolvedValue('commit-A')
    isGitMainCheckout.mockResolvedValue(false)
    listRepos.mockReturnValue([createRepoRow(1, 'repo-a')])
    executeCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('HEAD') && !args.includes('--abbrev-ref')) {
        return 'abc123'
      }

      if (args.includes('--abbrev-ref')) {
        return 'main'
      }

      return ''
    })
  })

  afterEach(() => {
    db.close()
  })

  it('passes name and ref through to the worktree create call', async () => {
    const { createRepoWorkspace } = await import('../../src/services/repo')
    const create = vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
    const client = createClient([], { create })

    const result = await createRepoWorkspace(client, createRepoRow(1, 'repo-a'), { name: 'feature-x', ref: 'feature/x' })

    expect(create).toHaveBeenCalledWith({ projectID: 'commit-A', name: 'feature-x', branch: 'feature/x' })
    expect(result).toEqual({ directory: '/worktrees/feature-x' })
  })

  it('creates a worktree without optional options', async () => {
    const { createRepoWorkspace } = await import('../../src/services/repo')
    const create = vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
    const client = createClient([], { create })

    await createRepoWorkspace(client, createRepoRow(1, 'repo-a'))

    expect(create).toHaveBeenCalledWith({ projectID: 'commit-A' })
  })

  it('rejects a directory that is not a worktree sibling of the repo', async () => {
    const { removeRepoWorkspace, RepoWorkspaceError } = await import('../../src/services/repo')
    const client = createClient([{ directory: '/worktrees/feature-x', strategy: 'git' }])

    const error = await removeRepoWorkspace(db, client, {}, createRepoRow(1, 'repo-a'), '/worktrees/unknown').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RepoWorkspaceError)
    expect(error).toMatchObject({ status: 400 })
  })

  it('removes a matching worktree sibling with force', async () => {
    const { removeRepoWorkspace } = await import('../../src/services/repo')
    const remove = vi.fn(async () => undefined)
    const client = createClient([{ directory: '/worktrees/feature-x', strategy: 'git' }], { remove })

    await removeRepoWorkspace(db, client, {}, createRepoRow(1, 'repo-a'), '/worktrees/feature-x')

    expect(remove).toHaveBeenCalledWith({ projectID: 'commit-A', directory: '/worktrees/feature-x', force: true })
  })
})
