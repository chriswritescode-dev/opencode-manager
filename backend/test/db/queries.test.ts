import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as db from '../../src/db/queries'
import * as schema from '../../src/db/schema'

const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn()
} as any

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb)
}))

describe('Database Queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createRepo', () => {
    it('should insert new repo record', () => {
      const repo = {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        isWorktree: false
      }

      const existingCheckStmt = {
        get: vi.fn().mockReturnValue(undefined)
      }

      const insertStmt = {
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 })
      }
      
      const selectStmt = {
        get: vi.fn().mockReturnValue({
          id: 1,
          repo_url: repo.repoUrl,
          local_path: repo.localPath,
          branch: repo.branch,
          default_branch: repo.defaultBranch,
          clone_status: repo.cloneStatus,
          cloned_at: repo.clonedAt,
          is_worktree: 0
        })
      }
      
      mockDb.prepare
        .mockReturnValueOnce(existingCheckStmt)
        .mockReturnValueOnce(insertStmt)
        .mockReturnValueOnce(selectStmt)

      const result = db.createRepo(mockDb, repo)

      expect(mockDb.prepare).toHaveBeenCalled()
      expect(insertStmt.run).toHaveBeenCalledWith(
        repo.repoUrl,
        repo.localPath,
        repo.branch || null,
        repo.defaultBranch,
        repo.cloneStatus,
        repo.clonedAt,
        repo.isWorktree ? 1 : 0,
        0
      )
      expect(result.id).toBe(1)
    })
  })

  describe('getRepoById', () => {
    it('should retrieve repo by ID', () => {
      const clonedAt = Date.now()
      const repoRow = {
        id: 1,
        repo_url: 'https://github.com/test/repo',
        local_path: 'repos/test-repo',
        branch: 'main',
        default_branch: 'main',
        clone_status: 'ready',
        cloned_at: clonedAt,
        last_pulled: null,
        opencode_config_name: null,
        is_worktree: 0,
        is_local: 0
      }

      const stmt = {
        get: vi.fn().mockReturnValue(repoRow)
      }
      mockDb.prepare.mockReturnValue(stmt)

      const result = db.getRepoById(mockDb, 1)

      expect(result).toEqual({
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: expect.stringContaining('repos/test-repo'),
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: clonedAt,
        lastPulled: null,
        openCodeConfigName: null,
        isWorktree: undefined,
        isLocal: undefined
      })
    })

    it('should return null for non-existent repo', () => {
      const stmt = {
        get: vi.fn().mockReturnValue(undefined)
      }
      mockDb.prepare.mockReturnValue(stmt)

      const result = db.getRepoById(mockDb, 999)

      expect(result).toBeNull()
    })
  })

  describe('listRepos', () => {
    it('should return all repos', () => {
      const repoRows = [
        {
          id: 1,
          repo_url: 'https://github.com/test/repo1',
          local_path: 'repos/test-repo1',
          branch: 'main',
          default_branch: 'main',
          clone_status: 'ready',
          cloned_at: Date.now(),
          is_worktree: 0
        },
        {
          id: 2,
          repo_url: 'https://github.com/test/repo2',
          local_path: 'repos/test-repo2',
          branch: 'main',
          default_branch: 'main',
          clone_status: 'ready',
          cloned_at: Date.now(),
          is_worktree: 0
        }
      ]

      const stmt = {
        all: vi.fn().mockReturnValue(repoRows)
      }
      mockDb.prepare.mockReturnValue(stmt)

      const result = db.listRepos(mockDb)

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM repos ORDER BY cloned_at DESC')
      )
      expect(stmt.all).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0]?.repoUrl).toBe('https://github.com/test/repo1')
    })
  })

  describe('updateRepoStatus', () => {
    it('should update repo clone status', () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 1 })
      }
      mockDb.prepare.mockReturnValue(stmt)

      db.updateRepoStatus(mockDb, 1, 'ready')

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'UPDATE repos SET clone_status = ? WHERE id = ?'
      )
      expect(stmt.run).toHaveBeenCalledWith('ready', 1)
    })
  })

  describe('updateRepoConfigName', () => {
    it('should update repo OpenCode config name', () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 1 })
      }
      mockDb.prepare.mockReturnValue(stmt)

      db.updateRepoConfigName(mockDb, 1, 'my-config')

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'UPDATE repos SET opencode_config_name = ? WHERE id = ?'
      )
      expect(stmt.run).toHaveBeenCalledWith('my-config', 1)
    })
  })

  describe('updateLastPulled', () => {
    it('should update repo last pulled timestamp', () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 1 })
      }
      mockDb.prepare.mockReturnValue(stmt)

      db.updateLastPulled(mockDb, 1)

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'UPDATE repos SET last_pulled = ? WHERE id = ?'
      )
      expect(stmt.run).toHaveBeenCalledWith(expect.any(Number), 1)
    })
  })

  describe('deleteRepo', () => {
    it('should delete repo by ID', () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 1 })
      }
      mockDb.prepare.mockReturnValue(stmt)

      db.deleteRepo(mockDb, 1)

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'DELETE FROM repos WHERE id = ?'
      )
      expect(stmt.run).toHaveBeenCalledWith(1)
    })
  })

  describe('Database Schema', () => {
    it('should have schema module available', () => {
      expect(schema.initializeDatabase).toBeDefined()
      expect(typeof schema.initializeDatabase).toBe('function')
    })
  })

  describe('Transaction Support', () => {
    it('should support transaction existence', () => {
      expect(typeof mockDb.transaction).toBe('function')
    })
  })
})
