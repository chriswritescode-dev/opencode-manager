/* eslint-disable @typescript-eslint/no-require-imports */
const mockFetchPullService = {
  fetch: vi.fn(),
  pull: vi.fn(),
}

const mockBranchService = {
  getBranches: vi.fn(),
  getBranchStatus: vi.fn(),
  createBranch: vi.fn(),
  switchBranch: vi.fn(),
  hasCommits: vi.fn(),
}

vi.mock('../../../src/services/git/GitFetchPullService', () => ({
  GitFetchPullService: vi.fn().mockImplementation(() => mockFetchPullService),
}))

vi.mock('../../../src/services/git/GitBranchService', () => ({
  GitBranchService: vi.fn().mockImplementation(() => mockBranchService),
}))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitFetchService } from '../../../src/services/git/GitFetchService'
import type { Database } from 'bun:sqlite'
import { spawn } from 'child_process'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'
import { GitFetchPullService } from '../../../src/services/git/GitFetchPullService'
import { GitBranchService } from '../../../src/services/git/GitBranchService'

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

describe('GitFetchService', () => {
  let service: GitFetchService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    spawn.mockClear()
    const fetchPullService = new GitFetchPullService()
    const branchService = new GitBranchService()
    service = new GitFetchService(fetchPullService, branchService)
  })

  describe('fetch', () => {
    it('fetches all changes from remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      mockFetchPullService.fetch.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await service.fetch(1, database)

      expect(mockFetchPullService.fetch).toHaveBeenCalledWith(1, database)
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      mockFetchPullService.fetch.mockRejectedValue(new Error('Repository not found'))

      await expect(service.fetch(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when fetch command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      mockFetchPullService.fetch.mockRejectedValue(new Error('Failed to fetch changes'))

      await expect(service.fetch(1, database)).rejects.toThrow('Failed to fetch changes')
    })

    it('throws error when fetch command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn((event, callback) => { if (event === 'data') callback(Buffer.from('Fetch failed')) }) },
        on: vi.fn((event, callback) => { if (event === 'close') callback(128) }),
      }
      spawn.mockReturnValue(mockProc)

      await expect(service.fetch(1, database)).rejects.toThrow('Failed to fetch changes')
    })
  })

  describe('pull', () => {
    it('pulls changes from remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      mockFetchPullService.pull.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await service.pull(1, database)

      expect(mockFetchPullService.pull).toHaveBeenCalledWith(1, database)
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      mockFetchPullService.pull.mockRejectedValue(new Error('Repository not found'))

      await expect(service.pull(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when pull command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      mockFetchPullService.pull.mockRejectedValue(new Error('Failed to pull changes'))

      await expect(service.pull(1, database)).rejects.toThrow('Failed to pull changes')
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      mockFetchPullService.pull.mockRejectedValue(new Error('Repository not found'))

      await expect(service.pull(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when pull command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      mockFetchPullService.pull.mockRejectedValue(new Error('Failed to pull changes'))

      await expect(service.pull(1, database)).rejects.toThrow('Failed to pull changes')
    })
  })

  describe('hasCommits', () => {
    it('returns true when repository has commits', async () => {
      mockBranchService.hasCommits.mockResolvedValue(true)

      const result = await service.hasCommits('/path/to/repo')

      expect(mockBranchService.hasCommits).toHaveBeenCalledWith('/path/to/repo')
      expect(result).toBe(true)
    })

    it('returns false when repository has no commits', async () => {
      mockBranchService.hasCommits.mockResolvedValue(false)

      const result = await service.hasCommits('/path/to/repo')

      expect(mockBranchService.hasCommits).toHaveBeenCalledWith('/path/to/repo')
      expect(result).toBe(false)
    })

    it('returns false when HEAD does not exist', async () => {
      mockBranchService.hasCommits.mockResolvedValue(false)

      const result = await service.hasCommits('/path/to/repo')

      expect(result).toBe(false)
    })
  })
})
