import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { GitAuthService } from '../../../src/services/git-auth'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn()
}))

vi.mock('../../../src/services/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockReturnValue({
      preferences: {
        gitIdentity: null,
        gitCredentials: [],
      },
    }),
  })),
}))

vi.mock('../../../src/utils/process', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../src/db/queries', () => ({
  getRepoById: vi.fn(),
}))

vi.mock('../../../src/utils/git-auth', () => ({
  resolveGitIdentity: vi.fn().mockResolvedValue(null),
  createGitIdentityEnv: vi.fn().mockReturnValue({}),
  createSilentGitEnv: vi.fn(),
  filterGitCredentials: vi.fn().mockReturnValue([]),
}))

vi.mock('../../../src/utils/git-errors', () => ({
  isNoUpstreamError: vi.fn().mockReturnValue(false),
  parseBranchNameFromError: vi.fn().mockReturnValue(null),
}))

import { GitService } from '../../../src/services/git/GitService'
import { executeCommand } from '../../../src/utils/process'
import { getRepoById } from '../../../src/db/queries'

const executeCommandMock = executeCommand as MockedFunction<typeof executeCommand>
const getRepoByIdMock = getRepoById as MockedFunction<typeof getRepoById>

describe('GitService', () => {
  let service: GitService
  let database: Database
  let mockGitAuthService: GitAuthService
  let mockSettingsService: any

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    mockGitAuthService = {
      getGitEnvironment: vi.fn().mockReturnValue({}),
      getSSHEnvironment: vi.fn().mockReturnValue({}),
      setupSSHKey: vi.fn().mockResolvedValue(undefined),
      cleanupSSHKey: vi.fn().mockResolvedValue(undefined),
      verifyHostKeyBeforeOperation: vi.fn().mockResolvedValue(true),
      setSSHPort: vi.fn(),
      setupSSHForRepoUrl: vi.fn().mockResolvedValue(false),
    } as unknown as GitAuthService
    mockSettingsService = {
      getSettings: vi.fn().mockReturnValue({
        preferences: {
          gitIdentity: null,
          gitCredentials: [],
        },
      }),
    }
    service = new GitService(mockGitAuthService, mockSettingsService)
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

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
      expect(result.files[1]).toEqual({ path: 'file.ts', status: 'modified', staged: false })
      expect(result.hasChanges).toBe(true)
    })
  })

  describe('parsePorcelainOutput', () => {
    it('handles staged modification only (M )', () => {
      const output = 'M  file.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
    })

    it('handles unstaged modification only ( M)', () => {
      const output = ' M file.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'file.ts', status: 'modified', staged: false })
    })

    it('handles both staged and unstaged modification (MM)', () => {
      const output = 'MM file.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
      expect(result[1]).toEqual({ path: 'file.ts', status: 'modified', staged: false })
    })

    it('handles staged added file (A )', () => {
      const output = 'A  newfile.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'newfile.ts', status: 'added', staged: true })
    })

    it('handles staged deleted file (D )', () => {
      const output = 'D  oldfile.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'oldfile.ts', status: 'deleted', staged: true })
    })

    it('handles staged added then modified (AM)', () => {
      const output = 'AM newfile.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: 'newfile.ts', status: 'added', staged: true })
      expect(result[1]).toEqual({ path: 'newfile.ts', status: 'modified', staged: false })
    })

    it('handles staged added then deleted (AD)', () => {
      const output = 'AD newfile.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: 'newfile.ts', status: 'added', staged: true })
      expect(result[1]).toEqual({ path: 'newfile.ts', status: 'deleted', staged: false })
    })

    it('handles renamed file (R )', () => {
      const output = 'R  old.ts -> new.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'new.ts', status: 'renamed', staged: true, oldPath: 'old.ts' })
    })

    it('handles copied file (C )', () => {
      const output = 'C  original.ts -> copy.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'copy.ts', status: 'copied', staged: true, oldPath: 'original.ts' })
    })

    it('handles untracked file (??)', () => {
      const output = '?? untracked.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: 'untracked.ts', status: 'untracked', staged: false })
    })

    it('handles empty output', () => {
      const output = ''
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(0)
    })

    it('handles multiple files with mixed statuses', () => {
      const output = 'M  modified.ts\nA  added.ts\n D unstaged.ts\nMM both.ts\n?? untracked.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(6)
      expect(result).toContainEqual({ path: 'modified.ts', status: 'modified', staged: true })
      expect(result).toContainEqual({ path: 'added.ts', status: 'added', staged: true })
      expect(result).toContainEqual({ path: 'unstaged.ts', status: 'deleted', staged: false })
      expect(result).toContainEqual({ path: 'both.ts', status: 'modified', staged: true })
      expect(result).toContainEqual({ path: 'both.ts', status: 'modified', staged: false })
      expect(result).toContainEqual({ path: 'untracked.ts', status: 'untracked', staged: false })
    })

    it('ignores short lines', () => {
      const output = 'M  file.ts\n\n A\n?? valid.ts'
      const result = (service as any).parsePorcelainOutput(output)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: 'file.ts', status: 'modified', staged: true })
      expect(result[1]).toEqual({ path: 'valid.ts', status: 'untracked', staged: false })
    })
  })

  describe('getFileStatus', () => {
    it('returns clean status for file with no changes (empty output)', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await (service as any).getFileStatus('/path/to/repo', 'clean.ts', {})

      expect(result).toEqual({ status: 'clean' })
    })

    it('returns modified status for staged modified file', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('M  modified.ts')

      const result = await (service as any).getFileStatus('/path/to/repo', 'modified.ts', {})

      expect(result).toEqual({ status: 'modified' })
    })

    it('returns status for unstaged modified file', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue(' M modified.ts')

      const result = await (service as any).getFileStatus('/path/to/repo', 'modified.ts', {})

      expect(result).toEqual({ status: 'modified' })
    })

    it('returns untracked status for untracked file', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('?? untracked.ts')

      const result = await (service as any).getFileStatus('/path/to/repo', 'untracked.ts', {})

      expect(result).toEqual({ status: 'untracked' })
    })

    it('returns added status for staged added file', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('A  new.ts')

      const result = await (service as any).getFileStatus('/path/to/repo', 'new.ts', {})

      expect(result).toEqual({ status: 'added' })
    })

    it('returns deleted status for staged deleted file', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('D  deleted.ts')

      const result = await (service as any).getFileStatus('/path/to/repo', 'deleted.ts', {})

      expect(result).toEqual({ status: 'deleted' })
    })

    it('returns clean status on error', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockRejectedValue(new Error('git command failed'))

      const result = await (service as any).getFileStatus('/path/to/repo', 'error.ts', {})

      expect(result).toEqual({ status: 'clean' })
    })
  })

  describe('getFileDiff for clean files', () => {
    it('returns empty diff for clean file (no changes)', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('')
        return Promise.resolve('')
      })

      const result = await service.getFileDiff(1, 'clean.ts', database)

      expect(result.status).toBe('modified')
      expect(result.diff).toBe('')
      expect(result.additions).toBe(0)
      expect(result.deletions).toBe(0)
      expect(result.isBinary).toBe(false)
    })
  })

  describe('getFileDiff', () => {
    it('returns diff for untracked file', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('?? newfile.ts')
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

    it('returns diff for modified tracked file', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) {
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
  })

  describe('getFullDiff', () => {
    it('delegates to getFileDiff', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve('+added line')
        return Promise.resolve('')
      })

      const result = await service.getFullDiff(1, 'file.ts', database, true)

      expect(result.status).toBe('modified')
      expect(result.additions).toBe(1)
    })
  })

  describe('getLog', () => {
    it('returns list of commits', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock
        .mockResolvedValueOnce(
          'abc123|John Doe|john@example.com|1704110400|First commit\n' +
          'def456|Jane Smith|jane@example.com|1704200400|Second commit'
        )
        .mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '1704110400',
        message: 'First commit',
        unpushed: false,
      })
      expect(result[1]).toEqual({
        hash: 'def456',
        authorName: 'Jane Smith',
        authorEmail: 'jane@example.com',
        date: '1704200400',
        message: 'Second commit',
        unpushed: false,
      })
    })

    it('handles empty log output', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValueOnce('').mockResolvedValueOnce('')

      const result = await service.getLog(1, database, 10)

      expect(result).toEqual([])
    })
  })

  describe('getCommit', () => {
    it('returns commit details for valid hash', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('abc123|John Doe|john@example.com|1704110400|Test commit')

      const result = await service.getCommit(1, 'abc123', database)

      expect(result).toEqual({
        hash: 'abc123',
        authorName: 'John Doe',
        authorEmail: 'john@example.com',
        date: '1704110400',
        message: 'Test commit',
      })
    })

    it('returns null when commit hash not found', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await service.getCommit(1, 'nonexistent', database)

      expect(result).toBeNull()
    })
  })

  describe('getDiff', () => {
    it('returns diff for file', async () => {
      const expectedDiff = 'diff --git a/file.ts b/file.ts\nindex 123..456 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line'
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) return Promise.resolve('M  file.ts')
        if (args.includes('rev-parse')) return Promise.resolve('abc123')
        if (args.includes('diff')) return Promise.resolve(expectedDiff)
        return Promise.resolve('')
      })

      const result = await service.getDiff(1, 'file.ts', database)

      expect(result).toBe(expectedDiff)
    })
  })

  describe('commit', () => {
    it('commits staged changes with message', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('[main abc1234] Test commit\n 1 file changed')

      const result = await service.commit(1, 'Test commit', database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'commit', '-m', 'Test commit'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('[main abc1234] Test commit\n 1 file changed')
    })

    it('commits specific staged files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('[main abc1234] Commit specific files\n 2 files changed')

      const result = await service.commit(1, 'Commit specific files', database, ['file1.ts', 'file2.ts'])

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'commit', '-m', 'Commit specific files', '--', 'file1.ts', 'file2.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('[main abc1234] Commit specific files\n 2 files changed')
    })
  })

  describe('stageFiles', () => {
    it('stages files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await service.stageFiles(1, ['file1.ts', 'file2.ts'], database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'add', '--', 'file1.ts', 'file2.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('')
    })

    it('returns early when no files to stage', async () => {
      const result = await service.stageFiles(1, [], database)

      expect(executeCommandMock).not.toHaveBeenCalled()
      expect(result).toBe('')
    })
  })

  describe('unstageFiles', () => {
    it('unstages files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await service.unstageFiles(1, ['file1.ts', 'file2.ts'], database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'restore', '--staged', '--', 'file1.ts', 'file2.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('')
    })
  })

  describe('resetToCommit', () => {
    it('resets to specific commit', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('HEAD is now at abc123')

      const result = await service.resetToCommit(1, 'abc123', database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'reset', '--hard', 'abc123'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('HEAD is now at abc123')
    })
  })

  describe('push', () => {
    it('pushes changes to remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
        localPath: '/path/to/repo',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: 123456,
      }
      getRepoByIdMock.mockReturnValue(mockRepo)
      executeCommandMock.mockResolvedValue('Everything up-to-date')

      const result = await service.push(1, {}, database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(executeCommand).toHaveBeenCalledWith(
        ['git', '-C', '/path/to/repo', 'push'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('Everything up-to-date')
    })

    it('respects setUpstream option', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
        localPath: '/path/to/repo',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: 123456,
      }
      getRepoByIdMock.mockReturnValue(mockRepo)
      executeCommandMock.mockResolvedValueOnce('main\n').mockResolvedValueOnce('')

      await service.push(1, { setUpstream: true }, database)

      expect(executeCommand).toHaveBeenNthCalledWith(
        2,
        ['git', '-C', '/path/to/repo', 'push', '--set-upstream', 'origin', 'main'],
        expect.any(Object)
      )
    })
  })

  describe('fetch', () => {
    it('fetches from remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
        localPath: '/path/to/repo',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: 123456,
      }
      getRepoByIdMock.mockReturnValue(mockRepo)
      executeCommandMock.mockResolvedValue('')

      const result = await service.fetch(1, database)

      expect(result).toBe('')
    })
  })

  describe('pull', () => {
    it('pulls from remote', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
        localPath: '/path/to/repo',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: 123456,
      }
      getRepoByIdMock.mockReturnValue(mockRepo)
      executeCommandMock.mockResolvedValue('')

      const result = await service.pull(1, database)

      expect(result).toBe('')
    })
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
  })

  describe('discardChanges', () => {
    it('discards staged changes using restore --staged --worktree', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('Changes discarded')

      const result = await service.discardChanges(1, ['file.ts', 'dir/file2.ts'], true, database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'restore', '--staged', '--worktree', '--source', 'HEAD', '--', 'file.ts', 'dir/file2.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('Changes discarded')
    })

    it('discards unstaged tracked changes using checkout', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) {
          return Promise.resolve('M  file.ts\n')
        }
        if (args.includes('checkout')) {
          return Promise.resolve('Updated 1 path')
        }
        return Promise.resolve('')
      })

      const result = await service.discardChanges(1, ['file.ts'], false, database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'status', '--porcelain', '-u', '--', 'file.ts'],
        { env: expect.any(Object) }
      )
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'checkout', '--', 'file.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toBe('Updated 1 path')
    })

    it('removes unstaged untracked files using git clean', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) {
          return Promise.resolve('?? untracked.ts\n')
        }
        if (args.includes('clean')) {
          return Promise.resolve('Removed untracked.ts')
        }
        return Promise.resolve('')
      })

      const result = await service.discardChanges(1, ['untracked.ts'], false, database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'clean', '-fd', '--', 'untracked.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toContain('Removed untracked.ts')
    })

    it('handles mixed tracked and untracked files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) {
          return Promise.resolve('M  modified.ts\n?? untracked.ts\n')
        }
        if (args.includes('checkout')) {
          return Promise.resolve('Updated 1 path')
        }
        if (args.includes('clean')) {
          return Promise.resolve('Removed untracked.ts')
        }
        return Promise.resolve('')
      })

      const result = await service.discardChanges(1, ['modified.ts', 'untracked.ts'], false, database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'checkout', '--', 'modified.ts'],
        { env: expect.any(Object) }
      )
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'clean', '-fd', '--', 'untracked.ts'],
        { env: expect.any(Object) }
      )
      expect(result).toContain('Updated 1 path')
      expect(result).toContain('Removed untracked.ts')
    })

    it('returns early when no paths provided', async () => {
      const result = await service.discardChanges(1, [], false, database)

      expect(executeCommandMock).not.toHaveBeenCalled()
      expect(result).toBe('')
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.discardChanges(1, ['file.ts'], false, database)).rejects.toThrow('Repository not found')
    })

    it('logs and throws error on git command failure', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      const error = new Error('Permission denied')
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) {
          return Promise.resolve('M  file.ts\n')
        }
        if (args.includes('checkout')) {
          return Promise.reject(error)
        }
        return Promise.resolve('')
      })

      await expect(service.discardChanges(1, ['file.ts'], false, database)).rejects.toThrow()
    })

    it('handles directories in untracked clean operation', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('status')) {
          return Promise.resolve('?? dir/\n')
        }
        if (args.includes('clean')) {
          return Promise.resolve('Removing dir/')
        }
        return Promise.resolve('')
      })

      const result = await service.discardChanges(1, ['dir/'], false, database)

      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', mockRepo.fullPath, 'clean', '-fd', '--', 'dir/'],
        { env: expect.any(Object) }
      )
      expect(result).toContain('Removing dir/')
    })
  })

  describe('getCommitDetails', () => {
    it('returns full commit details with files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Initial commit')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('A\tfile1.ts\nM\tfile2.ts\nD\tfile3.ts\n')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('10\t5\tfile1.ts\n20\t15\tfile2.ts\n0\t30\tfile3.ts\n')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result).not.toBeNull()
      expect(result?.hash).toBe('abc123')
      expect(result?.authorName).toBe('John Doe')
      expect(result?.authorEmail).toBe('john@example.com')
      expect(result?.date).toBe('1609459200')
      expect(result?.message).toBe('Initial commit')
      expect(result?.files).toHaveLength(3)
      expect(result?.files[0]).toEqual({
        path: 'file1.ts',
        status: 'added',
        additions: 10,
        deletions: 5
      })
      expect(result?.files[1]).toEqual({
        path: 'file2.ts',
        status: 'modified',
        additions: 20,
        deletions: 15
      })
      expect(result?.files[2]).toEqual({
        path: 'file3.ts',
        status: 'deleted',
        oldPath: undefined,
        additions: 0,
        deletions: 30
      })
    })

    it('handles renamed files in commit details', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Rename file')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('R\told.ts\tnew.ts\n')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('0\t0\tnew.ts\n')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result?.files).toHaveLength(1)
      expect(result?.files[0]).toEqual({
        path: 'new.ts',
        status: 'renamed',
        oldPath: 'old.ts',
        additions: 0,
        deletions: 0
      })
    })

    it('handles copied files in commit details', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Copy file')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('C\toriginal.ts\tcopy.ts\n')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('0\t0\tcopy.ts\n')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result?.files).toHaveLength(1)
      expect(result?.files[0]).toEqual({
        path: 'copy.ts',
        status: 'copied',
        oldPath: 'original.ts',
        additions: 0,
        deletions: 0
      })
    })

    it('returns empty files array for empty commit', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Empty commit')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result?.files).toHaveLength(0)
    })

    it('returns null when commit hash not found', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('')

      const result = await service.getCommitDetails(1, 'nonexistent', database)

      expect(result).toBeNull()
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getCommitDetails(1, 'abc123', database)).rejects.toThrow('Repository not found')
    })

    it('marks unpushed commits correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Local commit')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('M\tfile.ts\n')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('1\t1\tfile.ts\n')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('abc123\n')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result?.unpushed).toBe(true)
    })

    it('handles commit message with pipes correctly', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockImplementation((args) => {
        if (args.includes('log') && !args.includes('--not')) {
          return Promise.resolve('abc123\x00John Doe\x00john@example.com\x001609459200\x00Fix: merge|conflict|handling')
        }
        if (args.includes('show') && args.includes('--name-status')) {
          return Promise.resolve('')
        }
        if (args.includes('show') && args.includes('--numstat')) {
          return Promise.resolve('')
        }
        if (args.includes('--not') && args.includes('--remotes')) {
          return Promise.resolve('')
        }
        return Promise.resolve('')
      })

      const result = await service.getCommitDetails(1, 'abc123', database)

      expect(result?.message).toBe('Fix: merge|conflict|handling')
    })

    it('throws error on git command failure', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      const error = new Error('Git error')
      executeCommandMock.mockRejectedValue(error)

      await expect(service.getCommitDetails(1, 'abc123', database)).rejects.toThrow('Failed to get commit details')
    })
  })

  describe('getCommitDiff', () => {
    it('returns diff for specific file in commit', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      const diffOutput = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+new line
 existing line 1
 existing line 2
 existing line 3`
      executeCommandMock.mockResolvedValue(diffOutput)

      const result = await service.getCommitDiff(1, 'abc123', 'file.ts', database)

      expect(getRepoByIdMock).toHaveBeenCalledWith(database, 1)
      expect(executeCommandMock).toHaveBeenCalledWith(
        ['git', '-C', expect.stringContaining('/path/to/repo'), 'show', '--format=', 'abc123', '--', 'file.ts'],
        { env: expect.any(Object) }
      )
      expect(result.path).toBe('file.ts')
      expect(result.status).toBe('modified')
      expect(result.diff).toContain('new line')
      expect(result.additions).toBe(1)
      expect(result.deletions).toBe(0)
      expect(result.isBinary).toBe(false)
    })

    it('detects binary files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      executeCommandMock.mockResolvedValue('Binary files a/image.png and b/image.png differ')

      const result = await service.getCommitDiff(1, 'abc123', 'image.png', database)

      expect(result.isBinary).toBe(true)
      expect(result.diff).toContain('Binary files')
    })

    it('throws error when repository not found', async () => {
      getRepoByIdMock.mockReturnValue(null)

      await expect(service.getCommitDiff(1, 'abc123', 'file.ts', database)).rejects.toThrow('Repository not found')
    })

    it('handles deleted files in commit', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      const diffOutput = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index abc123..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line 1
-line 2
-line 3`
      executeCommandMock.mockResolvedValue(diffOutput)

      const result = await service.getCommitDiff(1, 'abc123', 'deleted.ts', database)

      expect(result.deletions).toBe(3)
      expect(result.additions).toBe(0)
    })

    it('throws error on git command failure', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoByIdMock.mockReturnValue(mockRepo as any)
      const error = new Error('Fatal error')
      executeCommandMock.mockRejectedValue(error)

      await expect(service.getCommitDiff(1, 'abc123', 'file.ts', database)).rejects.toThrow('Failed to get commit diff')
    })
  })

  describe('parseDiffOutput', () => {
    it('parses small diff and counts additions/deletions', () => {
      const diffOutput = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+added line
 existing line 1
 existing line 2
-removed line
 existing line 3`

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result).toEqual({
        path: 'file.ts',
        status: 'modified',
        diff: diffOutput,
        additions: 1,
        deletions: 1,
        isBinary: false,
        truncated: false
      })
    })

    it('detects binary files correctly', () => {
      const diffOutput = 'GIT binary patch\nliteral 1234\nzcmeAS@N?(olHy`uVBq!ia0vp0{ow;2j9U=!1jd#uLplI'

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'binary.bin')

      expect(result.isBinary).toBe(true)
    })

    it('detects "Binary files" indicator', () => {
      const diffOutput = 'Binary files a/image.png and b/image.png differ'

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'image.png')

      expect(result.isBinary).toBe(true)
    })

    it('truncates diff when exceeding MAX_DIFF_SIZE (500KB)', () => {
      const largeContent = '+' + 'x'.repeat(500 * 1024 + 1000)
      const diffOutput = `diff --git a/large.ts b/large.ts\n${largeContent}`

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'large.ts')

      expect(result.truncated).toBe(true)
      expect(result.diff.length).toBe(500 * 1024 + '\n\n... (diff truncated due to size)'.length)
      expect(result.diff).toContain('... (diff truncated due to size)')
    })

    it('does not truncate diff under MAX_DIFF_SIZE', () => {
      const diffOutput = '+' + 'x'.repeat(100 * 1024)

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result.truncated).toBe(false)
      expect(result.diff.length).toBeLessThan(500 * 1024)
    })

    it('handles empty diff', () => {
      const diffOutput = ''

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result).toEqual({
        path: 'file.ts',
        status: 'modified',
        diff: '',
        additions: 0,
        deletions: 0,
        isBinary: false,
        truncated: false
      })
    })

    it('correctly counts multiple additions and deletions', () => {
      const diffOutput = `diff --git a/file.ts b/file.ts
@@ -1,5 +1,7 @@
+added 1
 context
+added 2
-removed 1
 context
+added 3
-removed 2
-removed 3`

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(3)
    })

    it('ignores diff headers (+++/---) when counting', () => {
      const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
+added`

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result.additions).toBe(1)
      expect(result.deletions).toBe(0)
    })

    it('handles different status types in parseDiffOutput', () => {
      const diffOutput = '+new line'

      const resultAdded = (service as any).parseDiffOutput(diffOutput, 'added', 'new.ts')
      const resultDeleted = (service as any).parseDiffOutput(diffOutput, 'deleted', 'old.ts')
      const resultRenamed = (service as any).parseDiffOutput(diffOutput, 'renamed', 'moved.ts')

      expect(resultAdded.status).toBe('added')
      expect(resultDeleted.status).toBe('deleted')
      expect(resultRenamed.status).toBe('renamed')
    })

    it('handles diff with large change counts at truncation', () => {
      const addedLines = '+' + 'x'.repeat(501 * 1024)
      const diffOutput = `diff --git a/file.ts b/file.ts\n${addedLines}`

      const result = (service as any).parseDiffOutput(diffOutput, 'modified', 'file.ts')

      expect(result.truncated).toBe(true)
      expect(result.diff).toContain('... (diff truncated due to size)')
    })
  })
})
