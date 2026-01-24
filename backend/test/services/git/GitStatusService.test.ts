import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../../../src/services/git-auth'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

vi.mock('../../../src/services/settings', () => ({
  SettingsService: vi.fn()
}))

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('../../../src/utils/git-auth', () => ({
  createSilentGitEnv: vi.fn(),
}))

import { GitStatusService } from '../../../src/services/git/GitStatusService'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'

const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
const getRepoByIdMock = getRepoById as MockedFunction<typeof getRepoById>

describe('GitStatusService', () => {
  let service: GitStatusService
  let database: Database
  let mockGitAuthService: GitAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
    service = new GitStatusService(mockGitAuthService)
  })

  describe('getStatus', () => {
    it('returns empty status for clean repository', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('MM file.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
      expect(result.hasChanges).toBe(true)
    })

    it('parses staged files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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

    it('parses renamed files correctly with arrow notation', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('R  old.ts -> new.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'new.ts', oldPath: 'old.ts', status: 'renamed', staged: true })
    })

    it('parses untracked files correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('MM file1.ts\nA  file2.ts\n?? file3.ts\nD  file4.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(4)
      expect(result.files).toContainEqual({ path: 'file1.ts', status: 'modified', staged: true })
      expect(result.files).toContainEqual({ path: 'file2.ts', status: 'added', staged: true })
      expect(result.files).toContainEqual({ path: 'file3.ts', status: 'untracked', staged: false })
      expect(result.files).toContainEqual({ path: 'file4.ts', status: 'deleted', staged: true })
    })

    it('returns branch status with ahead/behind', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('feature-branch')
        if (args.includes('rev-list')) return Promise.resolve('2 3')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.branch).toBe('feature-branch')
      expect(result.ahead).toBe(2)
      expect(result.behind).toBe(3)
    })

    it('handles branch status command failure gracefully', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
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
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getStatus(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when status command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error('Not a git repository'))

      await expect(service.getStatus(1, database)).rejects.toThrow('Not a git repository')
    })

    it('parses copied files correctly with arrow notation', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('C  source.ts -> copy.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'copy.ts', oldPath: 'source.ts', status: 'copied', staged: true })
    })

    it('preserves spaces in filenames without trimming', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        if (args.includes('status')) return Promise.resolve('M  path with spaces/file name.ts')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.files).toHaveLength(1)
      expect(result.files[0]).toEqual({ path: 'path with spaces/file name.ts', status: 'modified', staged: true })
    })

    it('handles tab-separated ahead/behind output', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('5\t0')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.ahead).toBe(5)
      expect(result.behind).toBe(0)
    })

    it('handles only behind count correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('rev-list')) return Promise.resolve('0 7')
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getStatus(1, database)

      expect(result.ahead).toBe(0)
      expect(result.behind).toBe(7)
    })
  })
})
