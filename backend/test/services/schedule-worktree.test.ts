import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import type { Repo } from '../../src/types/repo'
import { buildRepoEnvForRepo, ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { removeWorktree } from '../../src/services/repo'
import { cloneOrigin, createGitAuthService, createOrigin, git } from '../helpers/git-fixtures'
import { createTestDatabase } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { catchRejectedError } from '../helpers/thrown-error'

describe('buildRepoEnvForRepo', () => {
  it('includes OCM_GIT_REPO_ID and OCM_GIT_REPO_CWD when id is provided', () => {
    const env = buildRepoEnvForRepo({ id: 42, fullPath: '/some/repo' })

    expect(env.OCM_GIT_REPO_ID).toBe('42')
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })

  it('omits OCM_GIT_REPO_ID when id is null', () => {
    const env = buildRepoEnvForRepo({ id: undefined, fullPath: '/some/repo' })

    expect(env.OCM_GIT_REPO_ID).toBeUndefined()
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })

  it('omits OCM_GIT_REPO_ID when id is 0', () => {
    const env = buildRepoEnvForRepo({ id: 0, fullPath: '/some/repo' })

    expect(env.OCM_GIT_REPO_ID).toBeUndefined()
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })
})

describe('ScheduleWorktreeManager', () => {
  let workspace: TempWorkspace
  let db: Database
  let scheduleWorktreesRoot: string
  let baseRepoPath: string
  let nonGitDir: string

  function createManager(): ScheduleWorktreeManager {
    return new ScheduleWorktreeManager(createGitAuthService(), db)
  }

  function testRepo(overrides: Partial<Repo> = {}): Repo {
    return {
      id: 999,
      localPath: 'base',
      fullPath: baseRepoPath,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
      ...overrides,
    }
  }

  beforeAll(() => {
    workspace = createTempWorkspace('schedule-worktree-test-')
    scheduleWorktreesRoot = path.join(workspace.path, 'schedule-worktrees')
    baseRepoPath = path.join(workspace.path, 'base')
    nonGitDir = path.join(workspace.path, 'non-git-dir')
    mkdirSync(nonGitDir, { recursive: true })

    const originRepoPath = path.join(workspace.path, 'origin.git')
    createOrigin(originRepoPath, path.join(workspace.path, 'seed'), ['dev'])
    cloneOrigin(originRepoPath, baseRepoPath)
    git(['remote', 'set-head', 'origin', '--auto'], baseRepoPath)

    db = createTestDatabase()
  })

  afterAll(() => {
    db.close()
    workspace.restore()
  })

  it('prepare creates a worktree with the correct branch name and returns context', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(testRepo(), { id: 10, branch: null, workspaceMode: 'worktree' }, 1)

    expect(ctx).not.toBeNull()
    expect(ctx?.worktreePath).toBe(ctx?.directory)
    expect(ctx?.runBranch).toBe('schedule/10/run-1')
    expect(ctx?.worktreePath).toBe(path.join(scheduleWorktreesRoot, 'job-10-run-1'))
    expect(existsSync(ctx?.worktreePath ?? '')).toBe(true)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], ctx?.worktreePath)).toBe('schedule/10/run-1')

    await removeWorktree(baseRepoPath, ctx?.worktreePath ?? '')
  })

  it('prepare returns null for a non-git directory', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(testRepo({ fullPath: nonGitDir }), { id: 12, branch: null, workspaceMode: 'worktree' }, 1)

    expect(ctx).toBeNull()
  })

  it('prepare returns null for the assistant repo', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(testRepo({ id: ASSISTANT_REPO_ID }), { id: 13, branch: null, workspaceMode: 'worktree' }, 1)

    expect(ctx).toBeNull()
  })

  it('finalize returns null commit when no changes exist and removes the worktree', async () => {
    const manager = createManager()
    const job = { id: 10, branch: null, name: 'No-change job', workspaceMode: 'worktree' as const }

    const ctx = await manager.prepare(testRepo(), job, 100)
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''

    const result = await manager.finalize(
      testRepo(),
      { id: 10, name: 'No-change job', prompt: '', workspaceMode: 'worktree' },
      { id: 100, worktreePath, runBranch: ctx?.runBranch ?? null, triggerSource: 'manual' },
    )

    expect(result.commitHash).toBeNull()
    expect(existsSync(worktreePath)).toBe(false)
  })

  it('finalize commits changes and returns the commit hash, then removes the worktree', async () => {
    const manager = createManager()
    const job = { id: 10, branch: null, name: 'Change job', workspaceMode: 'worktree' as const }

    const ctx = await manager.prepare(testRepo(), job, 200)
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''
    const runBranch = ctx?.runBranch ?? ''
    writeFileSync(path.join(worktreePath, 'scheduled-output.md'), '# Scheduled Run Output\n\nGenerated content.')

    const result = await manager.finalize(
      testRepo(),
      { id: 10, name: 'Change job', prompt: 'Generate a changelog', workspaceMode: 'worktree' },
      { id: 200, worktreePath, runBranch, triggerSource: 'schedule' },
    )

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(worktreePath)).toBe(false)

    const log = git(['log', runBranch], baseRepoPath)
    expect(log).toContain('Scheduled run: Change job (run #200)')
    expect(log).toContain('Trigger: schedule')
    expect(log).toContain('Prompt: Generate a changelog')
  })

  it('finalize is idempotent when worktreePath is null', async () => {
    const manager = createManager()

    const result = await manager.finalize(
      testRepo(),
      { id: 10, name: 'Job', prompt: '', workspaceMode: 'worktree' },
      { id: 1, worktreePath: null, runBranch: null, triggerSource: 'manual' },
    )

    expect(result).toEqual({ commitHash: null })
  })

  it('prepare throws a clear error when the base branch does not exist', async () => {
    const manager = createManager()

    await expect(
      manager.prepare(testRepo(), { id: 21, branch: 'does-not-exist-branch', workspaceMode: 'worktree' }, 1),
    ).rejects.toThrow(/Base branch "does-not-exist-branch" was not found/)

    expect(existsSync(path.join(scheduleWorktreesRoot, 'job-21-run-1'))).toBe(false)
  })

  it('prepare respects the branch override', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(testRepo(), { id: 20, branch: 'dev', workspaceMode: 'worktree' }, 1)

    expect(ctx).not.toBeNull()
    expect(ctx?.runBranch).toBe('schedule/20/run-1')
    expect(existsSync(ctx?.worktreePath ?? '')).toBe(true)
    expect(git(['rev-parse', 'HEAD'], ctx?.worktreePath)).toBe(git(['rev-parse', 'origin/dev'], baseRepoPath))

    await removeWorktree(baseRepoPath, ctx?.worktreePath ?? '')
  })

  it('pruneRunArtifacts removes the worktree directory and deletes the run branch in discard mode', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(testRepo(), { id: 90, branch: null, workspaceMode: 'worktree' }, 900)
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''
    const runBranch = ctx?.runBranch ?? ''
    expect(existsSync(worktreePath)).toBe(true)

    await manager.pruneRunArtifacts(testRepo(), { id: 90, name: 'Prune job' }, [{ runBranch, worktreePath }], 'discard')

    expect(existsSync(worktreePath)).toBe(false)
    expect(git(['branch', '--list', runBranch], baseRepoPath)).toBe('')
  })

  it('pruneRunArtifacts commits a kept worktree and keeps its branch in commit mode', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(
      testRepo(),
      { id: 91, branch: null, workspaceMode: 'kept-worktree' },
      910,
    )
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''
    const runBranch = ctx?.runBranch ?? ''
    writeFileSync(path.join(worktreePath, 'pending.md'), 'pending work')

    await manager.pruneRunArtifacts(testRepo(), { id: 91, name: 'Commit prune' }, [{ runBranch, worktreePath }], 'commit')

    expect(existsSync(worktreePath)).toBe(false)
    expect(git(['branch', '--list', runBranch], baseRepoPath)).not.toBe('')
    expect(git(['log', runBranch, '--oneline'], baseRepoPath)).toContain('Schedule worktree removed: Commit prune')
  })

  it('pruneRunArtifacts deletes the branch of a run whose worktree is already gone in commit mode', async () => {
    const manager = createManager()

    const ctx = await manager.prepare(
      testRepo(),
      { id: 92, branch: null, workspaceMode: 'kept-worktree' },
      920,
    )
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''
    const runBranch = ctx?.runBranch ?? ''
    await removeWorktree(baseRepoPath, worktreePath)
    expect(existsSync(worktreePath)).toBe(false)

    await manager.pruneRunArtifacts(testRepo(), { id: 92, name: 'Gone prune' }, [{ runBranch, worktreePath }], 'commit')

    expect(git(['branch', '--list', runBranch], baseRepoPath)).toBe('')
  })

  it('prepare refuses when the run branch is checked out in another worktree', async () => {
    const manager = createManager()
    const otherPath = path.join(workspace.path, 'other-checkout')
    const runBranch = 'schedule/40/run-1'
    git(['worktree', 'add', '-b', runBranch, otherPath, 'main'], baseRepoPath)

    try {
      const error = await catchRejectedError(
        manager.prepare(testRepo(), { id: 40, branch: null, workspaceMode: 'worktree' }, 1),
      )

      expect(error.message).toContain(`Branch ${runBranch} is checked out in`)
      expect(error.message).toContain('Switch that checkout to another branch so the schedule can run.')
    } finally {
      git(['worktree', 'remove', '--force', otherPath], baseRepoPath)
      git(['branch', '-D', runBranch], baseRepoPath)
    }
  })

  it('finalize commits but keeps the worktree on its branch in kept-worktree mode', async () => {
    const manager = createManager()
    const job = { id: 31, branch: null, name: 'Kept job', prompt: 'keep', workspaceMode: 'kept-worktree' as const }

    const ctx = await manager.prepare(testRepo(), job, 1)
    expect(ctx).not.toBeNull()
    const worktreePath = ctx?.worktreePath ?? ''
    writeFileSync(path.join(worktreePath, 'kept.md'), 'kept')

    const result = await manager.finalize(testRepo(), job, {
      id: 1,
      worktreePath,
      runBranch: ctx?.runBranch ?? null,
      triggerSource: 'manual',
    })

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(worktreePath)).toBe(true)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe('schedule/31/run-1')
    expect(manager.listWorktrees(31)).toEqual([
      { jobId: 31, runId: 1, worktreePath, branch: 'schedule/31/run-1' },
    ])

    await manager.releaseWorktree(testRepo(), job, worktreePath)
  })

  it('reuses one shared worktree across runs and continues its branch after release', async () => {
    const manager = createManager()
    const job = { id: 32, branch: null, name: 'Shared job', prompt: 'share', workspaceMode: 'shared-worktree' as const }
    const sharedPath = path.join(scheduleWorktreesRoot, 'job-32-shared')

    const first = await manager.prepare(testRepo(), job, 1)
    expect(first).toEqual({ directory: sharedPath, worktreePath: sharedPath, runBranch: 'schedule/32/shared' })
    writeFileSync(path.join(sharedPath, 'first.md'), 'first')
    await manager.finalize(testRepo(), job, {
      id: 1,
      worktreePath: sharedPath,
      runBranch: 'schedule/32/shared',
      triggerSource: 'manual',
    })
    expect(existsSync(sharedPath)).toBe(true)

    const second = await manager.prepare(testRepo(), job, 2)
    expect(second?.worktreePath).toBe(sharedPath)

    await manager.releaseWorktree(testRepo(), job, sharedPath)
    expect(existsSync(sharedPath)).toBe(false)

    const third = await manager.prepare(testRepo(), job, 3)
    expect(existsSync(path.join(third?.worktreePath ?? '', 'first.md'))).toBe(true)

    await manager.pruneRunArtifacts(testRepo(), { id: 32, name: 'Shared job' }, [
      { runBranch: 'schedule/32/shared', worktreePath: sharedPath },
    ])
    expect(existsSync(sharedPath)).toBe(true)
    expect(git(['branch', '--list', 'schedule/32/shared'], baseRepoPath)).not.toBe('')

    await manager.releaseWorktree(testRepo(), job, sharedPath)
  })

  it('refuses to reuse a shared worktree with uncommitted changes made outside a run', async () => {
    const manager = createManager()
    const job = { id: 33, branch: null, name: 'Dirty shared', prompt: '', workspaceMode: 'shared-worktree' as const }
    const sharedPath = path.join(scheduleWorktreesRoot, 'job-33-shared')

    await manager.prepare(testRepo(), job, 1)
    writeFileSync(path.join(sharedPath, 'outside.md'), 'outside edit')

    await expect(manager.prepare(testRepo(), job, 2)).rejects.toThrow(
      `Shared worktree ${sharedPath} has uncommitted changes made outside a scheduled run.`,
    )

    await manager.releaseWorktree(testRepo(), job, sharedPath)
  })
})
