import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { rm } from 'fs/promises'

// Mock getReposPath to point into the temp directory so worktree paths are
// predictable and isolated per test run.  Preserve all other exports (ENV etc.)
// so that modules imported indirectly (repo.ts, sse-aggregator.ts) still work.
let tmpRoot: string
let scheduleWorktreesRoot: string
vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getReposPath: () => tmpRoot,
    getScheduleWorktreesPath: () => scheduleWorktreesRoot,
    getWorkspacePath: vi.fn(() => '/tmp/fake-workspace'),
  }
})

describe('buildRepoEnvForRepo', () => {
  it('includes OCM_GIT_REPO_ID and OCM_GIT_REPO_CWD when id is provided', async () => {
    const { buildRepoEnvForRepo } = await import('../../src/services/schedule-worktree')
    const env = buildRepoEnvForRepo({ id: 42, fullPath: '/some/repo' })
    expect(env.OCM_GIT_REPO_ID).toBe('42')
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })

  it('omits OCM_GIT_REPO_ID when id is null', async () => {
    const { buildRepoEnvForRepo } = await import('../../src/services/schedule-worktree')
    const env = buildRepoEnvForRepo({ id: undefined, fullPath: '/some/repo' })
    expect(env.OCM_GIT_REPO_ID).toBeUndefined()
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })

  it('omits OCM_GIT_REPO_ID when id is 0', async () => {
    const { buildRepoEnvForRepo } = await import('../../src/services/schedule-worktree')
    // id 0 is the assistant repo — skip repo context
    const env = buildRepoEnvForRepo({ id: 0, fullPath: '/some/repo' })
    expect(env.OCM_GIT_REPO_ID).toBeUndefined()
    expect(env.OCM_GIT_REPO_CWD).toBe('/some/repo')
  })
})

describe('ScheduleWorktreeManager', () => {
  let tmpDir: string
  let originRepoPath: string
  let baseRepoPath: string
  let nonGitDir: string

  const env = process.env as Record<string, string>
  const mockGitAuthService = {
    getGitEnvironment: vi.fn(() => ({
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    })),
    getSSHEnvironment: vi.fn(() => ({})),
    setupSSHForRepoUrl: vi.fn().mockResolvedValue(false),
    cleanupSSHKey: vi.fn().mockResolvedValue(undefined),
  }
  const mockDb = {} as any

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'schedule-worktree-test-'))
    tmpRoot = tmpDir
    scheduleWorktreesRoot = path.join(tmpDir, 'schedule-worktrees')
    originRepoPath = path.join(tmpDir, 'origin.git')
    baseRepoPath = path.join(tmpDir, 'base')
    nonGitDir = path.join(tmpDir, 'non-git-dir')
    mkdirSync(nonGitDir, { recursive: true })

    // Init bare origin on main and clone a working base repo
    execSync(`git init --bare -b main "${originRepoPath}"`, { env })
    execSync(`git clone "${originRepoPath}" "${baseRepoPath}"`, { env })
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`, { env })
    execSync(`git -C "${baseRepoPath}" config user.name Test`, { env })
    execSync(`git -C "${baseRepoPath}" branch -M main`, { env })
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Initial commit"`, { env })
    execSync(`git -C "${baseRepoPath}" push origin main`, { env })
    execSync(`git -C "${originRepoPath}" symbolic-ref HEAD refs/heads/main`, { env })
    execSync(`git -C "${baseRepoPath}" remote set-head origin --auto`, { env })

    // Create a dev branch for branch-override tests
    execSync(`git -C "${baseRepoPath}" checkout -b dev`, { env })
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Dev branch init"`, { env })
    execSync(`git -C "${baseRepoPath}" push origin dev`, { env })
    execSync(`git -C "${baseRepoPath}" checkout main`, { env })
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ---- Helpers ----

  /** Lazily import the manager so that module-level vi.mock takes effect. */
  async function createManager() {
    const { ScheduleWorktreeManager } = await import('../../src/services/schedule-worktree')
    return new ScheduleWorktreeManager(
      mockGitAuthService as any,
      mockDb,
    )
  }

  /** A minimal repo object that points at the test's base repo. */
  function testRepo(overrides?: Partial<{ fullPath: string; id: number; repoUrl: string | undefined }>) {
    return {
      id: 999,
      fullPath: baseRepoPath,
      repoUrl: undefined,
      ...overrides,
    } as any
  }

  it('prepare creates a worktree with the correct branch name and returns context', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null, workspaceMode: 'worktree' as const }
    const runId = 1

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.directory).toBeDefined()
    expect(ctx!.worktreePath).toBe(ctx!.directory)
    expect(ctx!.runBranch).toBe(`schedule/10/run-1`)
    expect(ctx!.worktreePath).toBe(path.join(scheduleWorktreesRoot, 'job-10-run-1'))
    expect(existsSync(ctx!.worktreePath)).toBe(true)

    // The checked-out branch in the worktree must match the run branch
    const branch = execSync(`git -C "${ctx!.worktreePath}" rev-parse --abbrev-ref HEAD`, {
      encoding: 'utf-8',
    }).trim()
    expect(branch).toBe(`schedule/10/run-1`)

    // Cleanup
    const { removeWorktree } = await import('../../src/services/repo')
    await removeWorktree(baseRepoPath, ctx!.worktreePath)
  })

  it('prepare returns null for a non-git directory', async () => {
    const manager = await createManager()
    const repo = testRepo({ fullPath: nonGitDir })
    const job = { id: 12, branch: null, workspaceMode: 'worktree' as const }

    const ctx = await manager.prepare(repo, job, 1)
    expect(ctx).toBeNull()
  })

  it('prepare returns null for the assistant repo', async () => {
    const manager = await createManager()
    const repo = testRepo({ id: 0 })
    const job = { id: 13, branch: null, workspaceMode: 'worktree' as const }

    const ctx = await manager.prepare(repo, job, 1)
    expect(ctx).toBeNull()
  })

  it('finalize returns null commit when no changes exist and removes the worktree', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null, name: 'No-change job', workspaceMode: 'worktree' as const }
    const runId = 100

    // Prepare a worktree first
    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()

    const worktreePath = ctx!.worktreePath

    // Finalize without making any changes
    const result = await manager.finalize(
      repo,
      { id: 10, name: 'No-change job', prompt: '', workspaceMode: 'worktree' as const },
      { id: runId, worktreePath, runBranch: ctx!.runBranch, triggerSource: 'manual' },
    )

    expect(result.commitHash).toBeNull()
    // Worktree must be removed after finalize
    expect(existsSync(worktreePath)).toBe(false)
  })

  it('finalize commits changes and returns the commit hash, then removes the worktree', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null, name: 'Change job', workspaceMode: 'worktree' as const }
    const runId = 200

    // Prepare a worktree
    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()

    const worktreePath = ctx!.worktreePath

    // Write a file in the worktree
    writeFileSync(path.join(worktreePath, 'scheduled-output.md'), '# Scheduled Run Output\n\nGenerated content.')

    // Finalize - should commit and clean up
    const result = await manager.finalize(
      repo,
      { id: 10, name: 'Change job', prompt: 'Generate a changelog', workspaceMode: 'worktree' as const },
      { id: runId, worktreePath, runBranch: ctx!.runBranch, triggerSource: 'schedule' },
    )

    // Must return a 40-char hex commit hash
    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    // Worktree directory must be gone
    expect(existsSync(worktreePath)).toBe(false)

    // The commit must exist on the runBranch in the base repo
    const log = execSync(`git -C "${baseRepoPath}" log "${ctx!.runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(log).toContain('Scheduled run: Change job (run #200)')
    // The commit body must include trigger and prompt summary
    expect(log).toContain('Trigger: schedule')
    expect(log).toContain('Prompt: Generate a changelog')
  })

  it('finalize is idempotent when worktreePath is null', async () => {
    const manager = await createManager()
    const repo = testRepo()

    const result = await manager.finalize(
      repo,
      { id: 10, name: 'Job', prompt: '', workspaceMode: 'worktree' as const },
      { id: 1, worktreePath: null, runBranch: null, triggerSource: 'manual' },
    )

    expect(result).toEqual({ commitHash: null })
  })

  it('prepare throws a clear error when the base branch does not exist', async () => {
    const manager = await createManager()
    const repo = testRepo()
    // A clearly nonexistent ref (avoids case-insensitive filesystem false matches
    // that would let a typo like "Main" resolve to "main" locally).
    const job = { id: 21, branch: 'does-not-exist-branch', workspaceMode: 'worktree' as const }

    await expect(manager.prepare(repo, job, 1)).rejects.toThrow(
      /Base branch "does-not-exist-branch" was not found/,
    )

    // No worktree directory should be left behind for the failed run
    expect(existsSync(path.join(scheduleWorktreesRoot, 'job-21-run-1'))).toBe(false)
  })

  it('prepare respects the branch override', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 20, branch: 'dev', workspaceMode: 'worktree' as const }
    const runId = 1

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.runBranch).toBe(`schedule/20/run-1`)
    expect(existsSync(ctx!.worktreePath)).toBe(true)

    // The worktree should be based on the dev branch
    const devHead = execSync(`git -C "${baseRepoPath}" rev-parse origin/dev`, {
      encoding: 'utf-8',
    }).trim()
    const wtHead = execSync(`git -C "${ctx!.worktreePath}" rev-parse HEAD`, {
      encoding: 'utf-8',
    }).trim()
    expect(wtHead).toBe(devHead)

    // Cleanup
    const { removeWorktree } = await import('../../src/services/repo')
    await removeWorktree(baseRepoPath, ctx!.worktreePath)
  })

  it('pruneRunArtifacts removes the worktree directory and deletes the run branch in discard mode', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 90, branch: null, workspaceMode: 'worktree' as const }
    const runId = 900

    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()

    const worktreePath = ctx!.worktreePath
    const runBranch = ctx!.runBranch
    expect(existsSync(worktreePath)).toBe(true)

    await manager.pruneRunArtifacts(repo, { id: 90, name: 'Prune job' }, [{ runBranch, worktreePath }], 'discard')

    expect(existsSync(worktreePath)).toBe(false)
    const branchList = execSync(`git -C "${baseRepoPath}" branch --list "${runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(branchList).toBe('')
  })

  it('pruneRunArtifacts commits a kept worktree and keeps its branch in commit mode', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 91, branch: null, name: 'Commit prune', workspaceMode: 'kept-worktree' as const }
    const runId = 910

    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()
    writeFileSync(path.join(ctx!.worktreePath, 'pending.md'), 'pending work')

    await manager.pruneRunArtifacts(repo, { id: 91, name: 'Commit prune' }, [{ runBranch: ctx!.runBranch, worktreePath: ctx!.worktreePath }], 'commit')

    expect(existsSync(ctx!.worktreePath)).toBe(false)
    const branchList = execSync(`git -C "${baseRepoPath}" branch --list "${ctx!.runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(branchList).not.toBe('')
    const log = execSync(`git -C "${baseRepoPath}" log "${ctx!.runBranch}" --oneline`, { encoding: 'utf-8' })
    expect(log).toContain('Schedule worktree removed: Commit prune')
  })

  it('pruneRunArtifacts deletes the branch of a run whose worktree is already gone in commit mode', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 92, branch: null, workspaceMode: 'kept-worktree' as const }
    const runId = 920

    const ctx = await manager.prepare(repo, job, runId)
    const { removeWorktree } = await import('../../src/services/repo')
    await removeWorktree(baseRepoPath, ctx!.worktreePath)
    expect(existsSync(ctx!.worktreePath)).toBe(false)

    await manager.pruneRunArtifacts(repo, { id: 92, name: 'Gone prune' }, [{ runBranch: ctx!.runBranch, worktreePath: ctx!.worktreePath }], 'commit')

    const branchList = execSync(`git -C "${baseRepoPath}" branch --list "${ctx!.runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(branchList).toBe('')
  })

  it('prepare refuses when the run branch is checked out in another worktree', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const otherPath = path.join(tmpDir, 'other-checkout')
    const runBranch = 'schedule/40/run-1'
    execSync(`git -C "${baseRepoPath}" worktree add -b "${runBranch}" "${otherPath}" main`, { env })

    try {
      const error = await manager.prepare(repo, { id: 40, branch: null, workspaceMode: 'worktree' }, 1).catch((caught: unknown) => caught)
      expect((error as Error).message).toContain(`Branch ${runBranch} is checked out in`)
      expect((error as Error).message).toContain('Switch that checkout to another branch so the schedule can run.')
    } finally {
      execSync(`git -C "${baseRepoPath}" worktree remove --force "${otherPath}"`, { env })
      execSync(`git -C "${baseRepoPath}" branch -D "${runBranch}"`, { env })
    }
  })

  it('finalize commits but keeps the worktree on its branch in kept-worktree mode', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 31, branch: null, name: 'Kept job', prompt: 'keep', workspaceMode: 'kept-worktree' as const }

    const ctx = await manager.prepare(repo, job, 1)
    writeFileSync(path.join(ctx!.worktreePath, 'kept.md'), 'kept')

    const result = await manager.finalize(repo, job, { id: 1, worktreePath: ctx!.worktreePath, runBranch: ctx!.runBranch, triggerSource: 'manual' })

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    expect(existsSync(ctx!.worktreePath)).toBe(true)
    expect(execSync(`git -C "${ctx!.worktreePath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('schedule/31/run-1')
    expect(manager.listWorktrees(31)).toEqual([
      { jobId: 31, runId: 1, worktreePath: ctx!.worktreePath, branch: 'schedule/31/run-1' },
    ])

    await manager.releaseWorktree(repo, job, ctx!.worktreePath)
  })

  it('reuses one shared worktree across runs and continues its branch after release', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 32, branch: null, name: 'Shared job', prompt: 'share', workspaceMode: 'shared-worktree' as const }
    const sharedPath = path.join(scheduleWorktreesRoot, 'job-32-shared')

    const first = await manager.prepare(repo, job, 1)
    expect(first).toEqual({ directory: sharedPath, worktreePath: sharedPath, runBranch: 'schedule/32/shared' })
    writeFileSync(path.join(sharedPath, 'first.md'), 'first')
    await manager.finalize(repo, job, { id: 1, worktreePath: sharedPath, runBranch: 'schedule/32/shared', triggerSource: 'manual' })
    expect(existsSync(sharedPath)).toBe(true)

    const second = await manager.prepare(repo, job, 2)
    expect(second!.worktreePath).toBe(sharedPath)

    await manager.releaseWorktree(repo, job, sharedPath)
    expect(existsSync(sharedPath)).toBe(false)

    const third = await manager.prepare(repo, job, 3)
    expect(existsSync(path.join(third!.worktreePath, 'first.md'))).toBe(true)

    await manager.pruneRunArtifacts(repo, { id: 32, name: 'Shared job' }, [{ runBranch: 'schedule/32/shared', worktreePath: sharedPath }])
    expect(existsSync(sharedPath)).toBe(true)
    expect(execSync(`git -C "${baseRepoPath}" branch --list schedule/32/shared`, { encoding: 'utf-8' }).trim()).not.toBe('')

    await manager.releaseWorktree(repo, job, sharedPath)
  })

  it('refuses to reuse a shared worktree with uncommitted changes made outside a run', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 33, branch: null, name: 'Dirty shared', prompt: '', workspaceMode: 'shared-worktree' as const }
    const sharedPath = path.join(scheduleWorktreesRoot, 'job-33-shared')

    await manager.prepare(repo, job, 1)
    writeFileSync(path.join(sharedPath, 'outside.md'), 'outside edit')

    await expect(manager.prepare(repo, job, 2)).rejects.toThrow(
      `Shared worktree ${sharedPath} has uncommitted changes made outside a scheduled run.`,
    )

    await manager.releaseWorktree(repo, job, sharedPath)
  })
})
