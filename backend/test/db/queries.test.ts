import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import {
  createRepo,
  deleteRepo,
  ensureAssistantRepo,
  getRepoById,
  listRepos,
  setRepoSetting,
  updateLastAccessed,
  updateLastPulled,
  updateRepoStatus,
} from '../../src/db/queries'
import { createMultiRunWithEntries, insertMultiRunFusion } from '../../src/db/multi-runs'
import { createScheduleRun } from '../../src/db/schedules'
import { SecretsService } from '../../src/services/secrets'
import { selectRow } from '../../src/db/rows'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'

const RowCountSchema = z.object({ count: z.number() })

function countRows(database: Database, sql: string, ...params: Array<string | number>): number {
  return selectRow(database, RowCountSchema, sql, ...params)?.count ?? 0
}

describe('Database Queries', () => {
  let database: Database

  beforeEach(() => {
    database = createTestDatabase()
  })

  afterEach(() => {
    database.close()
  })

  describe('createRepo', () => {
    it('should insert new repo record', () => {
      const clonedAt = Date.now()
      const repo = createRepo(database, {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt,
        isWorktree: false,
        isLocal: true,
      })

      expect(repo.id).toBeGreaterThan(0)
      expect(repo.repoUrl).toBe('https://github.com/test/repo')
      expect(repo.localPath).toBe('repos/test-repo')
      expect(repo.fullPath).toBe('/Users/test/repos/test-repo')
      expect(repo.sourcePath).toBe('/Users/test/repos/test-repo')
      expect(repo.branch).toBe('main')
      expect(repo.defaultBranch).toBe('main')
      expect(repo.cloneStatus).toBe('ready')
      expect(repo.clonedAt).toBe(clonedAt)
      expect(repo.lastAccessedAt).toBe(clonedAt)
      expect(repo.lastPulled).toBeUndefined()
      expect(repo.isWorktree).toBeUndefined()
      expect(repo.isLocal).toBe(true)
      expect(getRepoById(database, repo.id)).toEqual(repo)
    })

    it('returns the existing repo when the same local path is added twice', () => {
      const first = createRepo(database, {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: Date.now(),
        isLocal: true,
      })
      const second = createRepo(database, {
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        defaultBranch: 'main',
        cloneStatus: 'cloning',
        clonedAt: Date.now(),
        isLocal: true,
      })

      expect(second.id).toBe(first.id)
      expect(listRepos(database).filter((repo) => repo.id === first.id)).toHaveLength(1)
    })
  })

  describe('getRepoById', () => {
    it('should return null for non-existent repo', () => {
      expect(getRepoById(database, 999)).toBeNull()
    })
  })

  describe('listRepos', () => {
    it('should return all repos newest cloned first', () => {
      const older = seedRepo(database, { repoUrl: 'https://github.com/test/repo1', clonedAt: 1_000 })
      const newer = seedRepo(database, { repoUrl: 'https://github.com/test/repo2', clonedAt: 2_000 })

      const repos = listRepos(database)
      const ids = repos.map((repo) => repo.id)

      expect(ids).toContain(newer.id)
      expect(ids).toContain(older.id)
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
    })
  })

  describe('updateRepoStatus', () => {
    it('should update repo clone status', () => {
      const repo = seedRepo(database, { cloneStatus: 'cloning' })

      updateRepoStatus(database, repo.id, 'ready')

      expect(getRepoById(database, repo.id)?.cloneStatus).toBe('ready')
    })

    it('should throw error when repo not found', () => {
      expect(() => updateRepoStatus(database, 999, 'ready')).toThrow('Repository with id 999 not found')
    })
  })

  describe('updateLastPulled', () => {
    it('should update repo last pulled timestamp', () => {
      const repo = seedRepo(database)
      const before = Date.now()

      updateLastPulled(database, repo.id)

      const lastPulled = getRepoById(database, repo.id)?.lastPulled
      expect(lastPulled).toBeGreaterThanOrEqual(before)
    })
  })

  describe('updateLastAccessed', () => {
    it('should update repo last accessed timestamp', () => {
      const repo = seedRepo(database)
      const before = Date.now()

      updateLastAccessed(database, repo.id)

      const lastAccessedAt = getRepoById(database, repo.id)?.lastAccessedAt
      expect(lastAccessedAt).toBeGreaterThanOrEqual(before)
    })

    it('should throw error when repo not found', () => {
      expect(() => updateLastAccessed(database, 999)).toThrow('Repository with id 999 not found')
    })
  })

  describe('deleteRepo', () => {
    it('should delete repo-scoped rows, including multi-runs, in one transaction', () => {
      const repo = seedRepo(database, { repoUrl: 'https://github.com/test/delete-me' })
      const otherRepo = seedRepo(database, { repoUrl: 'https://github.com/test/keep-me' })

      const job = seedScheduleJob(database, repo.id)
      const otherJob = seedScheduleJob(database, otherRepo.id)
      createScheduleRun(database, {
        jobId: job.id,
        repoId: repo.id,
        triggerSource: 'manual',
        status: 'running',
        startedAt: 1,
        createdAt: 1,
      })
      createScheduleRun(database, {
        jobId: otherJob.id,
        repoId: otherRepo.id,
        triggerSource: 'manual',
        status: 'running',
        startedAt: 1,
        createdAt: 1,
      })
      setRepoSetting(database, repo.id, 'key', 'value')
      setRepoSetting(database, otherRepo.id, 'key', 'value')

      const multiRun = createMultiRunWithEntries(
        database,
        { repoId: repo.id, serverId: 'local', directory: null, name: 'Sweep', prompt: 'go', isolated: false, baseRef: null },
        ['openai/a', 'openai/b'],
      )
      insertMultiRunFusion(database, {
        multiRunId: multiRun.id,
        requestId: 'req-1',
        model: 'openai/gpt-5',
        instructions: null,
        isolated: false,
        baseRef: null,
        sources: [
          { entryId: 1, sessionId: 'ses_a', model: 'openai/a', truncated: false },
          { entryId: 2, sessionId: 'ses_b', model: 'openai/b', truncated: false },
        ],
      })

      const secrets = new SecretsService(database)
      secrets.set('variable', repo.id, null, 'REPO_SECRET', 'value')
      secrets.set('variable', otherRepo.id, null, 'OTHER_SECRET', 'value')

      deleteRepo(database, repo.id)

      expect(getRepoById(database, repo.id)).toBeNull()
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM schedule_jobs WHERE repo_id = ?', repo.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM schedule_runs WHERE repo_id = ?', repo.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM repo_settings WHERE repo_id = ?', repo.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM multi_runs WHERE repo_id = ?', repo.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM multi_run_entries WHERE multi_run_id = ?', multiRun.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM multi_run_fusions WHERE multi_run_id = ?', multiRun.id)).toBe(0)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM secrets WHERE repo_id = ?', repo.id)).toBe(0)

      expect(countRows(database, 'SELECT COUNT(*) AS count FROM schedule_jobs WHERE repo_id = ?', otherRepo.id)).toBe(1)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM schedule_runs WHERE repo_id = ?', otherRepo.id)).toBe(1)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM repo_settings WHERE repo_id = ?', otherRepo.id)).toBe(1)
      expect(countRows(database, 'SELECT COUNT(*) AS count FROM secrets WHERE repo_id = ?', otherRepo.id)).toBe(1)
      expect(listRepos(database).map((entry) => entry.id)).toContain(otherRepo.id)
      expect(listRepos(database).map((entry) => entry.id)).toContain(otherRepo.id)
    })

    it('should not delete the assistant repo', () => {
      ensureAssistantRepo(database)

      deleteRepo(database, ASSISTANT_REPO_ID)

      expect(getRepoById(database, ASSISTANT_REPO_ID)).not.toBeNull()
    })
  })
})
