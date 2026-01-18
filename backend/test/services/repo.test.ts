import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'

const executeCommand = vi.fn()
const ensureDirectoryExists = vi.fn()

const getRepoByLocalPath = vi.fn()
const createRepo = vi.fn()
const updateRepoStatus = vi.fn()
const deleteRepo = vi.fn()

vi.mock('../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists,
}))

vi.mock('../../src/db/queries', () => ({
  getRepoByLocalPath,
  createRepo,
  updateRepoStatus,
  deleteRepo,
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: () => ({
      preferences: {
        gitCredentials: [],
      },
      updatedAt: Date.now(),
    }),
  })),
}))

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({}),
} as unknown as GitAuthService

describe('initLocalRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    executeCommand.mockResolvedValue('')
    ensureDirectoryExists.mockResolvedValue(undefined)
  })

  it('creates new empty git repo for relative path', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const localPath = 'my-new-repo'
    
    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 1,
      repoUrl: undefined,
      localPath: 'my-new-repo',
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
      isLocal: true,
    })
    
    const result = await initLocalRepo(database, mockGitAuthService, localPath)

    expect(executeCommand).toHaveBeenCalledWith(['git', 'init'], expect.any(Object))
    expect(ensureDirectoryExists).toHaveBeenCalledWith(expect.stringContaining('my-new-repo'))
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(result.cloneStatus).toBe('ready')
  })

  it('copies existing git repo from absolute path', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const absolutePath = '/Users/test/existing-repo'

    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockImplementation((_, input) => ({
      id: 2,
      repoUrl: undefined,
      localPath: input.localPath,
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
      isLocal: true,
    }))

    let callCount = 0
    executeCommand.mockImplementation(async () => {
      callCount++
      if (callCount === 2) return '.git'
      if (callCount === 3) throw new Error('not found')
      if (callCount === 5) return '.git'
      return ''
    })

    const result = await initLocalRepo(database, mockGitAuthService, absolutePath)

    expect(executeCommand).toHaveBeenCalledWith(['test', '-d', '/Users/test/existing-repo'], { silent: true })
    expect(executeCommand).toHaveBeenCalledWith(['git', '-C', '/Users/test/existing-repo', 'rev-parse', '--git-dir'], expect.objectContaining({ silent: true }))
    expect(executeCommand).toHaveBeenCalledWith(['git', 'clone', '--local', '/Users/test/existing-repo', 'existing-repo'], expect.objectContaining({ cwd: getReposPath() }))
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 2, 'ready')
    expect(result.cloneStatus).toBe('ready')
    expect(result.localPath).toBe('existing-repo')
  })

  it('returns existing repo if local path already in database (relative)', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const localPath = 'existing-repo'
    const existingRepo = {
      id: 100,
      localPath: 'existing-repo',
      cloneStatus: 'ready' as const,
    }

    getRepoByLocalPath.mockReturnValue(existingRepo)

    const result = await initLocalRepo(database, mockGitAuthService, localPath)

    expect(result).toBe(existingRepo)
    expect(createRepo).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('throws error when absolute path does not exist', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const nonExistentPath = '/Users/test/non-existent'

    executeCommand.mockRejectedValueOnce(new Error('Command failed'))

    await expect(initLocalRepo(database, mockGitAuthService, nonExistentPath)).rejects.toThrow("No such file or directory")
  })

  it('throws error when repo name already exists in workspace', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const absolutePath = '/Users/test/existing-repo'

    let callCount = 0
    executeCommand.mockImplementation(async () => {
      callCount++
      if (callCount === 2) return '.git'
      if (callCount === 3) return ''
      return ''
    })

    await expect(initLocalRepo(database, mockGitAuthService, absolutePath)).rejects.toThrow("A repository named 'existing-repo' already exists in the workspace")
  })

  it('throws error when absolute path is not a git repo', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const nonGitPath = '/Users/test/not-a-repo'

    let callCount = 0
    executeCommand.mockImplementation(async () => {
      callCount++
      if (callCount === 2) throw new Error('Not a git repo')
      return ''
    })

    await expect(initLocalRepo(database, mockGitAuthService, nonGitPath)).rejects.toThrow("Directory exists but is not a valid Git repository")
  })

  it('creates new empty repo with custom branch', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const localPath = 'custom-branch-repo'
    const branch = 'develop'

    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 3,
      repoUrl: undefined,
      localPath: 'custom-branch-repo',
      branch: 'develop',
      defaultBranch: 'develop',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
      isLocal: true,
    })

    const result = await initLocalRepo(database, mockGitAuthService, localPath, branch)

    expect(executeCommand).toHaveBeenCalledWith(['git', 'init'], expect.any(Object))
    expect(executeCommand).toHaveBeenCalledWith(['git', '-C', expect.any(String), 'checkout', '-b', 'develop'])
    expect(result.defaultBranch).toBe('develop')
  })

  it('normalizes trailing slashes in path', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as any
    const localPath = 'my-repo/'

    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockReturnValue({
      id: 4,
      repoUrl: undefined,
      localPath: 'my-repo',
      defaultBranch: 'main',
      cloneStatus: 'cloning',
      clonedAt: Date.now(),
      isLocal: true,
    })

    const result = await initLocalRepo(database, mockGitAuthService, localPath)

    expect(result.localPath).toBe('my-repo')
  })
})
