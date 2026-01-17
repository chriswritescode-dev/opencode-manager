/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitLogService } from '../../../src/services/git/GitLogService'
import type { Database } from 'bun:sqlite'

const executeCommand = vi.fn()
const getRepoById = vi.fn()
const getGitEnvironment = vi.fn()

vi.mock('../../../src/utils/process', () => ({
  executeCommand,
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById,
}))

vi.mock('../../../src/services/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => ({
    getGitEnvironment,
  })),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/repos'),
}))

describe('GitLogService', () => {
  let service: GitLogService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    const { GitAuthService } = require('../../../src/services/git-auth')
    const gitAuthService = new GitAuthService()
    service = new GitLogService(gitAuthService)
    getGitEnvironment.mockReturnValue({})
  })

  describe('getLog', () => {
    it('returns list of commits', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue(
        'abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|First commit\n' +
        'def456|Jane Smith|jane@example.com|2024-01-02 13:00:00 +0000|Second commit'
      )

      const result = await service.getLog(1, 10, database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'log', '-n', '10', '--format=%H|%an|%ae|%ai|%s'],
        { env: expect.any(Object) }
      )
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-01-01 12:00:00 +0000',
        message: 'First commit',
      })
      expect(result[1]).toEqual({
        hash: 'def456',
        authorName: 'Jane Smith',
        authorEmail: 'jane@example.com',
        date: '2024-01-02 13:00:00 +0000',
        message: 'Second commit',
      })
    })

    it('respects limit parameter', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|First commit')

      await service.getLog(1, 5, database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'log', '-n', '5', '--format=%H|%an|%ae|%ai|%s'],
        { env: expect.any(Object) }
      )
    })

    it('handles commits with empty messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|')

      const result = await service.getLog(1, 10, database)

      expect(result).toHaveLength(1)
      expect(result[0].message).toBe('')
    })

    it('handles commits with multi-line messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Multi|line commit')

      const result = await service.getLog(1, 10, database)

      expect(result).toHaveLength(1)
      expect(result[0].message).toBe('Multi|line commit')
    })

    it('handles empty log output', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('')

      const result = await service.getLog(1, 10, database)

      expect(result).toEqual([])
    })

    it('handles whitespace lines in output', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('\n\nabc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test\n\n')

      const result = await service.getLog(1, 10, database)

      expect(result).toHaveLength(1)
      expect(result[0].hash).toBe('abc123')
    })

    it('skips lines without hash', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('|John Doe|john@example.com|2024-01-01 12:00:00 +0000|No hash')

      const result = await service.getLog(1, 10, database)

      expect(result).toEqual([])
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.getLog(999, 10, database)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when log command fails', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getLog(1, 10, database)).rejects.toThrow('Failed to get git log')
    })
  })

  describe('getCommit', () => {
    it('returns commit details for valid hash', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test commit')

      const result = await service.getCommit(1, 'abc123', database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'log', '--format=%H|%an|%ae|%ai|%s', 'abc123', '-1'],
        { env: expect.any(Object) }
      )
      expect(result).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-01-01 12:00:00 +0000',
        message: 'Test commit',
      })
    })

    it('returns null when commit hash not found', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('')

      const result = await service.getCommit(1, 'nonexistent', database)

      expect(result).toBeNull()
    })

    it('returns null when output is empty', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('  ')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).toBeNull()
    })

    it('returns null when hash field is empty', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).toBeNull()
    })

    it('handles commits with empty messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).not.toBeNull()
      expect(result?.message).toBe('')
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.getCommit(999, 'abc123', database)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when command fails', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Invalid commit hash'))

      await expect(service.getCommit(1, 'invalid', database)).rejects.toThrow('Failed to get commit')
    })
  })

  describe('getDiff', () => {
    it('returns diff for file', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      const expectedDiff = 'diff --git a/file.ts b/file.ts\nindex 123..456 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line'
      executeCommand.mockResolvedValue(expectedDiff)

      const result = await service.getDiff(1, 'file.ts', database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'diff', '--', 'file.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe(expectedDiff)
    })

    it('returns empty diff when file has no changes', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('')

      const result = await service.getDiff(1, 'file.ts', database)

      expect(result).toBe('')
    })

    it('handles file path with spaces', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('diff --git a/file name.ts b/file name.ts')

      await service.getDiff(1, 'file name.ts', database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'diff', '--', 'file name.ts'],
        { env: expect.any(Object) }
      )
    })

    it('handles nested file paths', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockResolvedValue('diff --git a/src/utils/file.ts b/src/utils/file.ts')

      await service.getDiff(1, 'src/utils/file.ts', database)

      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'diff', '--', 'src/utils/file.ts'],
        { env: expect.any(Object) }
      )
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.getDiff(999, 'file.ts', database)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when diff command fails', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Path does not exist'))

      await expect(service.getDiff(1, 'nonexistent.ts', database)).rejects.toThrow('Failed to get diff')
    })
  })
})
