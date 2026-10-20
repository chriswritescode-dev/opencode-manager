import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { getScheduleJobById, createScheduleRun, getScheduleRunById, listScheduleRunsByJob } from '../../src/db/schedules'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { ScheduleService } from '../../src/services/schedules'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { createStubOpenCodeClient, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import { assistantMessage, createStubScheduleApi } from '../helpers/stub-schedule-api'

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
  return { client: createStubOpenCodeClient({ api }), api: stub.api, state: stub.state }
}

function activeRunMonitor(jobId: number): { dispose(): void } | undefined {
  const activeRuns = (ScheduleService as unknown as { activeRuns: Map<number, { sessionMonitor?: { dispose(): void } }> }).activeRuns
  return activeRuns.get(jobId)?.sessionMonitor
}

function hasCancelInProgress(jobId: number): boolean {
  return (ScheduleService as unknown as { pendingCancels: Map<number, unknown> }).pendingCancels.has(jobId)
}

function hasActiveRun(jobId: number): boolean {
  return (ScheduleService as unknown as { activeRuns: Map<number, unknown> }).activeRuns.has(jobId)
}

function createService(db: Database, localClient: ReturnType<typeof createStubOpenCodeClient>, remoteClient: ReturnType<typeof createStubOpenCodeClient>, enabled = true, registered = true) {
  const worktreeManager = {
    prepare: vi.fn().mockResolvedValue(null),
    finalize: vi.fn().mockResolvedValue({ commitHash: null }),
    pruneRunArtifacts: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockReturnValue([]),
    releaseWorktree: vi.fn().mockResolvedValue(undefined),
  }
  const registry = {
    get: vi.fn(() => (registered ? { ...REMOTE_SERVER, enabled } : undefined)),
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

  it('completes a remote run after a server reconnect when the settle event was missed', async () => {
    const localClient = createClient().client
    const { client, api, state } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)

    state.active = { 'ses-run-1': { type: 'running' } }
    const run = await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')
    await vi.waitFor(() => expect(api.session.active).toHaveBeenCalled())

    state.active = {}
    state.messages = [assistantMessage('Remote audit complete.', { completed: true })]
    sseAggregator.notifyServerConnected(REMOTE_SERVER.id)

    await vi.waitFor(() => {
      expect(getScheduleRunById(db, null, job.id, run.id)).toMatchObject({
        status: 'completed',
        responseText: 'Remote audit complete.',
      })
    })
  })

  it('keeps waiting after a remote server reconnect while the session is still busy', async () => {
    const localClient = createClient().client
    const { client, api, state } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)

    state.active = { 'ses-run-1': { type: 'running' } }
    const run = await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')
    await vi.waitFor(() => expect(api.session.active).toHaveBeenCalled())
    const activeChecks = vi.mocked(api.session.active).mock.calls.length

    sseAggregator.notifyServerConnected(REMOTE_SERVER.id)

    await vi.waitFor(() => {
      expect(vi.mocked(api.session.active).mock.calls.length).toBeGreaterThan(activeChecks)
    })
    expect(getScheduleRunById(db, null, job.id, run.id)?.status).toBe('running')

    activeRunMonitor(job.id)?.dispose()
    await vi.waitFor(() => expect(hasActiveRun(job.id)).toBe(false))
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

  it('lists remote jobs for a disabled server and for an unregistered server', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)

    const disabled = createService(db, localClient, client, false)
    expect(disabled.service.listServerJobs(REMOTE_SERVER.id).map((entry) => entry.id)).toEqual([job.id])

    const unregistered = createService(db, localClient, client, true, false)
    expect(unregistered.service.listServerJobs(REMOTE_SERVER.id).map((entry) => entry.id)).toEqual([job.id])
  })

  it('deletes a remote job while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, job.id)

    await createService(db, localClient, client, false).service.deleteServerJob(REMOTE_SERVER.id, job.id)

    expect(getScheduleJobById(db, null, job.id)).toBeNull()
    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote job when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, job.id)

    await createService(db, localClient, client, true, false).service.deleteServerJob(REMOTE_SERVER.id, job.id)

    expect(getScheduleJobById(db, null, job.id)).toBeNull()
    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('clears remote run history while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, job.id)
    seedCompletedRun(db, job.id)

    await expect(createService(db, localClient, client, false).service.clearServerRunHistory(REMOTE_SERVER.id, job.id))
      .resolves.toEqual({ cleared: 2 })

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('clears remote run history when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, job.id)

    await expect(createService(db, localClient, client, true, false).service.clearServerRunHistory(REMOTE_SERVER.id, job.id))
      .resolves.toEqual({ cleared: 1 })

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote run while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    const runId = seedCompletedRun(db, job.id)

    await createService(db, localClient, client, false).service.deleteServerRun(REMOTE_SERVER.id, job.id, runId)

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote run when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    const runId = seedCompletedRun(db, job.id)

    await createService(db, localClient, client, true, false).service.deleteServerRun(REMOTE_SERVER.id, job.id, runId)

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('cancels a running remote run while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    const run = await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')
    const disabled = createService(db, localClient, client, false)

    const cancelled = await disabled.service.cancelServerRun(REMOTE_SERVER.id, job.id, run.id)

    expect(cancelled).toMatchObject({ id: run.id, status: 'cancelled', errorText: 'Run cancelled by user.' })
    expect(hasActiveRun(job.id)).toBe(false)

    await vi.waitFor(() => expect(hasCancelInProgress(job.id)).toBe(false))

    expect(getScheduleRunById(db, null, job.id, run.id)).toMatchObject({ status: 'cancelled' })
  })

  it('cancels a running remote run when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(db, localClient, client)
    const job = await service.createServerJob(REMOTE_SERVER.id, '/srv/projects/audit', baseRequest)
    const run = await service.runServerJob(REMOTE_SERVER.id, job.id, 'manual')
    const unregistered = createService(db, localClient, client, true, false)

    const cancelled = await unregistered.service.cancelServerRun(REMOTE_SERVER.id, job.id, run.id)

    expect(cancelled).toMatchObject({ id: run.id, status: 'cancelled', errorText: 'Run cancelled by user.' })
    expect(hasActiveRun(job.id)).toBe(false)

    await vi.waitFor(() => expect(hasCancelInProgress(job.id)).toBe(false))

    expect(getScheduleRunById(db, null, job.id, run.id)).toMatchObject({ status: 'cancelled' })
  })
})

function seedCompletedRun(db: Database, jobId: number): number {
  return createScheduleRun(db, {
    jobId,
    repoId: null,
    serverId: REMOTE_SERVER.id,
    triggerSource: 'schedule',
    status: 'completed',
    startedAt: Date.now(),
    createdAt: Date.now(),
  }).id
}
