import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitPushService } from '../../../src/services/git/GitPushService'
import type { Database } from 'bun:sqlite'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getRepoById } from '../../../src/db/queries'
import { GitAuthService } from '../../../src/services/git-auth'

vi.mock('../../../src/utils/process', () => ({
  executeCommandMock: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('../../../src/services/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => ({
    getGitEnvironment: vi.fn(),
  })),
}))

const executeCommandMock = vi.mocked(await import('../../../src/utils/process')).executeCommand

describe('GitPushService', () => {
  let service: GitPushService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    const gitAuthService = new GitAuthService()
    ;(gitAuthService.getGitEnvironment as any).mockReturnValue({})
    service = new GitPushService(gitAuthService)
  })

  describe('push', () => {
    it('pushes changes to remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      } as any
      ;(getRepoById as any).mockReturnValue(mockRepo)
      ;(executeCommandMock as any).mockResolvedValue('Everything up-to-date')

      const result = await service.push(1, {}, database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'push'],
        { env: expect.any(Object) }
      )
      expect(result).toEqual({ stdout: 'Everything up-to-date', stderr: '' })
    })

    it('pushes changes with upstream flag', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      } as any
      ;(getRepoById as any).mockReturnValue(mockRepo)
      ;(executeCommandMock as any).mockResolvedValue('Branch set up to track remote branch')

      const result = await service.push(1, { setUpstream: true }, database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'push', '--set-upstream', 'origin', 'HEAD'],
        { env: expect.any(Object) }
      )
      expect(result).toEqual({ stdout: 'Branch set up to track remote branch', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      ;(getRepoById as any).mockReturnValue(null)

      await expect(service.push(999, {}, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when push command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      } as any
      ;(getRepoById as any).mockReturnValue(mockRepo)
      ;(executeCommandMock as any).mockRejectedValue(new Error('Authentication failed'))

      await expect(service.push(1, {}, database)).rejects.toThrow()
    })

  })

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      ;(executeCommandMock as any).mockResolvedValue('main\n')

      const result = await service.getCurrentBranch('/path/to/repo')

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
        { env: expect.any(Object), silent: true }
      )
      expect(result).toBe('main')
    })

    it('trims whitespace from branch name', async () => {
      ;(executeCommandMock as any).mockResolvedValue('  develop  \n')

      const result = await service.getCurrentBranch('/path/to/repo')

      expect(result).toBe('develop')
    })

    it('throws error when command fails', async () => {
      ;(executeCommandMock as any).mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getCurrentBranch('/path/to/repo')).rejects.toThrow()
    })

    it('throws error when HEAD is not a branch', async () => {
      ;(executeCommandMock as any).mockResolvedValue('HEAD\n')

      const result = await service.getCurrentBranch('/path/to/repo')

      expect(result).toBe('HEAD')
    })
  })

  describe('getUpstreamBranch', () => {
    it('returns upstream branch name', async () => {
      ;(executeCommandMock as any).mockResolvedValue('origin/main\n')

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rev-parse', '--abbrev-ref', '@{upstream}'],
        { env: expect.any(Object), silent: true }
      )
      expect(result).toBe('origin/main')
    })

    it('returns null when no upstream configured', async () => {
      ;(executeCommandMock as any).mockRejectedValue(new Error('fatal: no upstream configured'))

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(result).toBeNull()
    })

    it('returns null when fatal error indicates no upstream', async () => {
      ;(executeCommandMock as any).mockRejectedValue(new Error('fatal: invalid upstream'))

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(result).toBeNull()
    })

    it('returns null when error indicates branch does not point at branch', async () => {
      ;(executeCommandMock as any).mockRejectedValue(new Error('fatal: HEAD does not point at a branch'))

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(result).toBeNull()
    })

    it('returns null when upstream is empty string', async () => {
      ;(executeCommandMock as any).mockResolvedValue('  \n')

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(result).toBeNull()
    })

    it('throws error on other failures', async () => {
      ;(executeCommandMock as any).mockRejectedValue(new Error('Permission denied'))

      await expect(service.getUpstreamBranch('/path/to/repo')).rejects.toThrow()
    })

    it('trims whitespace from upstream branch', async () => {
      ;(executeCommandMock as any).mockResolvedValue('  origin/feature  \n')

      const result = await service.getUpstreamBranch('/path/to/repo')

      expect(result).toBe('origin/feature')
    })
  })
})
