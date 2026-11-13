import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import {
  createScheduleRun,
  getScheduleJobById,
  getScheduleRunById,
  listScheduleRunsByJob,
} from '../../src/db/schedules'
import { ScheduleRunRegistry, ScheduleService } from '../../src/services/schedules'
import { OpenCodeServerRegistry } from '../../src/services/opencode-server-registry'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { assistantMessage, createStubScheduleApi, createStubScheduleClient } from '../helpers/stub-schedule-api'
import { createStubWorktreeManager } from '../helpers/fake-schedule-service'
import { createTestDatabase, seedOpenCodeServer } from '../helpers/test-database'

const baseRequest = {
  name: 'Nightly audit',
  enabled: true,
  showInInbox: true,
  scheduleMode: 'interval' as const,
  intervalMinutes: 60,
  prompt: 'Audit the project.',
}

class StubServerRegistry extends OpenCodeServerRegistry {
  constructor(
    db: Database,
    private readonly stubClient: OpenCodeClient,
    private readonly availability: { enabled?: boolean; registered?: boolean } = {},
  ) {
    super(db, stubClient)
  }

  override get(serverId: string): OpenCodeServer | null {
    if (this.availability.registered === false) return null
    const server = super.get(serverId)
    if (!server) return null
    return this.availability.enabled === false ? { ...server, enabled: false } : server
  }

  override getClient(): OpenCodeClient {
    return this.stubClient
  }
}

function createClient() {
  const stub = createStubScheduleApi()
  return { api: stub.api, state: stub.state, client: createStubScheduleClient(stub) }
}

function seedCompletedRun(db: Database, serverId: string, jobId: number): number {
  return createScheduleRun(db, {
    jobId,
    repoId: null,
    serverId,
    triggerSource: 'schedule',
    status: 'completed',
    startedAt: Date.now(),
    createdAt: Date.now(),
  }).id
}

describe('remote schedule targets', () => {
  let db: Database
  let server: OpenCodeServer
  let runs: ScheduleRunRegistry

  function createService(
    localClient: OpenCodeClient,
    remoteClient: OpenCodeClient,
    availability: { enabled?: boolean; registered?: boolean } = {},
  ) {
    const worktreeManager = createStubWorktreeManager()
    const registry = new StubServerRegistry(db, remoteClient, availability)
    const service = new ScheduleService(db, localClient, worktreeManager, registry, null, runs)
    return { service, worktreeManager, registry }
  }

  beforeEach(() => {
    db = createTestDatabase()
    server = seedOpenCodeServer(db, { name: 'Kitchen server', baseUrl: 'http://kitchen.local:5551' })
    runs = new ScheduleRunRegistry()
  })

  afterEach(() => {
    db.close()
  })

  it('creates a remote job with an in-place workspace mode', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)

    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)

    expect(job.repoId).toBeNull()
    expect(job.serverId).toBe(server.id)
    expect(job.directory).toBe('/srv/projects/audit')
    expect(job.workspaceMode).toBe('in-place')
    expect(localClient.api.session.create).not.toHaveBeenCalled()
  })

  it('rejects worktree workspace modes for a remote job', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)

    await expect(
      service.createServerJob(server.id, '/srv/projects/audit', { ...baseRequest, workspaceMode: 'worktree' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(getScheduleJobById(db, null, 1)).toBeNull()
  })

  it('runs a remote job on the remote client without touching local git', async () => {
    const localClient = createClient().client
    const { client, api } = createClient()
    const { service, worktreeManager } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)

    const run = await service.runServerJob(server.id, job.id, 'manual')

    expect(run.repoId).toBeNull()
    expect(run.serverId).toBe(server.id)
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
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)

    state.active = { 'ses-run-1': { type: 'running' } }
    const run = await service.runServerJob(server.id, job.id, 'manual')
    await vi.waitFor(() => expect(api.session.active).toHaveBeenCalled())

    state.active = {}
    state.messages = [assistantMessage('Remote audit complete.', { completed: true })]
    sseAggregator.notifyServerConnected(server.id)

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
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)

    state.active = { 'ses-run-1': { type: 'running' } }
    const run = await service.runServerJob(server.id, job.id, 'manual')
    await vi.waitFor(() => expect(api.session.active).toHaveBeenCalled())
    const activeChecks = vi.mocked(api.session.active).mock.calls.length

    sseAggregator.notifyServerConnected(server.id)

    await vi.waitFor(() => {
      expect(vi.mocked(api.session.active).mock.calls.length).toBeGreaterThan(activeChecks)
    })
    expect(getScheduleRunById(db, null, job.id, run.id)?.status).toBe('running')

    runs.disposeSessionMonitor(job.id, run.id)
    await vi.waitFor(() => expect(runs.snapshot(job.id)).toBeNull())
  })

  it('records a failed run when the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    const disabled = createService(localClient, client, { enabled: false })

    await expect(disabled.service.runServerJob(server.id, job.id, 'manual')).rejects.toMatchObject({ status: 400 })

    const runs = listScheduleRunsByJob(db, null, job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'failed', serverId: server.id })
    expect(runs[0]?.errorText).toContain('disabled')
  })

  it('lists remote jobs and runs with the linked server name', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    await service.runServerJob(server.id, job.id, 'manual')

    const jobs = service.listAllJobsWithRepos()
    expect(jobs.find((entry) => entry.id === job.id)).toMatchObject({
      repoId: null,
      serverId: server.id,
      directory: '/srv/projects/audit',
      serverName: server.name,
      repoName: server.name,
    })

    const runs = service.listAllRuns()
    expect(runs[0]).toMatchObject({ serverId: server.id, serverName: server.name })
  })

  it('lists remote jobs for a disabled server and for an unregistered server', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)

    const disabled = createService(localClient, client, { enabled: false })
    expect(disabled.service.listServerJobs(server.id).map((entry) => entry.id)).toEqual([job.id])

    const unregistered = createService(localClient, client, { registered: false })
    expect(unregistered.service.listServerJobs(server.id).map((entry) => entry.id)).toEqual([job.id])
  })

  it('deletes a remote job while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, server.id, job.id)

    await createService(localClient, client, { enabled: false }).service.deleteServerJob(server.id, job.id)

    expect(getScheduleJobById(db, null, job.id)).toBeNull()
    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote job when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, server.id, job.id)

    await createService(localClient, client, { registered: false }).service.deleteServerJob(server.id, job.id)

    expect(getScheduleJobById(db, null, job.id)).toBeNull()
    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('clears remote run history while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, server.id, job.id)
    seedCompletedRun(db, server.id, job.id)

    await expect(
      createService(localClient, client, { enabled: false }).service.clearServerRunHistory(server.id, job.id),
    ).resolves.toEqual({ cleared: 2 })

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('clears remote run history when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    seedCompletedRun(db, server.id, job.id)

    await expect(
      createService(localClient, client, { registered: false }).service.clearServerRunHistory(server.id, job.id),
    ).resolves.toEqual({ cleared: 1 })

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote run while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    const runId = seedCompletedRun(db, server.id, job.id)

    await createService(localClient, client, { enabled: false }).service.deleteServerRun(server.id, job.id, runId)

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('deletes a remote run when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    const runId = seedCompletedRun(db, server.id, job.id)

    await createService(localClient, client, { registered: false }).service.deleteServerRun(server.id, job.id, runId)

    expect(listScheduleRunsByJob(db, null, job.id)).toEqual([])
  })

  it('cancels a running remote run while the target server is disabled', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    const run = await service.runServerJob(server.id, job.id, 'manual')
    const disabled = createService(localClient, client, { enabled: false })

    const cancelled = await disabled.service.cancelServerRun(server.id, job.id, run.id)

    expect(cancelled).toMatchObject({ id: run.id, status: 'cancelled', errorText: 'Run cancelled by user.' })
    expect(runs.snapshot(job.id)).toBeNull()

    await vi.waitFor(() => expect(runs.hasPendingCancel(job.id)).toBe(false))

    expect(getScheduleRunById(db, null, job.id, run.id)).toMatchObject({ status: 'cancelled' })
  })

  it('cancels a running remote run when the target server is missing from the registry', async () => {
    const localClient = createClient().client
    const { client } = createClient()
    const { service } = createService(localClient, client)
    const job = await service.createServerJob(server.id, '/srv/projects/audit', baseRequest)
    const run = await service.runServerJob(server.id, job.id, 'manual')
    const unregistered = createService(localClient, client, { registered: false })

    const cancelled = await unregistered.service.cancelServerRun(server.id, job.id, run.id)

    expect(cancelled).toMatchObject({ id: run.id, status: 'cancelled', errorText: 'Run cancelled by user.' })
    expect(runs.snapshot(job.id)).toBeNull()

    await vi.waitFor(() => expect(runs.hasPendingCancel(job.id)).toBe(false))

    expect(getScheduleRunById(db, null, job.id, run.id)).toMatchObject({ status: 'cancelled' })
  })
})
