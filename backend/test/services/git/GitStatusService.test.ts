/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitStatusService } from '../../../src/services/git/GitStatusService'
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

vi.mock('../../../src/utils/git-auth', () => ({
  GitAuthService: vi.fn().mockImplementation(() => ({
    getGitEnvironment,
  })),
}))

describe('GitStatusService', () => {
  let service: GitStatusService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    const { GitAuthService } = require('../../../src/utils/git-auth')
    const gitAuthService = new GitAuthService()
    service = new GitStatusService(gitAuthService)
    getGitEnvironment.mockReturnValue({})
  })

  describe('getStatus', () => {
    it('returns empty status for clean repository', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.branch).toBe('main')
      expect(result.ahead).toBe(0)
      expect(result.behind).toBe(0)
      expect(result.files).toEqual([])
      expect(result.hasChanges).toBe(false)
    })

    it('parses modified files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('MM file.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
      expect(result.files[1]).toEqual({ path: 'file.ts', status: 'modified', staged: false })
      expect(result.hasChanges).toBe(true)
    })

    it('parses staged files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('M  file1.ts\nA  file2.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ path: 'file1.ts', status: 'modified', staged: true })
      expect(result.files[1]).toEqual({ path: 'file2.ts', status: 'added', staged: true })
    })

    it('parses deleted files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('D  file1.ts\n D file2.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ path: 'file1.ts', status: 'deleted', staged: true })
      expect(result.files[1]).toEqual({ path: 'file2.ts', status: 'deleted', staged: false })
    })

    it('parses renamed files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('R  old.ts\nR  new.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ path: 'old.ts', status: 'renamed', staged: true })
      expect(result.files[1]).toEqual({ path: 'new.ts', status: 'renamed', staged: true })
    })

    it('parses untracked files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('?? newfile.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'newfile.ts', status: 'untracked', staged: false })
    })

    it('parses copied files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('C  original.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'original.ts', status: 'copied', staged: true })
    })

    it('parses mixed status output', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('MM file1.ts\nA  file2.ts\n?? file3.ts\nD  file4.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(5)
      expect(result.files).toContainEqual({ path: 'file1.ts', status: 'modified', staged: true })
      expect(result.files).toContainEqual({ path: 'file1.ts', status: 'modified', staged: false })
      expect(result.files).toContainEqual({ path: 'file2.ts', status: 'added', staged: true })
      expect(result.files).toContainEqual({ path: 'file3.ts', status: 'untracked', staged: false })
      expect(result.files).toContainEqual({ path: 'file4.ts', status: 'deleted', staged: true })
    })

    it('returns branch status with ahead/behind', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('feature-branch')
        if (args.includes('rev-list')) return Promise.resolve('2 3')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.branch).toBe('feature-branch')
      expect(result.ahead).toBe(3)
      expect(result.behind).toBe(2)
    })

    it('handles branch status command failure gracefully', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.reject(new Error('No upstream'))
        if (args.includes('rev-list')) return Promise.reject(new Error('No upstream'))
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.branch).toBe('')
      expect(result.ahead).toBe(0)
      expect(result.behind).toBe(0)
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.getStatus(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when status command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)
      executeCommand.mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getStatus(1, database)).rejects.toThrow('Failed to get status')
    })
  })
})