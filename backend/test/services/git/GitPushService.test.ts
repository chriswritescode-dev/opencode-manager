import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitPushService } from '../../../src/services/git/GitPushService'
import type { Database } from 'bun:sqlite'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'
import { GitAuthService } from '../../../src/utils/git-auth'

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('../../../src/utils/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => ({
    getGitEnvironment: vi.fn(),
  })),
}))

describe('GitPushService', () => {
  let service: GitPushService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    const gitAuthService = new GitAuthService()
    gitAuthService.getGitEnvironment.mockReturnValue({})
    service = new GitPushService(gitAuthService)
  })

  describe('push', () => {
    it('pushes changes to remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('Everything up-to-date')

      const result = await service.push(1, {}, database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'push'],
        { env: expect.any(Object) }
      )
      expect(result).toEqual({ stdout: 'Everything up-to-date', stderr: '' })
    })

    it('pushes changes with upstream flag', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('Branch set up to track remote branch')

      const result = await service.push(1, { setUpstream: true }, database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'push', '--set-upstream', 'origin', 'HEAD'],
        { env: expect.any(Object) }
      )
      expect(result).toEqual({ stdout: 'Branch set up to track remote branch', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.push(999, {}, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when push command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Authentication failed'))

      await expect(service.push(1, {}, database)).rejects.toThrow()
    })

    it('throws error when push command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Authentication failed'))

      await expect(service.push(1, {}, database)).rejects.toThrow()
    })
  })

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      executeCommand.mockResolvedValue('main\n')

      const result = await service.getCurrentBranch('/path/to/repo', database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env: expect.any(Object), silent: true }
      )
      expect(result).toBe('main')
    })

    it('trims whitespace from branch name', async () => {
      executeCommand.mockResolvedValue('  develop  \n')

      const result = await service.getCurrentBranch('/path/to/repo', database)

      expect(result).toBe('develop')
    })

    it('throws error when command fails', async () => {
      executeCommand.mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getCurrentBranch('/path/to/repo', database)).rejects.toThrow()
    })

    it('throws error when HEAD is not a branch', async () => {
      executeCommand.mockResolvedValue('HEAD\n')

      const result = await service.getCurrentBranch('/path/to/repo', database)

      expect(result).toBe('HEAD')
    })
  })

  describe('getUpstreamBranch', () => {
    it('returns upstream branch name', async () => {
      executeCommand.mockResolvedValue('origin/main\n')

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rev-parse', '--abbrev-ref', '@{upstream}'],
        { env: expect.any(Object), silent: true }
      )
      expect(result).toBe('origin/main')
    })

    it('returns null when no upstream configured', async () => {
      executeCommand.mockRejectedValue(new Error('fatal: no upstream configured'))

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(result).toBeNull()
    })

    it('returns null when fatal error indicates no upstream', async () => {
      executeCommand.mockRejectedValue(new Error('fatal: invalid upstream'))

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(result).toBeNull()
    })

    it('returns null when error indicates branch does not point at branch', async () => {
      executeCommand.mockRejectedValue(new Error('fatal: HEAD does not point at a branch'))

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(result).toBeNull()
    })

    it('returns null when upstream is empty string', async () => {
      executeCommand.mockResolvedValue('  \n')

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(result).toBeNull()
    })

    it('throws error on other failures', async () => {
      executeCommand.mockRejectedValue(new Error('Permission denied'))

      await expect(service.getUpstreamBranch('/path/to/repo', database)).rejects.toThrow()
    })

    it('trims whitespace from upstream branch', async () => {
      executeCommand.mockResolvedValue('  origin/feature  \n')

      const result = await service.getUpstreamBranch('/path/to/repo', database)

      expect(result).toBe('origin/feature')
    })
  })
})
