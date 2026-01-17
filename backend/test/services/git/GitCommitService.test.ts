/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitCommitService } from '../../../src/services/git/GitCommitService'
import type { Database } from 'bun:sqlite'

const executeCommand = vi.fn()
const getRepoById = vi.fn()
const getGitEnvironment = vi.fn()
const mockSpawn = vi.fn()

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

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

describe('GitCommitService', () => {
  let service: GitCommitService
  let database: Database

  beforeEach(() => {
    vi.clearAllMocks()
    database = {} as Database
    const { GitAuthService } = require('../../../src/utils/git-auth')
    const gitAuthService = new GitAuthService()
    service = new GitCommitService(gitAuthService)
    getGitEnvironment.mockReturnValue({})

    const mockProc = {
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') callback(Buffer.from(''))
        }),
      },
      stderr: {
        on: vi.fn((event, callback) => {
          if (event === 'data') callback(Buffer.from(''))
        }),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') callback(0)
      }),
    }
    mockSpawn.mockReturnValue(mockProc)
  })

  describe('commit', () => {
    it('commits staged changes with message', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const result = await service.commit(1, 'Test commit', database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', mockRepo.fullPath, 'commit', '-m', 'Test commit'], {
        shell: false,
        env: expect.any(Object),
      })
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('commits specific staged files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const result = await service.commit(1, 'Commit specific files', database, ['file1.ts', 'file2.ts'])

      expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', mockRepo.fullPath, 'commit', '-m', 'Commit specific files', '--', 'file1.ts', 'file2.ts'], {
        shell: false,
        env: expect.any(Object),
      })
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.commit(999, 'Test', database)).rejects.toThrow('Repository not found')
    })

    it('throws error when commit command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const mockProc = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from(''))
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from('Nothing to commit'))
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1)
        }),
      }
      mockSpawn.mockReturnValue(mockProc)

      await expect(service.commit(1, 'Test', database)).rejects.toThrow('Failed to commit changes')
    })
  })

  describe('stageFiles', () => {
    it('stages files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const result = await service.stageFiles(1, ['file1.ts', 'file2.ts'], database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', mockRepo.fullPath, 'add', '--', 'file1.ts', 'file2.ts'], {
        shell: false,
        env: expect.any(Object),
      })
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('returns early when no files to stage', async () => {
      const result = await service.stageFiles(1, [], database)

      expect(mockSpawn).not.toHaveBeenCalled()
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.stageFiles(999, ['file.ts'], database)).rejects.toThrow('Repository not found')
    })

    it('throws error when stage command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const mockProc = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from(''))
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from('Pathspec error'))
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1)
        }),
      }
      mockSpawn.mockReturnValue(mockProc)

      await expect(service.stageFiles(1, ['invalid.txt'], database)).rejects.toThrow('Failed to stage files')
    })
  })

  describe('unstageFiles', () => {
    it('unstages files', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const result = await service.unstageFiles(1, ['file1.ts', 'file2.ts'], database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', mockRepo.fullPath, 'restore', '--staged', '--', 'file1.ts', 'file2.ts'], {
        shell: false,
        env: expect.any(Object),
      })
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('returns early when no files to unstage', async () => {
      const result = await service.unstageFiles(1, [], database)

      expect(mockSpawn).not.toHaveBeenCalled()
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.unstageFiles(999, ['file.ts'], database)).rejects.toThrow('Repository not found')
    })

    it('throws error when unstage command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const mockProc = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from(''))
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from('Error unstaging'))
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(1)
        }),
      }
      mockSpawn.mockReturnValue(mockProc)

      await expect(service.unstageFiles(1, ['file.ts'], database)).rejects.toThrow('Failed to unstage files')
    })
  })



  describe('resetToCommit', () => {
    it('resets to specific commit', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const result = await service.resetToCommit(1, 'abc123', database)

      expect(getRepoById).toHaveBeenCalledWith(database, 1)
      expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', mockRepo.fullPath, 'reset', '--hard', 'abc123'], {
        shell: false,
        env: expect.any(Object),
      })
      expect(result).toEqual({ stdout: '', stderr: '' })
    })

    it('throws error when repository not found', async () => {
      getRepoById.mockReturnValue(null)

      await expect(service.resetToCommit(999, 'abc123', database)).rejects.toThrow('Repository not found')
    })

    it('throws error when reset command fails', async () => {
      const mockRepo = {
        id: 1,
        fullPath: '/path/to/repo',
      }
      getRepoById.mockReturnValue(mockRepo)

      const mockProc = {
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from(''))
          }),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') callback(Buffer.from('Invalid commit hash'))
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') callback(128)
        }),
      }
      mockSpawn.mockReturnValue(mockProc)

      await expect(service.resetToCommit(1, 'invalid', database)).rejects.toThrow('Failed to reset to commit')
    })
  })
})
