import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getReposPath } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../../src/services/git-auth'

const executeCommand = vi.fn()
const ensureDirectoryExists = vi.fn()

const getRepoByLocalPath = vi.fn()
const getRepoBySourcePath = vi.fn()
const createRepo = vi.fn()
const updateRepoStatus = vi.fn()
const updateRepoBranch = vi.fn()
const deleteRepo = vi.fn()

const lstat = vi.fn()
const stat = vi.fn()
const readdir = vi.fn()
const mkdir = vi.fn()
const symlink = vi.fn()
const readlink = vi.fn()

vi.mock('fs/promises', () => ({
  default: {
    lstat,
    stat,
    readdir,
    mkdir,
    symlink,
    readlink,
  },
}))

vi.mock('../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../src/services/file-operations', () => ({
  ensureDirectoryExists,
}))

vi.mock('../../src/db/queries', () => ({
  getRepoByLocalPath,
  getRepoBySourcePath,
  createRepo,
  updateRepoStatus,
  updateRepoBranch,
  deleteRepo,
}))

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({}),
} as unknown as GitAuthService

function createDirectoryStat() {
  return {
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  }
}

function createFileStat() {
  return {
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  }
}

function createDirent(name: string) {
  return {
    name,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }
}

function createEnoentError(targetPath: string) {
  return Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' })
}

describe('repo service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureDirectoryExists.mockResolvedValue(undefined)
    mkdir.mockResolvedValue(undefined)
    symlink.mockResolvedValue(undefined)
    readlink.mockResolvedValue('')
    readdir.mockResolvedValue([])
    stat.mockResolvedValue(createDirectoryStat())
    executeCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('--git-dir')) {
        return '.git'
      }

      if (args.includes('HEAD') && !args.includes('--abbrev-ref')) {
        return 'abc123'
      }

      if (args.includes('--abbrev-ref')) {
        return 'main'
      }

      return ''
    })
  })

  it('creates a new empty git repo for a relative path', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as never

    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockImplementation((_, input) => ({
      id: 1,
      localPath: input.localPath,
      fullPath: path.join(getReposPath(), input.localPath),
      defaultBranch: input.defaultBranch,
      cloneStatus: input.cloneStatus,
      clonedAt: input.clonedAt,
      isLocal: true,
    }))

    const result = await initLocalRepo(database, mockGitAuthService, 'my-new-repo')

    expect(ensureDirectoryExists).toHaveBeenCalledWith(expect.stringContaining('my-new-repo'))
    expect(executeCommand).toHaveBeenCalledWith(['git', 'init'], expect.any(Object))
    expect(updateRepoStatus).toHaveBeenCalledWith(database, 1, 'ready')
    expect(result.cloneStatus).toBe('ready')
    expect(result.fullPath).toContain('my-new-repo')
  })

  it('links an absolute git repo in place and preserves its source path', async () => {
    const { initLocalRepo } = await import('../../src/services/repo')
    const database = {} as never
    const absolutePath = '/Users/test/existing-repo'
    const aliasPath = path.join(getReposPath(), 'existing-repo')

    getRepoBySourcePath.mockReturnValue(null)
    getRepoByLocalPath.mockReturnValue(null)
    createRepo.mockImplementation((_, input) => ({
      id: 2,
      localPath: input.localPath,
      sourcePath: input.sourcePath,
      fullPath: input.sourcePath ?? path.join(getReposPath(), input.localPath),
      branch: input.branch,
      defaultBranch: input.defaultBranch,
      cloneStatus: input.cloneStatus,
      clonedAt: input.clonedAt,
      isLocal: true,
      isWorktree: input.isWorktree,
    }))

    lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === absolutePath) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(absolutePath, '.git')) {
        return createDirectoryStat()
      }

      if (targetPath === aliasPath) {
        throw createEnoentError(targetPath)
      }

      throw createEnoentError(targetPath)
    })

    const result = await initLocalRepo(database, mockGitAuthService, absolutePath)

    expect(createRepo).toHaveBeenCalledWith(database, expect.objectContaining({
      localPath: 'existing-repo',
      sourcePath: absolutePath,
      cloneStatus: 'ready',
      isLocal: true,
    }))
    expect(symlink).toHaveBeenCalledWith(absolutePath, aliasPath, 'dir')
    expect(result.localPath).toBe('existing-repo')
    expect(result.sourcePath).toBe(absolutePath)
    expect(result.fullPath).toBe(absolutePath)
  })

  it('discovers nested repos and keeps existing registrations', async () => {
    const { discoverLocalRepos } = await import('../../src/services/repo')
    const database = {} as never
    const rootPath = '/Users/test/projects'
    const existingRepo = {
      id: 9,
      localPath: 'app-two',
      sourcePath: '/Users/test/projects/nested/app-two',
      fullPath: '/Users/test/projects/nested/app-two',
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
      isLocal: true,
      isWorktree: true,
    }

    getRepoByLocalPath.mockReturnValue(null)
    getRepoBySourcePath.mockImplementation((_, sourcePath: string) => {
      if (sourcePath === existingRepo.sourcePath) {
        return existingRepo
      }

      return null
    })
    createRepo.mockImplementation((_, input) => ({
      id: 3,
      localPath: input.localPath,
      sourcePath: input.sourcePath,
      fullPath: input.sourcePath ?? path.join(getReposPath(), input.localPath),
      branch: input.branch,
      defaultBranch: input.defaultBranch,
      cloneStatus: input.cloneStatus,
      clonedAt: input.clonedAt,
      isLocal: true,
      isWorktree: input.isWorktree,
    }))

    lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === path.join(rootPath, 'app-one')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, 'nested')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, 'nested', 'app-two')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, '.git')) {
        throw createEnoentError(targetPath)
      }

      if (targetPath === path.join(rootPath, 'app-one', '.git')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, 'nested', '.git')) {
        throw createEnoentError(targetPath)
      }

      if (targetPath === path.join(rootPath, 'nested', 'app-two', '.git')) {
        return createFileStat()
      }

      if (targetPath === path.join(getReposPath(), 'app-one')) {
        throw createEnoentError(targetPath)
      }

      throw createEnoentError(targetPath)
    })

    readdir.mockImplementation(async (targetPath: string) => {
      if (targetPath === rootPath) {
        return [createDirent('app-one'), createDirent('nested')]
      }

      if (targetPath === path.join(rootPath, 'nested')) {
        return [createDirent('app-two')]
      }

      return []
    })

    const result = await discoverLocalRepos(database, mockGitAuthService, rootPath)

    expect(result.discoveredCount).toBe(1)
    expect(result.existingCount).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.repos).toHaveLength(2)
    expect(result.repos.map((repo) => repo.fullPath)).toContain('/Users/test/projects/app-one')
    expect(result.repos.map((repo) => repo.fullPath)).toContain(existingRepo.fullPath)
    expect(symlink).toHaveBeenCalledTimes(1)
  })

  it('continues discovery when a nested directory cannot be read', async () => {
    const { discoverLocalRepos } = await import('../../src/services/repo')
    const database = {} as never
    const rootPath = '/Users/test/projects'

    getRepoByLocalPath.mockReturnValue(null)
    getRepoBySourcePath.mockReturnValue(null)
    createRepo.mockImplementation((_, input) => ({
      id: 4,
      localPath: input.localPath,
      sourcePath: input.sourcePath,
      fullPath: input.sourcePath ?? path.join(getReposPath(), input.localPath),
      branch: input.branch,
      defaultBranch: input.defaultBranch,
      cloneStatus: input.cloneStatus,
      clonedAt: input.clonedAt,
      isLocal: true,
      isWorktree: input.isWorktree,
    }))

    lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === rootPath || targetPath === path.join(rootPath, 'app-one') || targetPath === path.join(rootPath, 'restricted')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, '.git')) {
        throw createEnoentError(targetPath)
      }

      if (targetPath === path.join(rootPath, 'app-one', '.git')) {
        return createDirectoryStat()
      }

      if (targetPath === path.join(rootPath, 'restricted', '.git')) {
        throw createEnoentError(targetPath)
      }

      if (targetPath === path.join(getReposPath(), 'app-one')) {
        throw createEnoentError(targetPath)
      }

      throw createEnoentError(targetPath)
    })

    readdir.mockImplementation(async (targetPath: string) => {
      if (targetPath === rootPath) {
        return [createDirent('app-one'), createDirent('restricted')]
      }

      if (targetPath === path.join(rootPath, 'restricted')) {
        throw new Error('EACCES: permission denied')
      }

      return []
    })

    const result = await discoverLocalRepos(database, mockGitAuthService, rootPath)

    expect(result.discoveredCount).toBe(1)
    expect(result.existingCount).toBe(0)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]?.fullPath).toBe('/Users/test/projects/app-one')
    expect(result.errors).toEqual([
      {
        path: '/Users/test/projects/restricted',
        error: 'EACCES: permission denied',
      },
    ])
  })

  it('relinks imported session directories to nearest git repo roots', async () => {
    const { relinkReposFromSessionDirectories } = await import('../../src/services/repo')
    const database = {} as never
    const repoRoot = '/Users/test/projects/app-one'
    const aliasPath = path.join(getReposPath(), 'app-one')

    getRepoByLocalPath.mockReturnValue(null)
    getRepoBySourcePath.mockReturnValue(null)
    createRepo.mockImplementation((_, input) => ({
      id: 5,
      localPath: input.localPath,
      sourcePath: input.sourcePath,
      fullPath: input.sourcePath ?? path.join(getReposPath(), input.localPath),
      branch: input.branch,
      defaultBranch: input.defaultBranch,
      cloneStatus: input.cloneStatus,
      clonedAt: input.clonedAt,
      isLocal: true,
      isWorktree: input.isWorktree,
    }))

    lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === repoRoot || targetPath === path.join(repoRoot, '.git')) {
        return createDirectoryStat()
      }

      if (targetPath === aliasPath) {
        throw createEnoentError(targetPath)
      }

      throw createEnoentError(targetPath)
    })

    executeCommand.mockImplementation(async (args: string[]) => {
      if (args.includes('--show-toplevel')) {
        if (args[2] === '/Users/test/projects/not-a-repo') {
          throw new Error('not a git repository')
        }
        return `${repoRoot}\n`
      }

      if (args.includes('--git-dir')) {
        return '.git'
      }

      if (args.includes('HEAD') && !args.includes('--abbrev-ref')) {
        return 'abc123'
      }

      if (args.includes('--abbrev-ref')) {
        return 'main'
      }

      return ''
    })

    const result = await relinkReposFromSessionDirectories(database, mockGitAuthService, [
      '/Users/test/projects/app-one/apps/web',
      '/Users/test/projects/app-one/packages/api',
      '/Users/test/projects/not-a-repo',
    ])

    expect(result.relinkedCount).toBe(1)
    expect(result.existingCount).toBe(0)
    expect(result.nonRepoPathCount).toBe(1)
    expect(result.duplicatePathCount).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]?.fullPath).toBe(repoRoot)
    expect(createRepo).toHaveBeenCalledTimes(1)
  })
})
