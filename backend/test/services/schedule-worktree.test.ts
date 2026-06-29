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
  const mockSettingsService = {
    getSettings: vi.fn(() => ({
      preferences: { gitIdentity: undefined },
      updatedAt: Date.now(),
    })),
  }
  const mockCredentialProvider = {
    getGitCredentials: vi.fn(() => []),
  }
  const mockDb = {} as any

  // Default mock OpenCodeClient: postJson rejects (triggers fallback), forward
  // returns an ok response for teardown safety.
  const mockOpenCodeClient = {
    postJson: vi.fn().mockRejectedValue(new Error('API unavailable')),
    forward: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    getJson: vi.fn(),
    forwardRaw: vi.fn(),
    setProviderAuth: vi.fn(),
    deleteProviderAuth: vi.fn(),
    startMcpAuth: vi.fn(),
    authenticateMcp: vi.fn(),
  }

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'schedule-worktree-test-'))
    tmpRoot = tmpDir
    scheduleWorktreesRoot = path.join(tmpDir, 'schedule-worktrees')
    originRepoPath = path.join(tmpDir, 'origin.git')
    baseRepoPath = path.join(tmpDir, 'base')
    nonGitDir = path.join(tmpDir, 'non-git-dir')
    mkdirSync(nonGitDir, { recursive: true })

    // Init bare origin and clone a working base repo
    execSync(`git init --bare "${originRepoPath}"`, { env })
    execSync(`git clone "${originRepoPath}" "${baseRepoPath}"`, { env })
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`, { env })
    execSync(`git -C "${baseRepoPath}" config user.name Test`, { env })
    execSync(`git -C "${baseRepoPath}" branch -m master main`, { env })
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
      mockSettingsService as any,
      mockCredentialProvider as any,
      mockDb,
      mockOpenCodeClient as any,
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

  // ---- Fallback (raw git) tests ----

  it('prepare creates a worktree with the correct branch name and returns context (raw git fallback)', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null }
    const runId = 1

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.directory).toBeDefined()
    expect(ctx!.worktreePath).toBe(ctx!.directory)
    expect(ctx!.runBranch).toBe(`schedule/10/run-1`)
    expect(ctx!.workspaceId).toBeNull()
    expect(ctx!.autoBranch).toBeNull()
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
    const job = { id: 12, branch: null }

    const ctx = await manager.prepare(repo, job, 1)
    expect(ctx).toBeNull()
  })

  it('prepare returns null for the assistant repo', async () => {
    const manager = await createManager()
    const repo = testRepo({ id: 0 })
    const job = { id: 13, branch: null }

    const ctx = await manager.prepare(repo, job, 1)
    expect(ctx).toBeNull()
  })

  it('finalize returns null commit when no changes exist and removes the worktree', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null, name: 'No-change job' }
    const runId = 100

    // Prepare a worktree first
    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()

    const worktreePath = ctx!.worktreePath

    // Finalize without making any changes
    const result = await manager.finalize(
      repo,
      { id: 10, name: 'No-change job', prompt: '' },
      { id: runId, worktreePath, runBranch: ctx!.runBranch, triggerSource: 'manual' },
    )

    expect(result.commitHash).toBeNull()
    // Worktree must be removed after finalize
    expect(existsSync(worktreePath)).toBe(false)
  })

  it('finalize commits changes and returns the commit hash, then removes the worktree', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 10, branch: null, name: 'Change job' }
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
      { id: 10, name: 'Change job', prompt: 'Generate a changelog' },
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
      { id: 10, name: 'Job', prompt: '' },
      { id: 1, worktreePath: null, runBranch: null, triggerSource: 'manual' },
    )

    expect(result).toEqual({ commitHash: null })
  })

  it('prepare throws a clear error when the base branch does not exist', async () => {
    const manager = await createManager()
    const repo = testRepo()
    // A clearly nonexistent ref (avoids case-insensitive filesystem false matches
    // that would let a typo like "Main" resolve to "main" locally).
    const job = { id: 21, branch: 'does-not-exist-branch' }

    await expect(manager.prepare(repo, job, 1)).rejects.toThrow(
      /Base branch "does-not-exist-branch" was not found/,
    )

    // No worktree directory should be left behind for the failed run
    expect(existsSync(path.join(scheduleWorktreesRoot, 'job-21-run-1'))).toBe(false)
  })

  it('prepare respects the branch override (raw git fallback)', async () => {
    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 20, branch: 'dev' }
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

  // ---- OpenCode API path tests ----

  /**
   * Helper: creates a linked git worktree directory (rather than a clone) so
   * that refs and objects are shared with the base repo.  The worktree is
   * created with a temp branch that prepare() will later overwrite via
   * `checkout -B`.
   */
  async function createWorktreeWorkspace(dirName: string): Promise<{ directory: string; cleanup: () => Promise<void> }> {
    const directory = path.join(tmpDir, dirName)
    const tempBranch = `_temp_${dirName}`
    // Create a detached worktree on the current HEAD without creating a branch
    execSync(`git -C "${baseRepoPath}" worktree add --detach "${directory}" origin/main`, { env })
    execSync(`git -C "${directory}" config user.email test@test.com`, { env })
    execSync(`git -C "${directory}" config user.name Test`, { env })
    const cleanup = async () => {
      const { removeWorktree } = await import('../../src/services/repo')
      await removeWorktree(baseRepoPath, directory)
      // Also remove any leftover branch the test might have created
      execSync(`git -C "${baseRepoPath}" branch -D "${tempBranch}" 2>/dev/null || true`, { env })
    }
    return { directory, cleanup }
  }

  it('prepare calls POST /experimental/workspace and returns workspaceId on success', async () => {
    const { directory: workspaceDirectory, cleanup } = await createWorktreeWorkspace('oc-workspace')

    const workspaceId = 'ws-test-123'
    const mockPost = vi.fn().mockResolvedValue({
      id: workspaceId,
      directory: workspaceDirectory,
      branch: null,
    })
    mockOpenCodeClient.postJson = mockPost

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 30, branch: null }
    const runId = 5

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBe(workspaceId)
    expect(ctx!.autoBranch).toBeNull()
    expect(ctx!.runBranch).toBe('schedule/30/run-5')
    expect(existsSync(ctx!.worktreePath)).toBe(true)
    expect(ctx!.worktreePath).toBe(workspaceDirectory)

    // Verify the API was called correctly
    expect(mockPost).toHaveBeenCalledWith(
      '/experimental/workspace',
      { type: 'worktree', branch: null },
      { directory: repo.fullPath },
    )

    // Verify the branch was re-pointed
    const branch = execSync(`git -C "${workspaceDirectory}" rev-parse --abbrev-ref HEAD`, {
      encoding: 'utf-8',
    }).trim()
    expect(branch).toBe('schedule/30/run-5')

    // Cleanup
    await cleanup()
  })

  it('prepare falls back to raw git when postJson rejects', async () => {
    mockOpenCodeClient.postJson = vi.fn().mockRejectedValue(new Error('API unavailable'))

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 40, branch: null }
    const runId = 10

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBeNull()
    expect(ctx!.autoBranch).toBeNull()
    expect(ctx!.runBranch).toBe('schedule/40/run-10')
    expect(existsSync(ctx!.worktreePath)).toBe(true)

    // The worktree path should be under scheduleWorktreesRoot (raw git path)
    expect(ctx!.worktreePath).toContain(scheduleWorktreesRoot)

    // Cleanup
    const { removeWorktree } = await import('../../src/services/repo')
    await removeWorktree(baseRepoPath, ctx!.worktreePath)
  })

  it('finalize deletes workspace via API when workspaceId is set', async () => {
    const { directory: workspaceDirectory, cleanup } = await createWorktreeWorkspace('oc-finalize-test')

    const workspaceId = 'ws-finalize-456'
    mockOpenCodeClient.postJson = vi.fn().mockResolvedValue({
      id: workspaceId,
      directory: workspaceDirectory,
      branch: null,
    })

    const deleteMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    mockOpenCodeClient.forward = deleteMock

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 50, branch: null, name: 'Finalize API' }
    const runId = 300

    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBe(workspaceId)

    // Write a file so there are changes to commit
    writeFileSync(path.join(workspaceDirectory, 'output.md'), '# API Finalize Test')

    const result = await manager.finalize(
      repo,
      { id: 50, name: 'Finalize API', prompt: 'test' },
      { id: runId, worktreePath: workspaceDirectory, runBranch: ctx!.runBranch, triggerSource: 'manual', workspaceId: ctx!.workspaceId },
    )

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)

    // Verify DELETE was called with the correct workspaceId
    expect(deleteMock).toHaveBeenCalledWith({
      method: 'DELETE',
      path: `/experimental/workspace/${encodeURIComponent(workspaceId)}`,
      directory: repo.fullPath,
    })

    // The commit must still be reachable on the runBranch in the base repo
    const log = execSync(`git -C "${baseRepoPath}" log "${ctx!.runBranch}" --oneline`, {
      encoding: 'utf-8',
    }).trim()
    expect(log).toBeTruthy()

    // Clean up in case the API mock didn't actually remove the worktree
    await cleanup()
  })

  it('finalize falls back to raw removeWorktree when workspace DELETE fails', async () => {
    const { directory: workspaceDirectory, cleanup } = await createWorktreeWorkspace('oc-delete-fail')

    const workspaceId = 'ws-delete-fail-789'
    mockOpenCodeClient.postJson = vi.fn().mockResolvedValue({
      id: workspaceId,
      directory: workspaceDirectory,
      branch: null,
    })
    // DELETE returns non-ok response → triggers fallback removeWorktree
    mockOpenCodeClient.forward = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 60, branch: null, name: 'Delete Fail' }
    const runId = 400

    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBe(workspaceId)

    writeFileSync(path.join(workspaceDirectory, 'data.txt'), 'test data')

    const result = await manager.finalize(
      repo,
      { id: 60, name: 'Delete Fail', prompt: 'test' },
      { id: runId, worktreePath: workspaceDirectory, runBranch: ctx!.runBranch, triggerSource: 'manual', workspaceId: ctx!.workspaceId },
    )

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)
    // Directory should be cleaned up (via fallback removeWorktree)
    expect(existsSync(workspaceDirectory)).toBe(false)

    // Clean up in case the directory somehow still exists
    await cleanup()
  })

  it('finalize restores run branch if OpenCode delete removed it', async () => {
    const { directory: workspaceDirectory, cleanup } = await createWorktreeWorkspace('oc-branch-restore')

    const workspaceId = 'ws-branch-restore-101'
    mockOpenCodeClient.postJson = vi.fn().mockResolvedValue({
      id: workspaceId,
      directory: workspaceDirectory,
      branch: null,
    })
    mockOpenCodeClient.forward = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 70, branch: null, name: 'Branch Restore' }
    const runId = 500

    const ctx = await manager.prepare(repo, job, runId)
    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBe(workspaceId)

    writeFileSync(path.join(workspaceDirectory, 'important.md'), '# Branch Restore Test')

    // Simulate: API delete removes the branch.  First detach the worktree
    // HEAD so git allows the deletion (OpenCode's workspace DELETE handles
    // the worktree-level cleanup first, then the branch goes away).
    const runBranch = ctx!.runBranch!
    execSync(`git -C "${workspaceDirectory}" checkout --detach`, { env })
    execSync(`git -C "${baseRepoPath}" branch -D "${runBranch}"`, { env })

    const result = await manager.finalize(
      repo,
      { id: 70, name: 'Branch Restore', prompt: 'test' },
      { id: runId, worktreePath: workspaceDirectory, runBranch, triggerSource: 'manual', workspaceId: ctx!.workspaceId },
    )

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/)

    // Branch should have been restored by finalize
    const branchExists = execSync(`git -C "${baseRepoPath}" rev-parse --verify "refs/heads/${runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(branchExists).toBeTruthy()

    // And the commit hash should match
    const branchCommit = execSync(`git -C "${baseRepoPath}" rev-parse "${runBranch}"`, {
      encoding: 'utf-8',
    }).trim()
    expect(branchCommit).toBe(result.commitHash)

    await cleanup()
  })

  it('prepare returns workspaceId null on postJson failure (fallback path)', async () => {
    mockOpenCodeClient.postJson = vi.fn().mockRejectedValue(new Error('Network error'))

    const manager = await createManager()
    const repo = testRepo()
    const job = { id: 80, branch: 'main' }
    const runId = 15

    const ctx = await manager.prepare(repo, job, runId)

    expect(ctx).not.toBeNull()
    expect(ctx!.workspaceId).toBeNull()
    expect(ctx!.runBranch).toBe('schedule/80/run-15')
    expect(existsSync(ctx!.worktreePath)).toBe(true)
    expect(ctx!.worktreePath).toContain(scheduleWorktreesRoot)

    // Cleanup
    const { removeWorktree } = await import('../../src/services/repo')
    await removeWorktree(baseRepoPath, ctx!.worktreePath)
  })
})
