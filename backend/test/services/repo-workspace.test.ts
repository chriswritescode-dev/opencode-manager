import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { ProjectConfigService } from '../../src/services/project-config'
import type { TerminalService } from '../../src/services/terminal'
import { RepoWorkspaceError } from '../../src/services/repo'
import { RepoWorkspaceService } from '../../src/services/repo-workspace'

const mocks = vi.hoisted(() => ({
  listRepoSiblings: vi.fn(),
  resolveRepoProjectId: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: mocks.loggerWarn,
  },
}))

vi.mock('../../src/services/repo', () => {
  class MockRepoWorkspaceError extends Error {
    readonly status = 400

    constructor(message: string) {
      super(message)
      this.name = 'RepoWorkspaceError'
    }
  }

  return {
    listRepoSiblings: async (
      _database: unknown,
      _repoId: unknown,
      _gitEnv: unknown,
      _client: unknown,
      filter?: (sibling: { worktreeSource?: string }) => boolean,
    ) => {
      const siblings = await mocks.listRepoSiblings() as Array<{ worktreeSource?: string }>
      return filter ? siblings.filter(filter) : siblings
    },
    resolveRepoProjectId: mocks.resolveRepoProjectId,
    findSiblingByDirectory: <T extends { fullPath: string }>(siblings: T[], directory: string): T | undefined =>
      siblings.find((sibling) => sibling.fullPath === directory),
    RepoWorkspaceError: MockRepoWorkspaceError,
  }
})

const REPO: Repo = {
  id: 1,
  localPath: 'repo-a',
  fullPath: '/repos/repo-a',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
} as Repo

const gitAuthService = { getGitEnvironment: () => ({}) } as unknown as GitAuthService

function createService(overrides: {
  worktreeCreate?: ReturnType<typeof vi.fn>
  worktreeRemove?: ReturnType<typeof vi.fn>
  runWorktreeSetupForRepo?: ReturnType<typeof vi.fn>
  removeAll?: ReturnType<typeof vi.fn>
}) {
  const worktreeCreate = overrides.worktreeCreate ?? vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
  const worktreeRemove = overrides.worktreeRemove ?? vi.fn(async () => undefined)
  const runWorktreeSetupForRepo =
    overrides.runWorktreeSetupForRepo ?? vi.fn(async () => ({ status: 'started' as const }))
  const removeAll = overrides.removeAll ?? vi.fn(async () => undefined)

  const openCodeClient = {
    api: { worktree: { create: worktreeCreate, remove: worktreeRemove } },
  } as unknown as OpenCodeClient
  const projectConfigService = { runWorktreeSetupForRepo } as unknown as ProjectConfigService
  const terminalService = { removeAll } as unknown as TerminalService
  const removeScheduleWorktrees = vi.fn(async () => ({ removed: 1 }))

  return {
    service: new RepoWorkspaceService(
      {} as Database,
      openCodeClient,
      gitAuthService,
      projectConfigService,
      terminalService,
      { removeWorktrees: removeScheduleWorktrees },
    ),
    removeScheduleWorktrees,
    worktreeCreate,
    worktreeRemove,
    runWorktreeSetupForRepo,
    removeAll,
    terminalService,
  }
}

describe('RepoWorkspaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveRepoProjectId.mockResolvedValue('project-1')
    mocks.listRepoSiblings.mockResolvedValue([])
  })

  describe('create', () => {
    it('creates the worktree with projectID, name and branch and runs the setup', async () => {
      const worktreeCreate = vi.fn(async () => ({ directory: '/worktrees/feature-x', branch: 'feature/x' }))
      const runWorktreeSetupForRepo = vi.fn(async () => ({ status: 'started' as const }))
      const { service, terminalService } = createService({ worktreeCreate, runWorktreeSetupForRepo })

      const result = await service.create(REPO, { name: 'feature-x', ref: 'feature/x' })

      expect(worktreeCreate).toHaveBeenCalledWith({
        projectID: 'project-1',
        name: 'feature-x',
        branch: 'feature/x',
      })
      expect(runWorktreeSetupForRepo).toHaveBeenCalledWith(REPO, '/worktrees/feature-x', terminalService)
      expect(result).toEqual({
        directory: '/worktrees/feature-x',
        branch: 'feature/x',
        worktreeSetup: { status: 'started' },
      })
    })

    it('creates the worktree without optional options', async () => {
      const worktreeCreate = vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
      const { service } = createService({ worktreeCreate })

      await service.create(REPO)

      expect(worktreeCreate).toHaveBeenCalledWith({ projectID: 'project-1' })
    })

    it('runs the initializer before the worktree setup', async () => {
      const order: string[] = []
      const worktreeCreate = vi.fn(async () => {
        order.push('create')
        return { directory: '/worktrees/feature-x' }
      })
      const initialize = vi.fn(async () => {
        order.push('initialize')
      })
      const runWorktreeSetupForRepo = vi.fn(async () => {
        order.push('setup')
        return { status: 'started' as const }
      })
      const { service } = createService({ worktreeCreate, runWorktreeSetupForRepo })

      await service.create(REPO, { initialize })

      expect(initialize).toHaveBeenCalledWith('/worktrees/feature-x')
      expect(order).toEqual(['create', 'initialize', 'setup'])
    })

    it('removes the worktree and rethrows when the initializer fails, without running the setup', async () => {
      const initializeError = new Error('seed failed')
      const worktreeCreate = vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
      const worktreeRemove = vi.fn(async () => undefined)
      const initialize = vi.fn(async () => {
        throw initializeError
      })
      const runWorktreeSetupForRepo = vi.fn(async () => ({ status: 'started' as const }))
      const { service } = createService({ worktreeCreate, worktreeRemove, runWorktreeSetupForRepo })

      await expect(service.create(REPO, { initialize })).rejects.toThrow(initializeError)

      expect(worktreeRemove).toHaveBeenCalledWith({
        projectID: 'project-1',
        directory: '/worktrees/feature-x',
        force: true,
      })
      expect(runWorktreeSetupForRepo).not.toHaveBeenCalled()
    })

    it('logs and rethrows the initializer error when removing the worktree also fails', async () => {
      const initializeError = new Error('seed failed')
      const worktreeCreate = vi.fn(async () => ({ directory: '/worktrees/feature-x' }))
      const worktreeRemove = vi.fn(async () => {
        throw new Error('remove failed')
      })
      const initialize = vi.fn(async () => {
        throw initializeError
      })
      const { service } = createService({ worktreeCreate, worktreeRemove })

      await expect(service.create(REPO, { initialize })).rejects.toThrow(initializeError)

      expect(mocks.loggerWarn).toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('throws a 400 when the directory is not a worktree sibling and touches nothing', async () => {
      const worktreeRemove = vi.fn(async () => undefined)
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([{ fullPath: '/worktrees/other', worktreeSource: 'opencode' }])
      const { service } = createService({ worktreeRemove, removeAll })

      const error = await service.remove(REPO, '/worktrees/unknown').catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(RepoWorkspaceError)
      expect(error).toMatchObject({ status: 400 })
      expect(removeAll).not.toHaveBeenCalled()
      expect(worktreeRemove).not.toHaveBeenCalled()
    })

    it('removes terminals for the matched sibling before removing the worktree', async () => {
      const worktreeRemove = vi.fn(async () => undefined)
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([{ fullPath: '/worktrees/feature-x', worktreeSource: 'opencode' }])
      const { service } = createService({ worktreeRemove, removeAll })

      await service.remove(REPO, '/worktrees/feature-x')

      expect(removeAll).toHaveBeenCalledWith('/worktrees/feature-x')
      expect(worktreeRemove).toHaveBeenCalledWith({
        projectID: 'project-1',
        directory: '/worktrees/feature-x',
        force: true,
      })
      expect(removeAll.mock.invocationCallOrder[0]!).toBeLessThan(worktreeRemove.mock.invocationCallOrder[0]!)
    })

    it('logs a terminal removal failure and still removes the worktree', async () => {
      const worktreeRemove = vi.fn(async () => undefined)
      const removeAll = vi.fn(async () => {
        throw new Error('pty cleanup failed')
      })
      mocks.listRepoSiblings.mockResolvedValue([{ fullPath: '/worktrees/feature-x', worktreeSource: 'opencode' }])
      const { service } = createService({ worktreeRemove, removeAll })

      await expect(service.remove(REPO, '/worktrees/feature-x')).resolves.toBeUndefined()

      expect(mocks.loggerWarn).toHaveBeenCalled()
      expect(worktreeRemove).toHaveBeenCalledWith({
        projectID: 'project-1',
        directory: '/worktrees/feature-x',
        force: true,
      })
    })
    it('removes a schedule worktree through its schedule without touching terminals', async () => {
      const worktreeRemove = vi.fn(async () => undefined)
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([{
        fullPath: '/schedule-worktrees/job-7-shared',
        worktreeSource: 'schedule',
        schedule: { repoId: 3, jobId: 7, runId: null, inUse: false, name: 'Shared job' },
      }])
      const { service, removeScheduleWorktrees } = createService({ worktreeRemove, removeAll })

      await service.remove(REPO, '/schedule-worktrees/job-7-shared')

      expect(removeScheduleWorktrees).toHaveBeenCalledWith(3, 7, '/schedule-worktrees/job-7-shared')
      expect(removeAll).not.toHaveBeenCalled()
      expect(worktreeRemove).not.toHaveBeenCalled()
    })

    it('refuses to remove a schedule worktree a running run is using', async () => {
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([{
        fullPath: '/schedule-worktrees/job-7-run-2',
        worktreeSource: 'schedule',
        schedule: { repoId: 1, jobId: 7, runId: 2, inUse: true, name: 'Run job' },
      }])
      const { service, removeScheduleWorktrees } = createService({ removeAll })

      await expect(service.remove(REPO, '/schedule-worktrees/job-7-run-2')).rejects.toThrow('in use by a running scheduled run')
      expect(removeAll).not.toHaveBeenCalled()
      expect(removeScheduleWorktrees).not.toHaveBeenCalled()
    })

    it('reports a plain git worktree that git refuses to remove', async () => {
      const worktreeRemove = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([{ fullPath: '/worktrees/manual', worktreeSource: 'git' }])
      const { service } = createService({ worktreeRemove })

      const error = await service.remove(REPO, '/worktrees/manual').catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(RepoWorkspaceError)
      expect((error as Error).message).toMatch(/^Could not remove worktree/)
      expect(worktreeRemove).not.toHaveBeenCalled()
    })
  })

  describe('removeRepoTerminals', () => {
    it('removes terminals for the repo directory and each worktree sibling', async () => {
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockResolvedValue([
        { fullPath: '/worktrees/a', worktreeSource: 'opencode' },
        { fullPath: '/worktrees/b', worktreeSource: 'opencode' },
        { fullPath: '/repos/manager-worktree', isWorktree: true },
      ])
      const { service } = createService({ removeAll })

      await service.removeRepoTerminals(REPO)

      expect(removeAll).toHaveBeenCalledWith('/repos/repo-a')
      expect(removeAll).toHaveBeenCalledWith('/worktrees/a')
      expect(removeAll).toHaveBeenCalledWith('/worktrees/b')
      expect(removeAll).not.toHaveBeenCalledWith('/repos/manager-worktree')
    })

    it('still removes the repo terminals when listing siblings fails', async () => {
      const removeAll = vi.fn(async () => undefined)
      mocks.listRepoSiblings.mockRejectedValue(new Error('siblings failed'))
      const { service } = createService({ removeAll })

      await expect(service.removeRepoTerminals(REPO)).resolves.toBeUndefined()

      expect(removeAll).toHaveBeenCalledWith('/repos/repo-a')
      expect(mocks.loggerWarn).toHaveBeenCalled()
    })
  })
})
