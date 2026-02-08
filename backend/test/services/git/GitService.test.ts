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
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
      getRepoByIdMock.mockReturnValue(mockRepo)
      executeCommandMock.mockResolvedValue('')

      const result = await service.fetch(1, database)

      expect(result).toBe('')
    })
  })

  describe('pull', () => {
    it('pulls from remote', async () => {
      const mockRepo = { id: 1, fullPath: '/path/to/repo' }
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
})
