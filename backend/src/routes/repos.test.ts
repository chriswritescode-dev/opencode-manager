import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { createRepoRoutes } from './repos'
import { createRepo } from '../db/queries'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { GitAuthService } from '../services/git-auth'

beforeEach(() => {
  mock.module('../services/project-id-resolver', () => ({
    resolveProjectId: (() => null) as any,
  }))
})

afterEach(() => {
  mock.restore()
})

const stubGitAuthService = {
  getGitEnvironment: () => ({}),
  getGitCredentials: async () => [],
} as unknown as GitAuthService

function createTestApp(db: Database): Hono {
  const app = new Hono()
  const scheduleService = {
    createSchedule: () => {},
    getScheduleById: () => null,
    listSchedules: () => [],
    updateSchedule: () => {},
    deleteSchedule: () => {},
  } as any
  app.route('/repos', createRepoRoutes(db, stubGitAuthService, scheduleService, createStubOpenCodeClient()))
  return app
}

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

describe('GET /api/repos/:id/siblings', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
  })

  it('returns siblings including self with currentBranch', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: ((path: string) => Promise.resolve(
        path.includes('repo-unrelated') ? 'commit-B' : 'commit-A'
      )) as any,
    }))

    createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-b', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-c', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-unrelated', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number; currentBranch: string | null | undefined }>
    expect(data).toHaveLength(3)
    expect(data.map((d) => d.id)).toEqual([1, 2, 3])
  })

  it('excludes repos with non-matching projectID', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: ((path: string) => Promise.resolve(
        path.includes('repo-only') ? 'commit-X' : 'commit-Y'
      )) as any,
    }))

    createRepo(db, { localPath: 'repo-only', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
    createRepo(db, { localPath: 'repo-other', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ id: number }>
    expect(data).toHaveLength(1)
    expect(data[0]!.id).toBe(1)
  })

  it('returns empty when target has no projectID', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => null) as any,
    }))

    createRepo(db, { localPath: 'repo-no-project', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target cloneStatus !== ready', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => 'commit-A') as any,
    }))

    createRepo(db, { localPath: 'repo-cloning', defaultBranch: 'main', cloneStatus: 'cloning', clonedAt: Date.now(), isLocal: true })

    const res = await app.request('/repos/1/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('returns empty when target missing', async () => {
    mock.module('../services/project-id-resolver', () => ({
      resolveProjectId: (() => 'commit-A') as any,
    }))

    const res = await app.request('/repos/9999/siblings')
    expect(res.status).toBe(200)
    const data = await res.json() as unknown[]
    expect(data).toEqual([])
  })

  it('invalid id returns 400', async () => {
    const res = await app.request('/repos/abc/siblings')
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Invalid repo id')
  })
})
