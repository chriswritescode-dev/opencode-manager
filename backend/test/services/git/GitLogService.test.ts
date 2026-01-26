/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

vi.mock('../../../src/services/settings', () => ({
  SettingsService: vi.fn()
}))

import { GitLogService } from '../../../src/services/git/GitLogService'
import type { Database } from 'bun:sqlite'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'

const mockGitAuthService = {
  getGitEnvironment: vi.fn(),
}

const mockGitDiffService = {
  getFileDiff: vi.fn(),
}

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('../../../src/services/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => mockGitAuthService),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/repos'),
}))

const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
const getRepoByIdMock = getRepoById as MockedFunction<typeof getRepoById>

describe('GitLogService', () => {
  let service: GitLogService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    service = new GitLogService(mockGitAuthService as any, mockGitDiffService as any)
    mockGitAuthService.getGitEnvironment.mockResolvedValue({})
  })

  describe('getLog', () => {
    it('returns list of commits', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce(
          'abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|First commit\n' +
          'def456|Jane Smith|jane@example.com|2024-01-02 13:00:00 +0000|Second commit'
        )
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'log', '--all', '-n', '10', '--format=%H|%an|%ae|%ai|%s'],
        { env: expect.any(Object) }
      )
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-01-01 12:00:00 +0000',
        message: 'First commit',
        unpushed: false,
      })
      expect(result[1]).toEqual({
        hash: 'def456',
        authorName: 'Jane Smith',
        authorEmail: 'jane@example.com',
        date: '2024-01-02 13:00:00 +0000',
        message: 'Second commit',
        unpushed: false,
      })
    })

    it('respects limit parameter', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|First commit')
        .mockResolvedValueOnce('')

      await service.getLog(1, database, 5)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/repos/test-repo', 'log', '--all', '-n', '5', '--format=%H|%an|%ae|%ai|%s'],
        { env: expect.any(Object) }
      )
    })

    it('handles commits with empty messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toHaveLength(1)
      expect(result[0]?.message).toBe('')
    })

    it('handles commits with multi-line messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Multi|line commit')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toHaveLength(1)
      expect(result[0]?.message).toBe('Multi|line commit')
    })

    it('handles empty log output', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toEqual([])
    })

    it('handles whitespace lines in output', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('\n\nabc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test\n\n')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toHaveLength(1)
      expect(result[0]?.hash).toBe('abc123')
    })

    it('skips lines without hash', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('|John Doe|john@example.com|2024-01-01 12:00:00 +0000|No hash')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toEqual([])
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getLog(999, database, 10)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when log command fails', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getLog(1, database, 10)).rejects.toThrow('Failed to get git log')
    })

    it('skips commits with invalid date format', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce(
          'abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Valid commit\n' +
          'def456|Jane Smith|jane@example.com|invalid-date|Invalid date\n' +
          'ghi789|Bob Wilson|bob@example.com||Missing date\n'
        )
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '2024-01-01 12:00:00 +0000',
        message: 'Valid commit',
        unpushed: false,
      })
    })

    it('handles malformed git output with insufficient fields', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce('abc123|John Doe|john@example.com')
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toEqual([])
    })
  })

  describe('getCommit', () => {
    it('returns commit details for valid hash', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test commit')

      const result = await service.getCommit(1, 'abc123', database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
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
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await service.getCommit(1, 'nonexistent', database)

      expect(result).toBeNull()
    })

    it('returns null when output is empty', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('  ')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).toBeNull()
    })

    it('returns null when hash field is empty', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('|John Doe|john@example.com|2024-01-01 12:00:00 +0000|Test')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).toBeNull()
    })

    it('handles commits with empty messages', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('abc123|John Doe|john@example.com|2024-01-01 12:00:00 +0000|')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).not.toBeNull()
      expect(result?.message).toBe('')
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getCommit(999, 'abc123', database)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when command fails', async () => {
      const mockRepo = {
        id: 1,
        localPath: 'test-repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error('Invalid commit hash'))

      await expect(service.getCommit(1, 'invalid', database)).rejects.toThrow('Failed to get commit')
    })
  })

  describe('getDiff', () => {
    it('returns diff for file', async () => {
      const expectedDiff = 'diff --git a/file.ts b/file.ts\nindex 123..456 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line'
      mockGitDiffService.getFileDiff.mockResolvedValue({ diff: expectedDiff })

      const result = await service.getDiff(1, 'file.ts', database)

      expect(mockGitDiffService.getFileDiff).toHaveBeenCalledWith(1, 'file.ts', database)
      expect(result).toBe(expectedDiff)
    })

    it('returns empty diff when file has no changes', async () => {
      mockGitDiffService.getFileDiff.mockResolvedValue({ diff: '' })

      const result = await service.getDiff(1, 'file.ts', database)

      expect(result).toBe('')
    })

    it('throws error when diff command fails', async () => {
      mockGitDiffService.getFileDiff.mockRejectedValue(new Error('Repository not found: 999'))

      await expect(service.getDiff(999, 'file.ts', database)).rejects.toThrow('Repository not found: 999')
    })
  })
})
