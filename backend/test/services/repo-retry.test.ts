import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'

const executeCommand = vi.fn()
const ensureDirectoryExists = vi.fn()
const existsSync = vi.fn()
const rmSync = vi.fn()

const getRepoById = vi.fn()
const updateRepoStatus = vi.fn()
const updateLastPulled = vi.fn()
const deleteRepo = vi.fn()
const claimRepoForRetry = vi.fn()
const getRepoSetting = vi.fn()
const setRepoSetting = vi.fn()

vi.mock('node:fs', () => ({
  existsSync,
  rmSync,
  realpathSync: vi.fn((p: string) => p),
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists,
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById,
  updateRepoStatus,
  updateLastPulled,
  deleteRepo,
  claimRepoForRetry,
  getRepoSetting,
  setRepoSetting,
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockReturnValue({ preferences: { gitCredentials: [] } }),
  })),
}))

vi.mock('../../src/utils/ssh-key-manager', () => ({
  parseSSHHost: vi.fn((url: string) => ({ user: 'git', host: url, port: null })),
  writeTemporarySSHKey: vi.fn(),
  buildSSHCommand: vi.fn(),
  buildSSHCommandWithKnownHosts: vi.fn(),
  cleanupSSHKey: vi.fn(),
}))

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({}),
  getSSHEnvironment: vi.fn().mockReturnValue({}),
  setupSSHKey: vi.fn(),
  cleanupSSHKey: vi.fn(),
  verifyHostKeyBeforeOperation: vi.fn().mockResolvedValue(true),
  setupSSHForRepoUrl: vi.fn().mockResolvedValue(false),
  setSSHPort: vi.fn(),
} as unknown as GitAuthService

function makeErrorRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 42,
    repoUrl: 'https://github.com/acme/forge.git',
    localPath: 'forge',
    fullPath: '/tmp/repos/forge',
    branch: 'feature/x',
    defaultBranch: 'main',
    cloneStatus: 'error' as const,
    clonedAt: Date.now(),
    ...overrides,
  }
}

describe('repoService.retryCloneRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureDirectoryExists.mockResolvedValue(undefined)
    executeCommand.mockResolvedValue('')
    existsSync.mockReturnValue(false)
    claimRepoForRetry.mockReturnValue(true)
    getRepoSetting.mockReturnValue(null)
    setRepoSetting.mockClear()
  })

  it('throws when the repo row is missing', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(null)
    await expect(retryCloneRepo({} as never, mockGitAuthService, 42)).rejects.toThrow(/not found/)
    expect(updateRepoStatus).not.toHaveBeenCalled()
  })

  it('throws for local-only repos with no stored clone URL', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(makeErrorRepo({ repoUrl: undefined, isLocal: true }))
    await expect(retryCloneRepo({} as never, mockGitAuthService, 42)).rejects.toThrow(/remote repositories/)
    expect(updateRepoStatus).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('throws when the repo is not in a retryable state', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(makeErrorRepo({ cloneStatus: 'ready' as const }))
    await expect(retryCloneRepo({} as never, mockGitAuthService, 42)).rejects.toThrow(/retryable state/)
    expect(updateRepoStatus).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('re-clones using the stored repoUrl/branch/localPath and flips cloning -> ready, preserving id', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(makeErrorRepo())
    existsSync.mockReturnValue(true)
    executeCommand.mockResolvedValue('')

    const result = await retryCloneRepo(database, mockGitAuthService, 42)

    expect(claimRepoForRetry).toHaveBeenCalledWith(database, 42)
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('forge'), { recursive: true, force: true })
    expect(executeCommand).toHaveBeenCalledWith(
      ['git', 'clone', '-b', 'feature/x', 'https://github.com/acme/forge.git', 'forge'],
      expect.objectContaining({ cwd: getReposPath(), timeout: 300000 })
    )
    expect(updateRepoStatus).toHaveBeenLastCalledWith(database, 42, 'ready')
    expect(updateLastPulled).toHaveBeenCalledWith(database, 42)
    expect(deleteRepo).not.toHaveBeenCalled()
    expect(result.id).toBe(42)
    expect(result.localPath).toBe('forge')
    expect(result.branch).toBe('feature/x')
    expect(result.cloneStatus).toBe('ready')
  })

  it('omits the branch flag when the stored branch is undefined', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(makeErrorRepo({ branch: undefined }))
    await retryCloneRepo({} as never, mockGitAuthService, 42)
    expect(executeCommand).toHaveBeenCalledWith(
      ['git', 'clone', 'https://github.com/acme/forge.git', 'forge'],
      expect.objectContaining({ cwd: getReposPath() })
    )
  })

  it('flips the row back to error (never deletes) when the clone fails', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(makeErrorRepo())
    executeCommand.mockRejectedValue(new Error('fatal: Authentication failed'))

    await expect(retryCloneRepo(database, mockGitAuthService, 42)).rejects.toThrow(/Authentication/)

    expect(updateRepoStatus).toHaveBeenLastCalledWith(database, 42, 'error')
    expect(deleteRepo).not.toHaveBeenCalled()
    expect(updateLastPulled).not.toHaveBeenCalled()
  })

  it('rejects a concurrent retry when the atomic error->cloning claim loses', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    claimRepoForRetry.mockReturnValue(false)
    getRepoById.mockReturnValue(makeErrorRepo())

    await expect(retryCloneRepo({} as never, mockGitAuthService, 42)).rejects.toThrow(/already in progress/)

    expect(executeCommand).not.toHaveBeenCalled()
    expect(rmSync).not.toHaveBeenCalled()
    // The losing caller must not touch the row further (no ready/error flip).
    expect(updateRepoStatus).not.toHaveBeenCalled()
    expect(updateLastPulled).not.toHaveBeenCalled()
  })

  it('re-creates a worktree row via git worktree add (not a standalone clone)', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(
      makeErrorRepo({ isWorktree: true, localPath: 'forge-feature-x' })
    )
    existsSync.mockReturnValue(true)
    executeCommand.mockResolvedValue('')

    await retryCloneRepo(database, mockGitAuthService, 42)

    const cloneCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd[0] === 'git' && cmd[1] === 'clone'
    )
    expect(cloneCalls).toHaveLength(0)

    const fetchCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd[0] === 'git' && cmd[1] === '-C' && cmd.includes('fetch')
    )
    expect(fetchCalls.length).toBeGreaterThan(0)

    const worktreeAddCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd.includes('worktree') && cmd.includes('add')
    )
    expect(worktreeAddCalls.length).toBeGreaterThan(0)

    expect(updateRepoStatus).toHaveBeenLastCalledWith(database, 42, 'ready')
    expect(updateLastPulled).toHaveBeenCalledWith(database, 42)
  })

  it('throws when a worktree row has no stored branch (worktree retry needs a branch)', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(makeErrorRepo({ isWorktree: true, branch: undefined }))
    existsSync.mockReturnValue(true)

    await expect(retryCloneRepo({} as never, mockGitAuthService, 42)).rejects.toThrow(/stored branch/)

    const cloneCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd[0] === 'git' && cmd[1] === 'clone'
    )
    expect(cloneCalls).toHaveLength(0)
    const worktreeAddCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd.includes('worktree') && cmd.includes('add')
    )
    expect(worktreeAddCalls).toHaveLength(0)
    expect(updateRepoStatus).toHaveBeenLastCalledWith({}, 42, 'error')
  })

  it('passes the persisted worktree baseBranch to git worktree add -b on retry', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(
      makeErrorRepo({ isWorktree: true, localPath: 'forge-feature-x' })
    )
    existsSync.mockReturnValue(true)
    // Simulate the initial-create failure mode the bug is about: the worktree
    // branch does not exist yet (rev-parse --verify rejects), so the retry
    // must recreate it via `git worktree add -b <branch> <path> <startpoint>`.
    executeCommand.mockImplementation((cmd: unknown) => {
      const args = Array.isArray(cmd) ? (cmd as string[]) : []
      if (args.includes('rev-parse') && args.includes('--verify')) {
        return Promise.reject(new Error('ref not found'))
      }
      return Promise.resolve('')
    })
    getRepoSetting.mockReturnValue('develop')

    await retryCloneRepo(database, mockGitAuthService, 42)

    expect(getRepoSetting).toHaveBeenCalledWith(database, 42, 'worktreeBaseBranch')

    const newBranchAddCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd.includes('worktree') && cmd.includes('add') && cmd.includes('-b')
    )
    expect(newBranchAddCalls.length).toBeGreaterThan(0)
    expect((newBranchAddCalls[0] as unknown as string[])[0]).toContain('develop')
  })

  it('omits the start-point when no worktree baseBranch is persisted', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(
      makeErrorRepo({ isWorktree: true, localPath: 'forge-feature-x' })
    )
    existsSync.mockReturnValue(true)
    executeCommand.mockResolvedValue('')
    getRepoSetting.mockReturnValue(null)

    await retryCloneRepo({} as never, mockGitAuthService, 42)

    const addCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd.includes('worktree') && cmd.includes('add')
    )
    expect(addCalls.length).toBeGreaterThan(0)
    expect((addCalls[0] as unknown as string[])[0]).not.toContain('develop')
  })

it('preserves the persisted skipSSHVerification flag from the original clone on retry', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(makeErrorRepo())
    existsSync.mockReturnValue(false)
    executeCommand.mockResolvedValue('')
    // Persisted setting: the original create ran with host verification
    // skipped; retry must keep that posture rather than re-enabling it.
    getRepoSetting.mockImplementation((db: unknown, id: number, key: string) =>
      key === 'skipSSHVerification' ? 'true' : null
    )

    await retryCloneRepo(database, mockGitAuthService, 42)

    expect(mockGitAuthService.setupSSHForRepoUrl).toHaveBeenCalledWith(
      expect.any(String),
      database,
      true
    )

    const cloneCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && cmd[0] === 'git' && cmd[1] === 'clone'
    )
    expect(cloneCalls.length).toBe(1)
  })

  it('defaults to verifying SSH hosts on retry when the create-time flag was not persisted', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    getRepoById.mockReturnValue(makeErrorRepo())
    existsSync.mockReturnValue(false)
    executeCommand.mockResolvedValue('')
    getRepoSetting.mockReturnValue(null)

    await retryCloneRepo({} as never, mockGitAuthService, 42)

    expect(mockGitAuthService.setupSSHForRepoUrl).toHaveBeenCalledWith(
      expect.any(String),
      {} as never,
      false
    )
  })

  it('falls back to cloning the default branch and creating the requested branch locally when the remote branch is missing on retry', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(makeErrorRepo({ branch: 'feature/ghost' }))
    existsSync.mockReturnValue(false)
    getRepoSetting.mockReturnValue(null)
    let cloneAttempts = 0
    executeCommand.mockImplementation((cmd: unknown) => {
      const args = Array.isArray(cmd) ? (cmd as string[]) : []
      const isCloneWithBranch =
        args[0] === 'git' && args[1] === 'clone' && args.includes('-b')
      if (isCloneWithBranch) {
        cloneAttempts += 1
        return Promise.reject(new Error("Remote branch feature/ghost not found in upstream origin"))
      }
      // The requested branch also does not exist locally yet (rev-parse against
      // refs/heads/feature/ghost rejects), so the retry falls through to
      // `git checkout -b feature/ghost`.
      if (args.includes('rev-parse')) {
        return Promise.reject(new Error('unknown revision'))
      }
      // Default-branch clone and the local branch creation succeed.
      return Promise.resolve('')
    })

    await retryCloneRepo(database, mockGitAuthService, 42)

    const cloneWithBranch = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && (cmd as string[])[0] === 'git'
        && (cmd as string[])[1] === 'clone' && (cmd as string[]).includes('-b')
    )
    const cloneWithoutBranch = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && (cmd as string[])[0] === 'git'
        && (cmd as string[])[1] === 'clone' && !(cmd as string[]).includes('-b')
    )
    expect(cloneWithBranch).toHaveLength(1)
    expect(cloneWithoutBranch).toHaveLength(1)
    expect(cloneAttempts).toBe(1)

    // The requested branch must be created (or checked out) locally after
    // the default-branch clone succeeds, so the row ends up ready with the
    // branch the user originally asked for.
    const checkoutCreateBranch = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && (cmd as string[]).includes('checkout') && (cmd as string[]).includes('-b')
        && (cmd as string[]).includes('feature/ghost')
    )
    expect(checkoutCreateBranch.length).toBe(1)

    expect(updateRepoStatus).toHaveBeenLastCalledWith(database, 42, 'ready')
  })

  it('still surfaces a non-missing-branch clone failure as an error (no spurious fallback)', async () => {
    const { retryCloneRepo } = await import('../../src/services/repo')
    const database = {} as never
    getRepoById.mockReturnValue(makeErrorRepo({ branch: 'feature/x' }))
    existsSync.mockReturnValue(false)
    getRepoSetting.mockReturnValue(null)
    executeCommand.mockRejectedValue(new Error('Authentication failed'))

    await expect(retryCloneRepo(database, mockGitAuthService, 42)).rejects.toThrow(/Authentication/)

    // Only the original `git clone -b feature/x` attempt ran; no fallback
    // default-branch clone was attempted for a non missing-branch error.
    const cloneCalls = executeCommand.mock.calls.filter(
      ([cmd]) => Array.isArray(cmd) && (cmd as string[])[0] === 'git' && (cmd as string[])[1] === 'clone'
    )
    expect(cloneCalls).toHaveLength(1)
    expect(updateRepoStatus).toHaveBeenLastCalledWith(database, 42, 'error')
  })
})
