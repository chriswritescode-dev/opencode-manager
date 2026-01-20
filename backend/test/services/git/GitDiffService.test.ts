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

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: vi.fn(() => '/repos'),
}))

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { GitDiffService } from '../../../src/services/git/GitDiffService'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'

const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
const getRepoByIdMock = getRepoById as MockedFunction<typeof getRepoById>

describe('GitDiffService', () => {
  let service: GitDiffService
  let database: Database
  let mockGitAuthService: GitAuthService

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
    } as unknown as GitAuthService
    service = new GitDiffService(mockGitAuthService)
  })

  describe('getFileDiff', () => {
    it('returns diff for untracked file (empty status output)', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('')
        if (args.includes('--no-index')) {
          return Promise.resolve(
            'diff --git a/dev/null b/newfile.ts\n' +
            '--- /dev/null\n' +
            '+++ b/newfile.ts\n' +
            '+export const hello = "world";\n' +
            '+export const foo = "bar";'
          )
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'newfile.ts', database)

      expect(result.status).toBe('untracked')
      expect(result.additions).toBe(2)
      expect(result.deletions).toBe(0)
      expect(result.isBinary).toBe(false)
    })

    it('returns diff for modified tracked file with staged changes', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff') && args.includes('HEAD')) {
          return Promise.resolve(
            'diff --git a/file.ts b/file.ts\n' +
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '-const old = "value";\n' +
            '+const new = "value";\n' +
            '+const added = true;'
          )
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database, { includeStaged: true })

      expect(result.status).toBe('modified')
      expect(result.additions).toBe(2)
      expect(result.deletions).toBe(1)
    })

    it('returns diff for unstaged changes only', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('MM file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff') && !args.includes('HEAD')) {
          return Promise.resolve(
            'diff --git a/file.ts b/file.ts\n' +
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '-unstaged change'
          )
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database, { includeStaged: false })

      expect(result.status).toBe('modified')
      expect(result.deletions).toBe(1)
    })

    it('handles file with no porcelain output as untracked', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('')
        if (args.includes('--no-index')) return Promise.resolve('+new content')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.status).toBe('untracked')
    })

    it('handles status command failure as untracked', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.reject(new Error('Git error'))
        if (args.includes('--no-index')) return Promise.resolve('+content')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.status).toBe('untracked')
    })

    it('returns special message for new file with no commits', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('A  newfile.ts')
        if (args.includes('rev-parse')) return Promise.reject(new Error('No commits'))
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'newfile.ts', database)

      expect(result.status).toBe('added')
      expect(result.diff).toContain('New file (no commits yet)')
      expect(result.additions).toBe(0)
      expect(result.deletions).toBe(0)
      expect(result.isBinary).toBe(false)
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getFileDiff(999, 'file.ts', database)).rejects.toThrow('Repository not found: 999')
    })

    it('throws error when diff command fails', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.reject(new Error('Diff failed'))
        return Promise.resolve('')
      })

      await expect(service.getFileDiff(1, 'file.ts', database)).rejects.toThrow('Failed to get file diff: Diff failed')
    })

    it('applies showContext option', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          expect(args).toContain('-U10')
          return Promise.resolve('diff output')
        }
        return Promise.resolve('')
      })

      await service.getFileDiff(1, 'file.ts', database, { showContext: 10 })
    })

    it('applies ignoreWhitespace option', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          expect(args).toContain('--ignore-all-space')
          return Promise.resolve('diff output')
        }
        return Promise.resolve('')
      })

      await service.getFileDiff(1, 'file.ts', database, { ignoreWhitespace: true })
    })

    it('applies unified option', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          expect(args).toContain('--unified=true')
          return Promise.resolve('diff output')
        }
        return Promise.resolve('')
      })

      await service.getFileDiff(1, 'file.ts', database, { unified: true })
    })

    it('detects binary files from "Binary files" message', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  image.png')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('Binary files a/image.png and b/image.png differ')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'image.png', database)

      expect(result.isBinary).toBe(true)
      expect(result.additions).toBe(0)
      expect(result.deletions).toBe(0)
    })

    it('detects binary files from "GIT binary patch" message', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  data.bin')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('GIT binary patch\nliteral 1234\n...')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'data.bin', database)

      expect(result.isBinary).toBe(true)
    })

    it('handles untracked file with object result from executeCommand', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('')
        if (args.includes('--no-index')) {
          return Promise.resolve({ stdout: '+new line\n+another line' } as any)
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'newfile.ts', database)

      expect(result.status).toBe('untracked')
      expect(result.additions).toBe(2)
    })

    it('defaults includeStaged to true', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      let diffArgsUsed: string[] = []
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          diffArgsUsed = args as string[]
          return Promise.resolve('diff output')
        }
        return Promise.resolve('')
      })

      await service.getFileDiff(1, 'file.ts', database)

      expect(diffArgsUsed).toContain('HEAD')
    })
  })

  describe('getFullDiff', () => {
    it('delegates to getFileDiff', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('+added line')
        return Promise.resolve('')
      })

      const result = await service.getFullDiff(1, 'file.ts', database)

      expect(result.status).toBe('modified')
      expect(result.additions).toBe(1)
    })

    it('passes options through to getFileDiff', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          expect(args).toContain('--ignore-all-space')
          return Promise.resolve('diff output')
        }
        return Promise.resolve('')
      })

      await service.getFullDiff(1, 'file.ts', database, { ignoreWhitespace: true })
    })
  })

  describe('parseDiffOutput (through public methods)', () => {
    it('correctly counts additions and deletions', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          return Promise.resolve(
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '-removed line 1\n' +
            '-removed line 2\n' +
            '+added line 1\n' +
            '+added line 2\n' +
            '+added line 3\n' +
            ' unchanged line'
          )
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(2)
    })

    it('does not count --- and +++ header lines', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
          return Promise.resolve(
            '--- a/file.ts\n' +
            '+++ b/file.ts\n' +
            '+only real addition'
          )
        }
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.additions).toBe(1)
      expect(result.deletions).toBe(0)
    })

    it('returns empty path when filePath is not provided', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('?? ')
        if (args.includes('--no-index')) return Promise.resolve('+content')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, '', database)

      expect(result.path).toBe('')
    })
  })

  describe('hasCommits (through getFileDiff)', () => {
    it('returns true when HEAD exists', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('diff output')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.diff).toBe('diff output')
    })

    it('returns false when no commits exist', async () => {
      const mockRepo = { id: 1, localPath: 'test-repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('A  file.ts')
        if (args.includes('rev-parse')) return Promise.reject(new Error('No commits'))
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'file.ts', database)

      expect(result.diff).toContain('New file (no commits yet)')
    })
  })
})
