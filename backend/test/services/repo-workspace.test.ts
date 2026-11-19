import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { Repo } from '@opencode-manager/shared/types'
import type { GitAuthEnvironmentProvider } from '../../src/services/git-auth'
import type { ProjectConfigService } from '../../src/services/project-config'
import type { ScheduleService } from '../../src/services/schedules'
import type { TerminalService } from '../../src/services/terminal'
import { createScheduleRun, updateScheduleRunWorktree } from '../../src/db/schedules'
import { RepoWorkspaceError } from '../../src/services/repo'
import { RepoWorkspaceService } from '../../src/services/repo-workspace'
import { getScheduleWorktreePath } from '../../src/services/schedule-worktree-paths'
import { createGitAuthService, createCommittedRepo, git } from '../helpers/git-fixtures'
import { testLogEntries } from '../helpers/log-assertions'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

const PROJECT_ID = 'commit-A'

interface ServiceOverrides {
  worktreeList?: OpenCodeApi['worktree']['list']
  worktreeCreate?: OpenCodeApi['worktree']['create']
  worktreeRemove?: OpenCodeApi['worktree']['remove']
  runWorktreeSetupForRepo?: Pick<ProjectConfigService, 'runWorktreeSetupForRepo'>['runWorktreeSetupForRepo']
  removeAll?: Pick<TerminalService, 'removeAll'>['removeAll']
  terminalList?: Pick<TerminalService, 'list'>['list']
  terminalCreate?: Pick<TerminalService, 'create'>['create']
  removeWorktrees?: Pick<ScheduleService, 'removeWorktrees'>['removeWorktrees']
}

describe('RepoWorkspaceService', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo

  function createService(overrides: ServiceOverrides = {}) {
    const worktreeList = overrides.worktreeList ?? vi.fn(async () => [])
    const worktreeCreate =
      overrides.worktreeCreate ??
      vi.fn(async (input: Parameters<OpenCodeApi['worktree']['create']>[0]) => ({
        directory: path.join(workspace.path, 'worktrees', input.name ?? 'default'),
      }))
    const worktreeRemove = overrides.worktreeRemove ?? vi.fn(async () => undefined)
    const runWorktreeSetupForRepo =
      overrides.runWorktreeSetupForRepo ?? vi.fn(async () => ({ status: 'none' as const }))
    const removeAll = overrides.removeAll ?? vi.fn(async () => undefined)
    const terminalList = overrides.terminalList ?? vi.fn(async () => [])
    const terminalCreate = overrides.terminalCreate ?? vi.fn(async () => {
      throw new Error('terminal creation is not expected in this test')
    })
    const removeWorktrees = overrides.removeWorktrees ?? vi.fn(async () => ({ removed: 1 }))
    const openCodeClient = createStubOpenCodeClient({
      api: { worktree: { list: worktreeList, create: worktreeCreate, remove: worktreeRemove } },
    })
    const gitAuthService: GitAuthEnvironmentProvider = createGitAuthService()

    const service = new RepoWorkspaceService(
      db,
      openCodeClient,
      gitAuthService,
      { runWorktreeSetupForRepo },
      { removeAll, list: terminalList, create: terminalCreate },
      { removeWorktrees },
    )

    return { service, worktreeCreate, worktreeRemove, worktreeList, runWorktreeSetupForRepo, removeAll, removeWorktrees }
  }

  function openCodeWorktree(directory: string) {
    mkdirSync(directory, { recursive: true })
    return { directory, strategy: 'opencode' }
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-repo-workspace-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'repo-a' })
    createCommittedRepo(repo.fullPath)
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  describe('create', () => {
    it('creates the worktree with the resolved project id, name and branch, then runs the setup', async () => {
      const { service, worktreeCreate, runWorktreeSetupForRepo } = createService()

      const result = await service.create(repo, { name: 'feature-x', ref: 'feature/x' })

      expect(worktreeCreate).toHaveBeenCalledWith({ projectID: PROJECT_ID, name: 'feature-x', branch: 'feature/x' })
      expect(runWorktreeSetupForRepo).toHaveBeenCalledWith(repo, path.join(workspace.path, 'worktrees', 'feature-x'), expect.anything())
      expect(result).toEqual({
        directory: path.join(workspace.path, 'worktrees', 'feature-x'),
        worktreeSetup: { status: 'none' },
      })
    })

    it('creates the worktree without optional options', async () => {
      const { service, worktreeCreate } = createService()

      await service.create(repo)

      expect(worktreeCreate).toHaveBeenCalledWith({ projectID: PROJECT_ID, name: undefined, branch: undefined })
    })

    it('runs the initializer before the worktree setup', async () => {
      const order: string[] = []
      const { service } = createService({
        worktreeCreate: vi.fn(async (input) => {
          order.push('create')
          return { directory: path.join(workspace.path, 'worktrees', input.name ?? 'default') }
        }),
        runWorktreeSetupForRepo: vi.fn(async () => {
          order.push('setup')
          return { status: 'none' as const }
        }),
      })
      const initialize = vi.fn(async () => {
        order.push('initialize')
      })

      await service.create(repo, { name: 'feature-x', initialize })

      expect(initialize).toHaveBeenCalledWith(path.join(workspace.path, 'worktrees', 'feature-x'))
      expect(order).toEqual(['create', 'initialize', 'setup'])
    })

    it('removes the worktree and rethrows when the initializer fails, without running the setup', async () => {
      const initializeError = new Error('seed failed')
      const { service, worktreeRemove, runWorktreeSetupForRepo } = createService()
      const initialize = vi.fn(async () => {
        throw initializeError
      })

      await expect(service.create(repo, { name: 'feature-x', initialize })).rejects.toBe(initializeError)

      expect(worktreeRemove).toHaveBeenCalledWith({
        projectID: PROJECT_ID,
        directory: path.join(workspace.path, 'worktrees', 'feature-x'),
        force: true,
      })
      expect(runWorktreeSetupForRepo).not.toHaveBeenCalled()
    })

    it('logs and rethrows the initializer error when removing the worktree also fails', async () => {
      const initializeError = new Error('seed failed')
      const { service } = createService({
        worktreeRemove: vi.fn(async () => {
          throw new Error('remove failed')
        }),
      })
      const initialize = vi.fn(async () => {
        throw initializeError
      })

      await expect(service.create(repo, { name: 'feature-x', initialize })).rejects.toBe(initializeError)

      expect(testLogEntries('warn').map((entry) => entry.message)).toContainEqual(
        expect.stringContaining('Failed to remove worktree'),
      )
    })
  })

  describe('remove', () => {
    it('rejects a directory that is not a worktree sibling and touches nothing', async () => {
      const { service, removeAll, worktreeRemove } = createService()

      await expect(service.remove(repo, path.join(workspace.path, 'worktrees', 'unknown'))).rejects.toBeInstanceOf(
        RepoWorkspaceError,
      )
      expect(removeAll).not.toHaveBeenCalled()
      expect(worktreeRemove).not.toHaveBeenCalled()
    })

    it('removes terminals for the matched sibling before removing the worktree', async () => {
      const directory = openCodeWorktree(path.join(workspace.path, 'worktrees', 'feature-x')).directory
      const order: string[] = []
      const { service } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(directory)]),
        removeAll: vi.fn(async (target: string) => {
          order.push(`terminals:${target}`)
        }),
        worktreeRemove: vi.fn(async () => {
          order.push('worktree')
        }),
      })

      await service.remove(repo, directory)

      expect(order).toEqual([`terminals:${directory}`, 'worktree'])
    })

    it('removes the OpenCode worktree with force after successful terminal cleanup', async () => {
      const directory = openCodeWorktree(path.join(workspace.path, 'worktrees', 'feature-x')).directory
      const { service, worktreeRemove } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(directory)]),
      })

      await service.remove(repo, directory)

      expect(worktreeRemove).toHaveBeenCalledWith({ projectID: PROJECT_ID, directory, force: true })
    })

    it('logs a terminal removal failure and still removes the worktree', async () => {
      const directory = openCodeWorktree(path.join(workspace.path, 'worktrees', 'feature-x')).directory
      const { service, worktreeRemove } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(directory)]),
        removeAll: vi.fn(async () => {
          throw new Error('pty cleanup failed')
        }),
      })

      await expect(service.remove(repo, directory)).resolves.toBeUndefined()

      expect(testLogEntries('warn').map((entry) => entry.message)).toContainEqual(
        expect.stringContaining('Failed to remove terminals for'),
      )
      expect(worktreeRemove).toHaveBeenCalledWith({ projectID: PROJECT_ID, directory, force: true })
    })

    it('removes a schedule worktree through its schedule without touching terminals', async () => {
      seedScheduleJob(db, repo.id, { name: 'Shared job' })
      const directory = getScheduleWorktreePath(1, null)
      const { service, removeWorktrees, removeAll, worktreeRemove } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(directory)]),
      })

      await service.remove(repo, directory)

      expect(removeWorktrees).toHaveBeenCalledWith(repo.id, 1, directory)
      expect(removeAll).not.toHaveBeenCalled()
      expect(worktreeRemove).not.toHaveBeenCalled()
    })

    it('refuses to remove a schedule worktree a running run is using', async () => {
      const job = seedScheduleJob(db, repo.id, { name: 'Run job' })
      const directory = getScheduleWorktreePath(job.id, 2)
      const run = createScheduleRun(db, {
        jobId: job.id,
        repoId: repo.id,
        triggerSource: 'manual',
        status: 'running',
        startedAt: Date.now(),
        createdAt: Date.now(),
      })
      updateScheduleRunWorktree(db, repo.id, job.id, run.id, { worktreePath: directory })
      const { service, removeWorktrees, removeAll } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(directory)]),
      })

      await expect(service.remove(repo, directory)).rejects.toThrow('in use by a running scheduled run')
      expect(removeAll).not.toHaveBeenCalled()
      expect(removeWorktrees).not.toHaveBeenCalled()
    })

    it('reports a plain git worktree that git refuses to remove', async () => {
      const directory = path.join(workspace.path, 'worktrees', 'manual')
      git(['worktree', 'add', '-b', 'manual/linked', directory], repo.fullPath)
      writeFileSync(path.join(directory, 'untracked.txt'), 'dirty\n')
      const { service, worktreeRemove } = createService()

      const removal = service.remove(repo, directory)

      await expect(removal).rejects.toBeInstanceOf(RepoWorkspaceError)
      await expect(removal).rejects.toThrow(/^Could not remove worktree/)
      expect(worktreeRemove).not.toHaveBeenCalled()
      expect(git(['worktree', 'list', '--porcelain'], repo.fullPath)).toContain(directory)
    })
  })

  describe('removeRepoTerminals', () => {
    it('removes terminals for the repo directory and each worktree sibling', async () => {
      const firstWorktree = openCodeWorktree(path.join(workspace.path, 'worktrees', 'a')).directory
      const secondWorktree = openCodeWorktree(path.join(workspace.path, 'worktrees', 'b')).directory
      const otherRepo = seedRepo(db, { localPath: 'repo-b' })
      const { service, removeAll } = createService({
        worktreeList: vi.fn(async () => [openCodeWorktree(firstWorktree), openCodeWorktree(secondWorktree)]),
      })

      await service.removeRepoTerminals(repo)

      expect(removeAll).toHaveBeenCalledWith(repo.fullPath)
      expect(removeAll).toHaveBeenCalledWith(firstWorktree)
      expect(removeAll).toHaveBeenCalledWith(secondWorktree)
      expect(removeAll).not.toHaveBeenCalledWith(otherRepo.fullPath)
    })

    it('still removes the repo terminals when listing siblings fails', async () => {
      const { service, removeAll } = createService()

      db.prepare('DROP TABLE repos').run()

      await expect(service.removeRepoTerminals(repo)).resolves.toBeUndefined()

      expect(removeAll).toHaveBeenCalledWith(repo.fullPath)
      expect(testLogEntries('warn').map((entry) => entry.message)).toContainEqual(
        expect.stringContaining('Failed to list OpenCode workspace siblings'),
      )
    })
  })
})
