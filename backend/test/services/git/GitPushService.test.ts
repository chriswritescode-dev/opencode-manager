import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../../../src/services/git-auth'

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

describe('GitPushService', () => {
  let executeCommand: ReturnType<typeof vi.fn>
  let getRepoById: ReturnType<typeof vi.fn>
  let mockGitAuthService: GitAuthService

  beforeEach(async () => {
    vi.clearAllMocks()
    const process = await import('../../../src/utils/process')
    const queries = await import('../../../src/db/queries')
    executeCommand = process.executeCommand as ReturnType<typeof vi.fn>
    getRepoById = queries.getRepoById as ReturnType<typeof vi.fn>
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
  })

  describe('push', () => {
    it('pushes changes to remote', async () => {
      const { GitPushService } = await import('../../../src/services/git/GitPushService')
      const service = new GitPushService(mockGitAuthService)
      const database = {} as Database
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('Everything up-to-date')

      const result = await service.push(1, {}, database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'push'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('Everything up-to-date')
    })

    it('pushes changes with upstream flag', async () => {
      const { GitPushService } = await import('../../../src/services/git/GitPushService')
      const service = new GitPushService(mockGitAuthService)
      const database = {} as Database
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('Branch set up to track remote branch')

      const result = await service.push(1, { setUpstream: true }, database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'push', '--set-upstream', 'origin', 'HEAD'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('Branch set up to track remote branch')
    })

    it('throws error when repository not found', async () => {
      const { GitPushService } = await import('../../../src/services/git/GitPushService')
      const service = new GitPushService(mockGitAuthService)
      const database = {} as Database
      getRepoById.mockReturnValue(null)

      await expect(service.push(999, {}, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when push command fails', async () => {
      const { GitPushService } = await import('../../../src/services/git/GitPushService')
      const service = new GitPushService(mockGitAuthService)
      const database = {} as Database
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Authentication failed'))

      await expect(service.push(1, {}, database)).rejects.toThrow('Authentication failed')
    })
  })
})
