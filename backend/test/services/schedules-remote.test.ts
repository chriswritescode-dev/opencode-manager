import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getScheduleJobById, listScheduleRunsByJob } from '../../src/db/schedules'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { ScheduleService } from '../../src/services/schedules'
import { createStubOpenCodeClient, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { createStubScheduleApi } from '../helpers/stub-schedule-api'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const REMOTE_SERVER = {
  id: 'srv_kitchen',
  name: 'Kitchen server',
  baseUrl: 'http://kitchen.local:5551',
  username: 'opencode',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
}

function createDatabase(): Database {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = OFF')
  migrate(db, allMigrations)
  const now = Date.now()
  db.prepare(
    `INSERT INTO opencode_servers (id, name, base_url, username, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(REMOTE_SERVER.id, REMOTE_SERVER.name, REMOTE_SERVER.baseUrl, REMOTE_SERVER.username, 1, now, now)
  return db
}

function createClient() {
  const stub = createStubScheduleApi()
  const api = { ...stub.api, ...stubLoadedModelCatalog() } as unknown as OpenCodeApi
  return { client: createStubOpenCodeClient({ api }), api: stub.api }
}

function createService(db: Database, localClient: ReturnType<typeof createStubOpenCodeClient>, remoteClient: ReturnType<typeof createStubOpenCodeClient>, enabled = true) {
  const worktreeManager = {
    prepare: vi.fn().mockResolvedValue(null),
    finalize: vi.fn().mockResolvedValue({ commitHash: null }),
    pruneRunArtifacts: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockReturnValue([]),
    releaseWorktree: vi.fn().mockResolvedValue(undefined),
  }
  const registry = {
    get: vi.fn(() => ({ ...REMOTE_SERVER, enabled })),
    getClient: vi.fn(() => remoteClient),
  }
  const service = new ScheduleService(db, localClient, worktreeManager as never, registry as never)
  return { service, worktreeManager, registry }
}

const baseRequest = {
  name: 'Nightly audit',
  enabled: true,
  scheduleMode: 'interval' as const,
  intervalMinutes: 60,
  prompt: 'Audit the project.',
}

describe('remote schedule targets', () => {
  let db: Database

  beforeEach(() => {
    db = createDatabase()
    const staticState = ScheduleService as unknown as { activeRuns: Map<number, unknown>; pendingCancels: Map<number, unknown> }
    staticState.activeRuns.clear()
    staticState.pendingCancels.clear()
  })

  it('creates a remote job with an in-place workspace mode', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)

    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)

    expect(job.repoId).toBeNull()
    expect(job.serverId).toBe(REMOTE_SERVER.id)
    expect(job.directory).toBe('/srv/projects/audit')
    expect(job.workspaceMode).toBe('in-place')
    expect(localClient.api.session.create).not.toHaveBeenCalled()
  })

  it('rejects worktree workspace modes for a remote job', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)

    await expect(
      service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', { ...baseRequest, workspaceMode: 'worktree' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(getScheduleJobById(db, null, 1)).toBeNull()
  })

  it('runs a remote job on the remote client without touching local git', async () => {
    const localClient = createClient().client
    const { client, api } = createClient()
    const { service, worktreeManager } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)

    const run = await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')

    expect(run.repoId).toBeNull()
    expect(run.serverId).toBe(REMOTE_SERVER.id)
    expect(run.status).toBe('running')
    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: '/srv/projects/audit' },
    }))
    expect(localClient.api.session.create).not.toHaveBeenCalled()
    expect(worktreeManager.prepare).not.toHaveBeenCalled()
    expect(worktreeManager.finalize).not.toHaveBeenCalled()
  })

  it('records a failed run when the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    const disabled = createService(db, localClient, client, false)

    await expect(disabled.service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')).rejects.toMatchObject({ status: 400 })

    const runs = listScheduleRunsByJob(db, null, job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'failed', serverId: REMOTE_SERVER.id })
    expect(runs[0]?.errorText).toContain('disabled')
  })

  it('lists remote jobs and runs with the linked server name', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')

    const jobs = service.listAllJobsWithRepos()
    expect(jobs.find((entry) => entry.id === job.id)).toMatchObject({
      repoId: null,
      serverId: REMOTE_SERVER.id,
      directory: '/srv/projects/audit',
      serverName: REMOTE_SERVER.name,
      repoName: REMOTE_SERVER.name,
    })

    const runs = service.listAllRuns()
    expect(runs[0]).toMatchObject({ serverId: REMOTE_SERVER.id, serverName: REMOTE_SERVER.name })
  })
})
