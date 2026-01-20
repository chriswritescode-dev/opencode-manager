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

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { GitBranchService } from '../../../src/services/git/GitBranchService'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'

const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
const getRepoByIdMock = getRepoById as MockedFunction<typeof getRepoById>

describe('GitBranchService', () => {
  let service: GitBranchService
  let database: Database
  let mockGitAuthService: GitAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
    service = new GitBranchService(mockGitAuthService)
  })

  describe('getBranches', () => {
    it('returns list of local branches', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 [origin/main] Initial commit\n  feature def456 [origin/feature] Feature work')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'main', type: 'local', current: true })
      expect(result[1]).toMatchObject({ name: 'feature', type: 'local', current: false })
    })

    it('returns remote branches with remotes/ prefix', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123\n  remotes/origin/main def456\n  remotes/origin/develop ghi789')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result.filter(b => b.type === 'remote')).toHaveLength(2)
      expect(result.find(b => b.name === 'remotes/origin/main')).toMatchObject({ type: 'remote' })
    })

    it('parses upstream tracking info with ahead/behind', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('feature')
        if (args.includes('branch')) return Promise.resolve('* feature abc123 [origin/feature: ahead 3, behind 2] Work in progress')
        if (args.includes('rev-list')) return Promise.resolve('3 2')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]).toMatchObject({
        name: 'feature',
        upstream: 'origin/feature',
        ahead: 3,
        behind: 2,
      })
    })

    it('parses upstream with only ahead count', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 [origin/main: ahead 5] Latest changes')
        if (args.includes('rev-list')) return Promise.resolve('5 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]).toMatchObject({
        upstream: 'origin/main',
        ahead: 5,
        behind: 0,
      })
    })

    it('parses upstream with only behind count', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 [origin/main: behind 3] Old version')
        if (args.includes('rev-list')) return Promise.resolve('0 3')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]).toMatchObject({
        upstream: 'origin/main',
        ahead: 0,
        behind: 3,
      })
    })

    it('sorts branches: current first, then local, then remote, alphabetically', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('feature')
        if (args.includes('branch')) {
          return Promise.resolve(
            '  main abc123\n' +
            '* feature def456\n' +
            '  remotes/origin/main ghi789\n' +
            '  another jkl012\n' +
            '  remotes/origin/develop mno345'
          )
        }
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]!.name).toBe('feature')
      expect(result[0]!.current).toBe(true)
      expect(result.slice(1, 3).every((b) => b.type === 'local')).toBe(true)
      expect(result.slice(3).every((b) => b.type === 'remote')).toBe(true)
    })

    it('deduplicates branch names', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123\n  main def456')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result.filter(b => b.name === 'main')).toHaveLength(1)
    })

    it('handles current branch rev-parse failure gracefully', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.reject(new Error('Not a git repo'))
        if (args.includes('branch')) return Promise.resolve('* main abc123\n  feature def456')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result).toHaveLength(2)
    })

    it('fetches branch status for current branch without ahead/behind', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 Initial commit')
        if (args.includes('rev-list')) return Promise.resolve('1 2')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]).toMatchObject({
        name: 'main',
        current: true,
        ahead: 1,
        behind: 2,
      })
    })

    it('handles getBranchStatus failure for current branch gracefully', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      let revListCalls = 0
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123 Initial commit')
        if (args.includes('rev-list')) {
          revListCalls++
          return Promise.reject(new Error('No upstream'))
        }
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result[0]!.name).toBe('main')
      expect(result[0]!.ahead).toBe(0)
      expect(result[0]!.behind).toBe(0)
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getBranches(999, database)).rejects.toThrow('Repository not found')
    })

    it('throws error when branch command fails', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.reject(new Error('Not a git repository'))
        return Promise.resolve('')
      })

      await expect(service.getBranches(1, database)).rejects.toThrow('Not a git repository')
    })

    it('handles empty branch output', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result).toEqual([])
    })

    it('skips lines with empty branch names', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('rev-parse')) return Promise.resolve('main')
        if (args.includes('branch')) return Promise.resolve('* main abc123\n  \n  feature def456')
        if (args.includes('rev-list')) return Promise.resolve('0 0')
        return Promise.resolve('')
      })

      const result = await service.getBranches(1, database)

      expect(result).toHaveLength(2)
    })
  })

  describe('getBranchStatus', () => {
    it('returns correct ahead/behind counts', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('3\t5')

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 3, behind: 5 })
    })

    it('returns zeros when no upstream', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error('No upstream branch'))

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 0, behind: 0 })
    })

    it('returns zeros when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      const result = await service.getBranchStatus(999, database)

      expect(result).toEqual({ ahead: 0, behind: 0 })
    })

    it('handles malformed rev-list output', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('invalid')

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 0, behind: 0 })
    })

    it('handles space-separated ahead/behind output', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('7 2')

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 7, behind: 2 })
    })

    it('handles only ahead count correctly', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('5\t0')

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 5, behind: 0 })
    })

    it('handles only behind count correctly', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('0\t3')

      const result = await service.getBranchStatus(1, database)

      expect(result).toEqual({ ahead: 0, behind: 3 })
    })
  })

  describe('createBranch', () => {
    it('creates and switches to new branch', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue("Switched to a new branch 'feature-branch'")

      const result = await service.createBranch(1, 'feature-branch', database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', expect.stringContaining('/path/to/repo'), 'checkout', '-b', 'feature-branch'],
        { env: expect.any(Object) }
      )
      expect(result).toBe("Switched to a new branch 'feature-branch'")
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.createBranch(999, 'new-branch', database)).rejects.toThrow('Repository not found')
    })

    it('throws error when branch already exists', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error("fatal: a branch named 'existing' already exists"))

      await expect(service.createBranch(1, 'existing', database)).rejects.toThrow("fatal: a branch named 'existing' already exists")
    })
  })

  describe('switchBranch', () => {
    it('switches to existing branch', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue("Switched to branch 'main'")

      const result = await service.switchBranch(1, 'main', database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', expect.stringContaining('/path/to/repo'), 'checkout', 'main'],
        { env: expect.any(Object) }
      )
      expect(result).toBe("Switched to branch 'main'")
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.switchBranch(999, 'main', database)).rejects.toThrow('Repository not found')
    })

    it('throws error when branch does not exist', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error("error: pathspec 'nonexistent' did not match any file(s)"))

      await expect(service.switchBranch(1, 'nonexistent', database)).rejects.toThrow("error: pathspec 'nonexistent' did not match any file(s)")
    })
  })

  describe('hasCommits', () => {
    it('returns true when HEAD exists', async () => {
      executeCommandMock.mockResolvedValue('abc123def456')

      const result = await service.hasCommits('/path/to/repo')

      expect(result).toBe(true)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'rev-parse', 'HEAD'],
        { silent: true }
      )
    })

    it('returns false when no commits exist', async () => {
      executeCommandMock.mockRejectedValue(new Error("fatal: ambiguous argument 'HEAD': unknown revision"))

      const result = await service.hasCommits('/path/to/fresh-repo')

      expect(result).toBe(false)
    })

    it('returns false for non-git directory', async () => {
      executeCommandMock.mockRejectedValue(new Error('fatal: not a git repository'))

      const result = await service.hasCommits('/path/to/not-a-repo')

      expect(result).toBe(false)
    })
  })
})
