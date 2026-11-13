import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import path from 'node:path'
import type { SessionInfo, V2Event } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID, SessionSandboxStateSchema } from '@opencode-manager/shared/schemas'
import type { CronOptions } from 'croner'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import { getScheduleWorktreePath } from '../../src/services/schedule-worktree-paths'
import {
  createScheduleRun,
  getScheduleJobById,
  getScheduleRunById,
  listScheduleRunsByJob,
  updateScheduleRun,
  updateScheduleRunWorktree,
} from '../../src/db/schedules'
import { insertSessionSandboxModeIfAbsent } from '../../src/db/session-sandbox-modes'
import {
  ScheduleRunner,
  ScheduleRunRegistry,
  ScheduleService,
  type CronFactory,
  type ScheduleSandboxDependencies,
} from '../../src/services/schedules'
import { SessionSandboxError } from '../../src/services/session-sandbox'
import { sseAggregator } from '../../src/services/sse-aggregator'
import type { Repo } from '../../src/types/repo'
import { createStubWorktreeManager, type StubWorktreeManager } from '../helpers/fake-schedule-service'
import { testLogEntries } from '../helpers/log-assertions'
import { createStubOpenCodeClient, modelInfo, sessionInfo, stubLoadedModelCatalog } from '../helpers/stub-opencode-client'
import {
  assistantMessage,
  createStubScheduleApi,
  type ScheduleApiState,
  skill,
} from '../helpers/stub-schedule-api'
import { createTestDatabase, seedRepo, seedScheduleJob } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

let runs = new ScheduleRunRegistry()

async function settleScheduleRuns(registry: ScheduleRunRegistry, jobIds: readonly number[]): Promise<void> {
  for (const jobId of jobIds) {
    const snapshot = registry.snapshot(jobId)
    if (snapshot?.hasSessionMonitor) registry.disposeSessionMonitor(jobId, snapshot.runId)
  }
  await vi
    .waitFor(() => {
      for (const jobId of jobIds) expect(registry.snapshot(jobId)).toBeNull()
    }, { timeout: 3000 })
    .catch(() => undefined)
}

const SANDBOX_RESOURCES = { cpus: 4, memoryMib: 8192 }
const SANDBOX_STATE = SessionSandboxStateSchema.parse({
  sessionId: 'ses-run-1',
  rootSessionId: 'ses-run-1',
  sandboxed: true,
  source: 'user',
  resources: SANDBOX_RESOURCES,
  effectiveResources: SANDBOX_RESOURCES,
  lockedReason: null,
  available: true,
})

const BASE_JOB = {
  name: 'Weekly engineering summary',
  prompt: 'Review the repository and summarize the current state.',
  branch: null,
  intervalMinutes: 60,
} as const

function idleEvent(directory: string, sessionID: string): V2Event {
  return {
    id: `evt_${sessionID}`,
    created: Date.now(),
    type: 'session.idle',
    location: { directory },
    data: { sessionID },
  }
}

function executionSucceededEvent(directory: string, sessionID: string): V2Event {
  return {
    id: 'evt_exec_succeeded',
    created: Date.now(),
    type: 'session.execution.succeeded',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    location: { directory },
    data: { sessionID },
  }
}

describe('ScheduleService', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let job: ScheduleJob
  let jobIds: number[]

  function createClient(state: Partial<ScheduleApiState> = {}) {
    const stub = createStubScheduleApi(state)
    const catalog = stubLoadedModelCatalog()
    const client = createStubOpenCodeClient({
      api: {
        session: stub.api.session,
        message: stub.api.message,
        skill: stub.api.skill,
        agent: stub.api.agent,
        mcp: stub.api.mcp,
        config: catalog.config,
        model: catalog.model,
      },
    })
    return { api: stub.api, state: stub.state, client, catalog }
  }

  function createService(
    client: Awaited<ReturnType<typeof createClient>>['client'],
    overrides: {
      worktreeManager?: StubWorktreeManager
      sandbox?: ScheduleSandboxDependencies | null
    } = {},
  ) {
    const worktreeManager = overrides.worktreeManager ?? createStubWorktreeManager()
    const service = new ScheduleService(db, client, worktreeManager, null, overrides.sandbox ?? null, runs)
    return { service, worktreeManager }
  }

  function seedJob(overrides: Partial<Parameters<typeof seedScheduleJob>[2]> = {}): ScheduleJob {
    const created = seedScheduleJob(db, repo.id, { ...BASE_JOB, ...overrides })
    jobIds.push(created.id)
    return created
  }

  function seedRunningRun(jobId: number, overrides: Partial<Parameters<typeof createScheduleRun>[1]> = {}): ScheduleRun {
    return createScheduleRun(db, {
      jobId,
      repoId: repo.id,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
      ...overrides,
    })
  }

  function createSandboxDeps() {
    const sessions: ScheduleSandboxDependencies['sessions'] = {
      assertSandboxRequestAllowed: vi.fn(),
      update: vi.fn(async () => SANDBOX_STATE),
      resolveShellTarget: vi.fn(async () => ({ rootSessionId: 'ses-run-1', resources: SANDBOX_RESOURCES })),
    }
    const runtime: ScheduleSandboxDependencies['runtime'] = {
      planShell: vi.fn(async () => ({ mode: 'sandbox' as const, name: 'ocm-ses-run-1', workdir: repo.fullPath })),
      removeSessionSandbox: vi.fn(async () => undefined),
    }
    return { sessions, runtime }
  }

  async function waitForRun(jobId: number, runId: number, expected: { status: string }): Promise<ScheduleRun> {
    let run: ScheduleRun | null = null
    await vi.waitFor(() => {
      run = getScheduleRunById(db, repo.id, jobId, runId)
      expect(run?.status).toBe(expected.status)
    }, { timeout: 5000 })
    return getScheduleRunById(db, repo.id, jobId, runId) ?? seedRunningRun(jobId)
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedules-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project', repoUrl: 'https://github.com/example/sample-project' })
    jobIds = []
    job = seedJob({ nextRunAt: Date.now() + 3_600_000 })
    runs = new ScheduleRunRegistry()
  })

  afterEach(async () => {
    await settleScheduleRuns(runs, jobIds)
    db.close()
    workspace.restore()
  })

  it('completes a run from the newest assistant message', async () => {
    const { api, client } = createClient({ messages: [assistantMessage('System health is stable.', { completed: true })] })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')

    expect(run.sessionId).toBe('ses-run-1')
    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Scheduled: Weekly engineering summary',
      model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
      location: { directory: repo.fullPath },
    }))
    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed).toMatchObject({ responseText: 'System health is stable.', sessionId: 'ses-run-1' })
    expect(api.message.list).toHaveBeenCalledWith({ sessionID: 'ses-run-1', order: 'desc', limit: 20 })
    expect(getScheduleJobById(db, repo.id, job.id)?.nextRunAt).toBe(job.nextRunAt)
  })

  it('completes a run after the server reconnects when the settle event was missed', async () => {
    const { client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())

    state.active = {}
    state.messages = [assistantMessage('Recovered summary.', { completed: true })]
    sseAggregator.notifyServerConnected(LOCAL_OPENCODE_SERVER_ID)

    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed.responseText).toBe('Recovered summary.')
  })

  it('keeps waiting after a server reconnect while the session is still busy', async () => {
    const { client } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())

    sseAggregator.notifyServerConnected(LOCAL_OPENCODE_SERVER_ID)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('running')
  })

  it('strips thinking blocks from the persisted response while joining text items', async () => {
    const { client } = createClient({
      messages: [
        assistantMessage('', {
          completed: true,
          content: [
            { type: 'text', text: '\u003cthink\u003eprivate reasoning\u003c/think\u003e\nFinal answer' },
            { type: 'text', text: 'Second paragraph.' },
          ],
        }),
      ],
    })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')

    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed.responseText).toBe('Final answer\n\nSecond paragraph.')
  })

  it('submits exactly one prompt carrying the job prompt', async () => {
    const { api, client } = createClient({ messages: [assistantMessage('Done.', { completed: true })] })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await waitForRun(job.id, run.id, { status: 'completed' })

    expect(api.session.prompt).toHaveBeenCalledTimes(1)
    expect(api.session.prompt).toHaveBeenCalledWith({ sessionID: 'ses-run-1', text: job.prompt })
  })

  it('completes from a session idle event for the run directory', async () => {
    const { client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('running')

    state.active = {}
    state.messages = [assistantMessage('Event driven summary.', { completed: true })]
    sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))

    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed.responseText).toBe('Event driven summary.')
  })

  it('completes from a directory-less session.execution.succeeded resolved to the run directory', async () => {
    const { client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())

    state.active = {}
    state.messages = [assistantMessage('Execution summary.', { completed: true })]
    sseAggregator.notifyEvent(repo.fullPath, executionSucceededEvent(repo.fullPath, 'ses-run-1'))

    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed.responseText).toBe('Execution summary.')
  })

  it('keeps waiting when an intermediate assistant step completes while the session is still busy', async () => {
    const { client, state } = createClient({
      active: { 'ses-run-1': { type: 'running' } },
      messages: [assistantMessage('', { completed: true })],
    })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())

    sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('running')

    state.active = {}
    state.messages = [assistantMessage('Final answer.', { completed: true })]
    sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))

    const completed = await waitForRun(job.id, run.id, { status: 'completed' })
    expect(completed.responseText).toBe('Final answer.')
  })

  it('rejects a new run when the job already has a running run', async () => {
    const { client } = createClient()
    const { service } = createService(client)
    seedRunningRun(job.id)

    await expect(service.runJob(repo.id, job.id, 'manual')).rejects.toMatchObject({
      message: 'Schedule is already running',
      status: 409,
    })
  })

  it('fails the run when the model catalog cannot be read', async () => {
    const { client, catalog } = createClient()
    vi.mocked(catalog.model.list).mockRejectedValueOnce(new Error('model catalog unavailable'))
    const { service } = createService(client)

    await expect(service.runJob(repo.id, job.id, 'manual')).rejects.toMatchObject({
      message: 'model catalog unavailable',
      status: 500,
    })

    const runs = listScheduleRunsByJob(db, repo.id, job.id)
    expect(runs[0]).toMatchObject({ status: 'failed', errorText: 'model catalog unavailable' })
  })

  it('marks the run failed when prompt submission is rejected after session creation', async () => {
    const { api, client } = createClient({ promptError: new Error('Provider unavailable') })
    const { service } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')
    expect(run.sessionId).toBe('ses-run-1')

    const failed = await waitForRun(job.id, run.id, { status: 'failed' })
    expect(failed).toMatchObject({ errorText: 'Provider unavailable', sessionId: 'ses-run-1' })
    expect(api.session.create).toHaveBeenCalledTimes(1)
  })

  describe('run cancellation', () => {
    it('cancels an in-progress run by interrupting the linked session', async () => {
      const { api, client } = createClient({ messages: [] })
      const { service } = createService(client)
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, {
        status: 'running',
        finishedAt: 0,
        sessionId: 'ses-run-3',
        sessionTitle: 'Scheduled: Weekly engineering summary',
      })

      const cancelled = await service.cancelRun(repo.id, job.id, run.id)

      expect(cancelled).toMatchObject({ status: 'cancelled', errorText: 'Run cancelled by user.' })
      expect(api.session.interrupt).toHaveBeenCalledWith({ sessionID: 'ses-run-3' })
      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('cancelled')
    })

    it('rejects cancellation for runs that already finished', async () => {
      const { client } = createClient()
      const { service } = createService(client)
      const run = seedRunningRun(job.id, { status: 'completed' })

      await expect(service.cancelRun(repo.id, job.id, run.id)).rejects.toMatchObject({
        message: 'Only running schedule runs can be cancelled',
        status: 409,
      })
    })

    it('cancels a running entry without a linked session', async () => {
      const { api, client } = createClient()
      const { service } = createService(client)
      const run = seedRunningRun(job.id)

      const cancelled = await service.cancelRun(repo.id, job.id, run.id)

      expect(cancelled).toMatchObject({ status: 'cancelled', errorText: 'Run cancelled by user.' })
      expect(api.session.interrupt).not.toHaveBeenCalled()
    })

    it('surfaces interrupt failures when cancellation cannot reach OpenCode', async () => {
      const { client } = createClient({ interruptError: new Error('Abort refused') })
      const { service } = createService(client)
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, {
        status: 'running',
        finishedAt: 0,
        sessionId: 'ses-run-7',
      })

      await expect(service.cancelRun(repo.id, job.id, run.id)).rejects.toMatchObject({
        message: 'Abort refused',
        status: 502,
      })
      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('running')
    })

    it('does not overwrite a cancelled run with a completion that arrives after the cancel', async () => {
      const { api, client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
      const { service } = createService(client)
      const run = await service.runJob(repo.id, job.id, 'manual')
      await vi.waitFor(() => expect(runs.snapshot(job.id)?.hasSessionMonitor).toBe(true))

      await service.cancelRun(repo.id, job.id, run.id)
      state.active = {}
      state.messages = [assistantMessage('Late completion.', { completed: true })]
      sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('cancelled')
      expect(api.session.interrupt).toHaveBeenCalledTimes(1)
    })

    it('does not finalize a settled monitor after the cancel', async () => {
      const { api, client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
      const { service } = createService(client)
      let resolveActive!: (value: Awaited<ReturnType<typeof api.session.active>>) => void
      vi.mocked(api.session.active).mockReturnValueOnce(new Promise((resolve) => { resolveActive = resolve }))

      const run = await service.runJob(repo.id, job.id, 'manual')
      await vi.waitFor(() => expect(api.session.active).toHaveBeenCalledTimes(1))

      await service.cancelRun(repo.id, job.id, run.id)
      state.messages = [assistantMessage('Completed before the monitor resolved.', { completed: true })]
      resolveActive({})
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('cancelled')
    })

    it('holds monitor completion until a pending cancellation resolves', async () => {
      const { api, client, state } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
      const { service } = createService(client)
      const run = await service.runJob(repo.id, job.id, 'manual')
      await vi.waitFor(() => expect(runs.snapshot(job.id)?.hasSessionMonitor).toBe(true))

      let resolveInterrupt!: (value: { interrupted: boolean }) => void
      vi.mocked(api.session.interrupt).mockReturnValueOnce(
        new Promise((resolve) => { resolveInterrupt = resolve }),
      )
      const cancelPromise = service.cancelRun(repo.id, job.id, run.id)
      await vi.waitFor(() => expect(api.session.interrupt).toHaveBeenCalled())

      state.messages = [assistantMessage('Late completion.', { completed: true })]
      sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('running')

      resolveInterrupt({ interrupted: true })
      await cancelPromise

      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('cancelled')
    })

    it('rejects a duplicate cancellation while one is in progress', async () => {
      const { api, client } = createClient({ active: { 'ses-run-1': { type: 'running' } } })
      const { service } = createService(client)
      const run = await service.runJob(repo.id, job.id, 'manual')
      await vi.waitFor(() => expect(runs.snapshot(job.id)?.hasSessionMonitor).toBe(true))

      let resolveInterrupt!: (value: { interrupted: boolean }) => void
      vi.mocked(api.session.interrupt).mockReturnValueOnce(
        new Promise((resolve) => { resolveInterrupt = resolve }),
      )
      const firstCancel = service.cancelRun(repo.id, job.id, run.id)
      await vi.waitFor(() => expect(api.session.interrupt).toHaveBeenCalledTimes(1))

      await expect(service.cancelRun(repo.id, job.id, run.id)).rejects.toMatchObject({ status: 409 })
      expect(api.session.interrupt).toHaveBeenCalledTimes(1)

      resolveInterrupt({ interrupted: true })
      await firstCancel

      expect(getScheduleRunById(db, repo.id, job.id, run.id)?.status).toBe('cancelled')
    })

    it('keeps monitoring when the interrupt fails during cancellation', async () => {
      const { api, client, state } = createClient({
        active: { 'ses-run-1': { type: 'running' } },
        interruptError: new Error('Abort refused'),
      })
      const { service } = createService(client)
      const run = await service.runJob(repo.id, job.id, 'manual')
      await vi.waitFor(() => expect(runs.snapshot(job.id)?.hasSessionMonitor).toBe(true))

      await expect(service.cancelRun(repo.id, job.id, run.id)).rejects.toMatchObject({ status: 502 })

      state.active = {}
      state.messages = [assistantMessage('Finished after failed cancel.', { completed: true })]
      sseAggregator.notifyEvent(repo.fullPath, idleEvent(repo.fullPath, 'ses-run-1'))

      const completed = await waitForRun(job.id, run.id, { status: 'completed' })
      expect(completed.responseText).toBe('Finished after failed cancel.')
      expect(api.session.interrupt).toHaveBeenCalledTimes(1)
    })

    it('cancels by finalizing the run when the assistant already completed', async () => {
      const { api, client } = createClient({ messages: [assistantMessage('Completed summary', { completed: true })] })
      const { service } = createService(client)
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-5' })

      const cancelled = await service.cancelRun(repo.id, job.id, run.id)

      expect(cancelled).toMatchObject({ status: 'completed', responseText: 'Completed summary' })
      expect(api.session.interrupt).not.toHaveBeenCalled()
    })
  })

  describe('run recovery', () => {
    it('fails an orphaned idle run and keeps its partial response', async () => {
      const { client } = createClient({ messages: [assistantMessage('Partial summary')] })
      const { service } = createService(client)
      const run = seedRunningRun(job.id, { triggerSource: 'schedule' })
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-4' })

      await service.recoverRunningRuns()

      expect(getScheduleRunById(db, repo.id, job.id, run.id)).toMatchObject({
        status: 'failed',
        responseText: 'Partial summary',
        errorText: expect.stringContaining('interrupted before completion'),
      })
    })

    it('finalizes an interrupted run without a linked session during recovery', async () => {
      const { client } = createClient()
      const { service } = createService(client)
      const run = seedRunningRun(job.id)

      await service.recoverRunningRuns()

      expect(getScheduleRunById(db, repo.id, job.id, run.id)).toMatchObject({
        status: 'failed',
        errorText: expect.stringContaining('no linked session to recover'),
      })
    })

    it('completes a recoverable run whose assistant already finished', async () => {
      const { client } = createClient({ messages: [assistantMessage('Recovered summary', { completed: true })] })
      const { service } = createService(client)
      const run = seedRunningRun(job.id, { triggerSource: 'schedule' })
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-8' })

      await service.recoverRunningRuns()

      expect(getScheduleRunById(db, repo.id, job.id, run.id)).toMatchObject({
        status: 'completed',
        responseText: 'Recovered summary',
      })
    })

    it('resumes a recoverable run whose session is still active', async () => {
      const { client, state } = createClient({ active: { 'ses-run-9': { type: 'running' } } })
      const { service } = createService(client)
      const run = seedRunningRun(job.id, { triggerSource: 'schedule' })
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-9' })

      await service.recoverRunningRuns()
      await vi.waitFor(() => expect(runs.snapshot(job.id)).not.toBeNull())

      state.active = {}
      state.messages = [assistantMessage('Recovered after reconnect', { completed: true })]
      sseAggregator.notifyServerConnected(LOCAL_OPENCODE_SERVER_ID)

      const completed = await waitForRun(job.id, run.id, { status: 'completed' })
      expect(completed).toMatchObject({ responseText: 'Recovered after reconnect', sessionId: 'ses-run-9' })
    })
  })

  describe('job management', () => {
    it('lists persisted jobs and runs', () => {
      const { client } = createClient()
      const { service } = createService(client)
      const run = seedRunningRun(job.id, { status: 'completed' })

      expect(service.listJobs(repo.id).map((entry) => entry.id)).toContain(job.id)
      expect(service.listRuns(repo.id, job.id, 10).map((entry) => entry.id)).toEqual([run.id])
    })

    it('creates and updates jobs using normalized persistence input', async () => {
      const { client } = createClient()
      const { service } = createService(client)

      const created = await service.createJob(repo.id, {
        name: 'Daily release summary',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'interval',
        intervalMinutes: 120,
        prompt: 'Summarize release readiness.',
      })

      expect(created).toMatchObject({ name: 'Daily release summary', scheduleMode: 'interval', intervalMinutes: 120 })
      expect(getScheduleJobById(db, repo.id, created.id)).toMatchObject({ name: 'Daily release summary' })

      const updated = await service.updateJob(repo.id, created.id, { name: 'Updated release summary' })

      expect(updated.name).toBe('Updated release summary')
      expect(getScheduleJobById(db, repo.id, created.id)?.name).toBe('Updated release summary')
    })

    it('rejects saving a job whose agent is not available in the repo', async () => {
      const { client } = createClient({ agents: ['build', 'plan'] })
      const { service } = createService(client)

      await expect(service.createJob(repo.id, {
        name: 'Daily release summary',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Summarize release readiness.',
        agentSlug: 'assistant',
      })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Agent "assistant" is not available') })

      await expect(service.updateJob(repo.id, job.id, { agentSlug: 'assistant' })).rejects.toMatchObject({ status: 400 })
      expect(listScheduleRunsByJob(db, repo.id, job.id)).toEqual([])
      expect(getScheduleJobById(db, repo.id, job.id)?.agentSlug).toBeNull()
    })

    it('saves a job whose agent is available and allows clearing the agent', async () => {
      const { api, client } = createClient({ agents: ['build', 'plan'] })
      const { service } = createService(client)

      const saved = await service.updateJob(repo.id, job.id, { agentSlug: 'plan' })
      expect(saved.agentSlug).toBe('plan')

      const cleared = await service.updateJob(repo.id, job.id, { agentSlug: null })
      expect(cleared.agentSlug).toBeNull()
      expect(api.agent.list).toHaveBeenCalledTimes(1)
    })

    it('rejects changing the workspace mode while a run is in progress', async () => {
      const { client } = createClient()
      const { service } = createService(client)
      runs.start(job.id, 5, new AbortController())

      await expect(service.updateJob(repo.id, job.id, { workspaceMode: 'kept-worktree' })).rejects.toMatchObject({
        message: 'Cannot change where runs execute while a run is in progress.',
        status: 409,
      })
      expect(getScheduleJobById(db, repo.id, job.id)?.workspaceMode).toBe(job.workspaceMode)
    })

    it('throws when deleting or loading missing records', async () => {
      const { client } = createClient()
      const { service } = createService(client)

      await expect(service.deleteJob(repo.id, 999)).rejects.toThrow('Schedule not found')
      expect(() => service.getRun(repo.id, job.id, 999)).toThrow('Run not found')
    })

    it.each([
      ['an active run', () => runs.start(job.id, 5, new AbortController())],
      ['a persisted running run', () => seedRunningRun(job.id)],
    ])('blocks deleting a job while %s exists', async (_label, arrange) => {
      const { client } = createClient()
      const { service } = createService(client)
      arrange()

      await expect(service.deleteJob(repo.id, job.id)).rejects.toThrow(
        'Cannot delete a schedule while it is running. Cancel the run first.',
      )
      expect(getScheduleJobById(db, repo.id, job.id)).not.toBeNull()
    })

    it.each([
      ['an active run', () => runs.start(job.id, 5, new AbortController())],
      ['a persisted running run', () => seedRunningRun(job.id)],
    ])('blocks repo deletion while %s exists', async (_label, arrange) => {
      const { client } = createClient()
      const { service } = createService(client)
      const onJobChange = vi.fn()
      service.setJobChangeHandler(onJobChange)
      arrange()

      await expect(service.prepareRepoDelete(repo.id)).rejects.toThrow(
        'Cannot delete a repo while a schedule run is in progress. Cancel the run first.',
      )
      expect(onJobChange).not.toHaveBeenCalled()
    })

    it('deletes a job and notifies the change handler', async () => {
      const { client } = createClient()
      const { service } = createService(client)
      const onJobChange = vi.fn()
      service.setJobChangeHandler(onJobChange)

      await service.deleteJob(repo.id, job.id)

      expect(getScheduleJobById(db, repo.id, job.id)).toBeNull()
      expect(onJobChange).toHaveBeenCalledWith(null, job.id)
    })

    it('prepares repo deletion by unregistering jobs and releasing their worktrees without deleting records', async () => {
      const { client } = createClient()
      const worktreeManager = createStubWorktreeManager()
      worktreeManager.listWorktrees.mockReturnValue([
        { jobId: job.id, runId: 3, worktreePath: '/wt/job-7-run-3', branch: 'schedule/7/run-3' },
      ])
      const { service } = createService(client, { worktreeManager })
      const onJobChange = vi.fn()
      service.setJobChangeHandler(onJobChange)

      await service.prepareRepoDelete(repo.id)

      expect(onJobChange).toHaveBeenCalledWith(null, job.id)
      expect(worktreeManager.releaseWorktree).toHaveBeenCalledTimes(1)
      expect(getScheduleJobById(db, repo.id, job.id)).not.toBeNull()
    })
  })

  describe('skill attachments in the prompt', () => {
    it('attaches every registered skill slug as a native skill attachment', async () => {
      const { api, client } = createClient({
        skills: [skill('git-release'), skill('code-review')],
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const { service } = createService(client)
      const jobWithSkills = seedJob({
        skillMetadata: { skillSlugs: ['git-release', 'code-review'], notes: undefined },
      })

      const run = await service.runJob(repo.id, jobWithSkills.id, 'manual')
      await waitForRun(jobWithSkills.id, run.id, { status: 'completed' })

      expect(api.session.prompt).toHaveBeenCalledWith({
        sessionID: 'ses-run-1',
        text: jobWithSkills.prompt,
        skills: [{ id: 'git-release' }, { id: 'code-review' }],
      })
      expect(api.skill.list).toHaveBeenCalledWith({ location: { directory: repo.fullPath } })
    })

    it('drops skill slugs that are not registered in the location', async () => {
      const { api, client } = createClient({
        skills: [skill('git-release')],
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const { service } = createService(client)
      const jobWithSkills = seedJob({ skillMetadata: { skillSlugs: ['git-release', 'unknown-skill'], notes: undefined } })

      const run = await service.runJob(repo.id, jobWithSkills.id, 'manual')
      await waitForRun(jobWithSkills.id, run.id, { status: 'completed' })

      expect(api.session.prompt).toHaveBeenCalledWith({
        sessionID: 'ses-run-1',
        text: jobWithSkills.prompt,
        skills: [{ id: 'git-release' }],
      })
    })

    it('omits skill attachments when skillSlugs is empty and carries the skill notes', async () => {
      const { api, client } = createClient({ messages: [assistantMessage('Done.', { completed: true })] })
      const { service } = createService(client)
      const jobWithNotes = seedJob({ skillMetadata: { skillSlugs: [], notes: 'some notes' } })

      const run = await service.runJob(repo.id, jobWithNotes.id, 'manual')
      await waitForRun(jobWithNotes.id, run.id, { status: 'completed' })

      expect(api.session.prompt).toHaveBeenCalledWith({
        sessionID: 'ses-run-1',
        text: `${jobWithNotes.prompt}\n\nSkill notes: some notes`,
      })
      expect(api.skill.list).not.toHaveBeenCalled()
    })

    it('continues without skill attachments when the skill list fails', async () => {
      const { api, client } = createClient({
        skillError: new Error('skill endpoint unavailable'),
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const { service } = createService(client)
      const jobWithSkills = seedJob({ skillMetadata: { skillSlugs: ['git-release'], notes: undefined } })

      const run = await service.runJob(repo.id, jobWithSkills.id, 'manual')
      await waitForRun(jobWithSkills.id, run.id, { status: 'completed' })

      expect(api.session.prompt).toHaveBeenCalledWith({ sessionID: 'ses-run-1', text: jobWithSkills.prompt })
      expect(testLogEntries('warn').length).toBeGreaterThan(0)
    })
  })

  describe('MCP servers attached to the job', () => {
    it('adds schedule-only servers and connects configured ones before the session starts', async () => {
      const { api, client } = createClient({
        messages: [assistantMessage('Done.', { completed: true })],
        mcp: { github: { status: 'disabled' }, linear: { status: 'connected' } },
      })
      const { service } = createService(client)
      const config = { type: 'remote' as const, url: 'https://mcp.example.com/mcp' }
      const jobWithMcp = seedJob({ mcpServers: [{ name: 'github' }, { name: 'linear' }, { name: 'custom', config }] })

      const run = await service.runJob(repo.id, jobWithMcp.id, 'manual')
      await waitForRun(jobWithMcp.id, run.id, { status: 'completed' })

      const location = { location: { directory: repo.fullPath } }
      expect(api.mcp.add).toHaveBeenCalledWith({ server: 'custom', config, ...location })
      expect(api.mcp.connect).toHaveBeenCalledWith({ server: 'github', ...location })
      expect(api.mcp.connect).toHaveBeenCalledWith({ server: 'custom', ...location })
      expect(api.mcp.connect).not.toHaveBeenCalledWith({ server: 'linear', ...location })
      const [firstConnect] = vi.mocked(api.mcp.connect).mock.invocationCallOrder
      const [sessionCreate] = vi.mocked(api.session.create).mock.invocationCallOrder
      expect(firstConnect).toBeLessThan(sessionCreate ?? 0)
    })

    it('fails the run without creating a session when an attached server cannot connect', async () => {
      const { api, client } = createClient({
        mcp: { github: { status: 'disabled' } },
        mcpConnectResults: { github: { status: 'needs_auth', error: 'Authorization required' } },
      })
      const { service } = createService(client)
      const jobWithMcp = seedJob({ mcpServers: [{ name: 'github' }] })

      await expect(service.runJob(repo.id, jobWithMcp.id, 'manual')).rejects.toThrow(
        'MCP servers failed to connect: github (Authorization required)',
      )

      expect(api.session.create).not.toHaveBeenCalled()
      expect(listScheduleRunsByJob(db, repo.id, jobWithMcp.id)[0]).toMatchObject({
        status: 'failed',
        errorText: 'MCP servers failed to connect: github (Authorization required)',
      })
    })

    it('fails the run when a referenced server is not configured', async () => {
      const { api, client } = createClient()
      const { service } = createService(client)
      const jobWithMcp = seedJob({ mcpServers: [{ name: 'missing' }] })

      await expect(service.runJob(repo.id, jobWithMcp.id, 'manual')).rejects.toThrow(
        'MCP servers are not configured for this location: missing',
      )

      expect(api.mcp.connect).not.toHaveBeenCalled()
      expect(api.session.create).not.toHaveBeenCalled()
    })
  })

  describe('sandboxed runs', () => {
    const sandboxJobConfig = { enabled: true, resources: SANDBOX_RESOURCES }

    it('boots the run sandbox with the job resources before the first prompt', async () => {
      const { api, client } = createClient({ messages: [assistantMessage('Done.', { completed: true })] })
      const { sessions, runtime } = createSandboxDeps()
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const sandboxJob = seedJob({ sandbox: sandboxJobConfig })

      const run = await service.runJob(repo.id, sandboxJob.id, 'manual')
      await waitForRun(sandboxJob.id, run.id, { status: 'completed' })

      expect(sessions.update).toHaveBeenCalledWith('ses-run-1', { sandboxed: true, resources: SANDBOX_RESOURCES })
      expect(runtime.planShell).toHaveBeenCalledWith(
        repo.fullPath,
        { rootSessionId: 'ses-run-1', resources: SANDBOX_RESOURCES, locationDirectory: repo.fullPath },
        true,
      )
      const [planOrder] = vi.mocked(runtime.planShell).mock.invocationCallOrder
      const [promptOrder] = vi.mocked(api.session.prompt).mock.invocationCallOrder
      expect(planOrder).toBeLessThan(promptOrder ?? 0)
    })

    it('fails the run without prompting when the sandbox cannot start', async () => {
      const { api, client } = createClient()
      const { sessions, runtime } = createSandboxDeps()
      vi.mocked(runtime.planShell).mockResolvedValue({ mode: 'blocked', reason: '2 sandbox VMs are already running' })
      insertSessionSandboxModeIfAbsent(db, 'ses-run-1', { sandboxed: true, source: 'user', resources: SANDBOX_RESOURCES })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const sandboxJob = seedJob({ sandbox: sandboxJobConfig })

      await expect(service.runJob(repo.id, sandboxJob.id, 'manual')).rejects.toMatchObject({
        status: 502,
        message: 'Sandbox could not start: 2 sandbox VMs are already running',
      })

      const runs = listScheduleRunsByJob(db, repo.id, sandboxJob.id)
      expect(runs[0]).toMatchObject({
        status: 'failed',
        sessionId: 'ses-run-1',
        errorText: 'Sandbox could not start: 2 sandbox VMs are already running',
      })
      expect(api.session.prompt).not.toHaveBeenCalled()
      expect(runtime.removeSessionSandbox).toHaveBeenCalledWith('ses-run-1')
    })

    it('removes the sandbox after a completed run and survives a removal failure', async () => {
      const { client } = createClient({ messages: [assistantMessage('Done.', { completed: true })] })
      const { sessions, runtime } = createSandboxDeps()
      vi.mocked(runtime.removeSessionSandbox).mockRejectedValue(new Error('msb rm failed'))
      insertSessionSandboxModeIfAbsent(db, 'ses-run-1', { sandboxed: true, source: 'user', resources: SANDBOX_RESOURCES })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const sandboxJob = seedJob({ sandbox: sandboxJobConfig })

      const run = await service.runJob(repo.id, sandboxJob.id, 'manual')
      const completed = await waitForRun(sandboxJob.id, run.id, { status: 'completed' })

      expect(completed.status).toBe('completed')
      await vi.waitFor(() => expect(runtime.removeSessionSandbox).toHaveBeenCalledWith('ses-run-1'))
      expect(testLogEntries('warn').map((entry) => entry.message)).toContainEqual(
        expect.stringContaining('Failed to remove the sandbox microVM'),
      )
    })

    it('removes the sandbox of a cancelled run', async () => {
      const { client } = createClient({ messages: [] })
      const { sessions, runtime } = createSandboxDeps()
      insertSessionSandboxModeIfAbsent(db, 'ses-run-3', { sandboxed: true, source: 'user', resources: SANDBOX_RESOURCES })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-3' })

      const cancelled = await service.cancelRun(repo.id, job.id, run.id)

      expect(cancelled).toMatchObject({ status: 'cancelled' })
      expect(runtime.removeSessionSandbox).toHaveBeenCalledWith('ses-run-3')
    })

    it.each([
      ['a sandboxed session', { sandboxed: true, source: 'user' as const }],
      ['a user-disabled session', { sandboxed: false, source: 'user' as const }],
    ])('removes the sandbox of a cancelled run with %s', async (_label, mode) => {
      const { client } = createClient({ messages: [] })
      const { sessions, runtime } = createSandboxDeps()
      insertSessionSandboxModeIfAbsent(db, 'ses-run-4', { ...mode, resources: SANDBOX_RESOURCES })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-4' })

      await service.cancelRun(repo.id, job.id, run.id)

      expect(runtime.removeSessionSandbox).toHaveBeenCalledWith('ses-run-4')
    })

    it('keeps a default-disabled session sandbox untouched', async () => {
      const { client } = createClient({ messages: [] })
      const { sessions, runtime } = createSandboxDeps()
      insertSessionSandboxModeIfAbsent(db, 'ses-run-5', { sandboxed: false, source: 'default', resources: null })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const run = seedRunningRun(job.id)
      updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-run-5' })

      await service.cancelRun(repo.id, job.id, run.id)

      expect(runtime.removeSessionSandbox).not.toHaveBeenCalled()
    })

    it('leaves the sandbox dependencies untouched for a job without an enabled sandbox', async () => {
      const { client } = createClient({ messages: [assistantMessage('Done.', { completed: true })] })
      const { sessions, runtime } = createSandboxDeps()
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const plainJob = seedJob({ sandbox: null })

      const run = await service.runJob(repo.id, plainJob.id, 'manual')
      await waitForRun(plainJob.id, run.id, { status: 'completed' })

      expect(sessions.update).not.toHaveBeenCalled()
      expect(runtime.planShell).not.toHaveBeenCalled()
      expect(runtime.removeSessionSandbox).not.toHaveBeenCalled()
    })

    it('validates sandbox settings when saving a local schedule', async () => {
      const { client } = createClient()
      const { sessions, runtime } = createSandboxDeps()
      const { service } = createService(client, { sandbox: { sessions, runtime } })

      const created = await service.createJob(repo.id, {
        name: 'Sandboxed job',
        enabled: true,
        showInInbox: true,
        scheduleMode: 'interval',
        intervalMinutes: 60,
        prompt: 'Audit the project.',
        sandbox: sandboxJobConfig,
      })

      expect(sessions.assertSandboxRequestAllowed).toHaveBeenCalledWith({ sandboxed: true, resources: SANDBOX_RESOURCES })
      expect(getScheduleJobById(db, repo.id, created.id)?.sandbox).toMatchObject({ enabled: true })
    })

    it('maps a rejected sandbox request to the schedule error status', async () => {
      const { client } = createClient()
      const { sessions, runtime } = createSandboxDeps()
      vi.mocked(sessions.assertSandboxRequestAllowed).mockImplementation(() => {
        throw new SessionSandboxError('Sandboxing is not enabled for this server', 409)
      })
      const { service } = createService(client, { sandbox: { sessions, runtime } })

      await expect(service.updateJob(repo.id, job.id, { sandbox: { enabled: true, resources: null } })).rejects.toMatchObject({
        status: 409,
        message: 'Sandboxing is not enabled for this server',
      })
      expect(getScheduleJobById(db, repo.id, job.id)?.sandbox).toBeNull()
    })

    it('updates a sandboxed schedule without revalidating its stored sandbox config', async () => {
      const { client } = createClient()
      const { sessions, runtime } = createSandboxDeps()
      vi.mocked(sessions.assertSandboxRequestAllowed).mockImplementation(() => {
        throw new SessionSandboxError('Sandboxing is not enabled for this server', 409)
      })
      const { service } = createService(client, { sandbox: { sessions, runtime } })
      const sandboxJob = seedJob({ sandbox: sandboxJobConfig })

      const disabled = await service.updateJob(repo.id, sandboxJob.id, { enabled: false })

      expect(disabled.enabled).toBe(false)
      expect(sessions.assertSandboxRequestAllowed).not.toHaveBeenCalled()
    })
  })
})

describe('ScheduleService startup cancellation', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let job: ScheduleJob

  function createClient(state: Partial<ScheduleApiState> = {}) {
    const stub = createStubScheduleApi(state)
    const catalog = stubLoadedModelCatalog()
    const client = createStubOpenCodeClient({
      api: {
        session: stub.api.session,
        message: stub.api.message,
        skill: stub.api.skill,
        agent: stub.api.agent,
        mcp: stub.api.mcp,
        config: catalog.config,
        model: catalog.model,
      },
    })
    return { api: stub.api, state: stub.state, client, catalog }
  }

  function createService(client: Awaited<ReturnType<typeof createClient>>['client'], worktreeManager = createStubWorktreeManager()) {
    return { service: new ScheduleService(db, client, worktreeManager, null, null, runs), worktreeManager }
  }

  async function waitForRun(runId: number, status: string): Promise<ScheduleRun | null> {
    await vi.waitFor(() => {
      expect(getScheduleRunById(db, repo.id, job.id, runId)?.status).toBe(status)
    }, { timeout: 5000 })
    return getScheduleRunById(db, repo.id, job.id, runId)
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedules-cancel-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project', repoUrl: 'https://github.com/example/sample-project' })
    job = seedScheduleJob(db, repo.id, { ...BASE_JOB, nextRunAt: Date.now() + 3_600_000 })
    runs = new ScheduleRunRegistry()
  })

  afterEach(async () => {
    await settleScheduleRuns(runs, [job.id])
    db.close()
    workspace.restore()
  })

  it('stops a startup cancelled while the model is resolving without creating or prompting a session', async () => {
    const { api, client, catalog } = createClient({ messages: [] })
    const { service } = createService(client)

    type ModelListResult = Awaited<ReturnType<typeof catalog.model.list>>
    const modelListResult: ModelListResult = { location: { directory: repo.fullPath }, data: [modelInfo()] }
    let resolveModels!: (value: ModelListResult) => void
    vi.mocked(catalog.model.list).mockImplementationOnce(
      () => new Promise((resolve) => { resolveModels = resolve }),
    )

    const runPromise = service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(vi.mocked(catalog.model.list)).toHaveBeenCalled())

    const run = listScheduleRunsByJob(db, repo.id, job.id)[0]
    await service.cancelRun(repo.id, job.id, run?.id ?? 0)

    resolveModels(modelListResult)
    await runPromise

    expect(api.session.create).not.toHaveBeenCalled()
    expect(api.session.prompt).not.toHaveBeenCalled()
    expect(await waitForRun(run?.id ?? 0, 'cancelled')).toMatchObject({ status: 'cancelled' })
  })

  it('interrupts a session created concurrently with cancellation and never prompts it', async () => {
    const { api, client } = createClient({ messages: [] })
    const { service } = createService(client)

    let resolveCreate!: (value: SessionInfo) => void
    vi.mocked(api.session.create).mockReturnValueOnce(
      new Promise((resolve) => { resolveCreate = resolve }),
    )

    const runPromise = service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(api.session.create).toHaveBeenCalled())
    const run = listScheduleRunsByJob(db, repo.id, job.id)[0]

    await service.cancelRun(repo.id, job.id, run?.id ?? 0)
    resolveCreate(sessionInfo({ id: 'ses-cancel-race' }))
    await runPromise

    expect(api.session.interrupt).toHaveBeenCalledWith({ sessionID: 'ses-cancel-race' })
    expect(api.session.prompt).not.toHaveBeenCalled()
    expect((await waitForRun(run?.id ?? 0, 'cancelled'))?.sessionId).toBeNull()
  })

  it('tears down a worktree prepared after cancellation instead of leaking it', async () => {
    const { api, client } = createClient({ messages: [] })
    const worktreeManager = createStubWorktreeManager()
    const { service } = createService(client, worktreeManager)
    const worktreePath = path.join(workspace.path, 'worktrees', 'job-1-run-1')

    let resolvePrepare!: (value: { directory: string; worktreePath: string; runBranch: string }) => void
    worktreeManager.prepare.mockReturnValueOnce(
      new Promise((resolve) => { resolvePrepare = resolve }),
    )
    worktreeManager.finalize.mockResolvedValue({ commitHash: 'abc123' })

    const runPromise = service.runJob(repo.id, job.id, 'manual')
    await vi.waitFor(() => expect(worktreeManager.prepare).toHaveBeenCalled())
    const run = listScheduleRunsByJob(db, repo.id, job.id)[0]

    await service.cancelRun(repo.id, job.id, run?.id ?? 0)
    resolvePrepare({ directory: worktreePath, worktreePath, runBranch: 'schedule/1/run-1' })
    await runPromise

    expect(worktreeManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ id: repo.id }),
      expect.objectContaining({ id: job.id }),
      expect.objectContaining({ id: run?.id, worktreePath }),
    )
    expect(getScheduleRunById(db, repo.id, job.id, run?.id ?? 0)).toMatchObject({
      status: 'cancelled',
      commitHash: 'abc123',
    })
    expect(api.session.create).not.toHaveBeenCalled()
  })
})

describe('ScheduleService worktree isolation', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let job: ScheduleJob
  let worktreePath: string

  function createClient(state: Partial<ScheduleApiState> = {}) {
    const stub = createStubScheduleApi(state)
    const catalog = stubLoadedModelCatalog()
    const client = createStubOpenCodeClient({
      api: {
        session: stub.api.session,
        message: stub.api.message,
        skill: stub.api.skill,
        agent: stub.api.agent,
        mcp: stub.api.mcp,
        config: catalog.config,
        model: catalog.model,
      },
    })
    return { api: stub.api, state: stub.state, client }
  }

  function createService(client: Awaited<ReturnType<typeof createClient>>['client']) {
    const worktreeManager = createStubWorktreeManager()
    return { service: new ScheduleService(db, client, worktreeManager, null, null, runs), worktreeManager }
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedules-worktree-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project', repoUrl: 'https://github.com/example/sample-project' })
    job = seedScheduleJob(db, repo.id, {
      ...BASE_JOB,
      nextRunAt: Date.now() + 3_600_000,
      workspaceMode: 'kept-worktree',
    })
    worktreePath = path.join(workspace.path, 'worktrees', `job-${job.id}-run-1`)
    runs = new ScheduleRunRegistry()
  })

  afterEach(async () => {
    await settleScheduleRuns(runs, [job.id])
    db.close()
    workspace.restore()
  })

  it('creates the session in the worktree directory when prepare returns a context', async () => {
    const { api, client } = createClient({ messages: [assistantMessage('Worktree run done.', { completed: true })] })
    const { service, worktreeManager } = createService(client)
    worktreeManager.prepare.mockResolvedValue({
      directory: worktreePath,
      worktreePath,
      runBranch: `schedule/${job.id}/run-1`,
    })

    const run = await service.runJob(repo.id, job.id, 'manual')

    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: worktreePath },
    }))
    const stored = getScheduleRunById(db, repo.id, job.id, run.id)
    expect(stored?.worktreePath).toBe(worktreePath)
    expect(stored?.runBranch).toBe(`schedule/${job.id}/run-1`)
  })

  it('calls finalize and clears worktree_path on completion', async () => {
    const { client } = createClient({ messages: [assistantMessage('Worktree run done.', { completed: true })] })
    const { service, worktreeManager } = createService(client)
    worktreeManager.prepare.mockResolvedValue({
      directory: worktreePath,
      worktreePath,
      runBranch: `schedule/${job.id}/run-1`,
    })
    worktreeManager.finalize.mockResolvedValue({ commitHash: 'def456' })

    const run = await service.runJob(repo.id, job.id, 'manual')

    await vi.waitFor(() => {
      expect(getScheduleRunById(db, repo.id, job.id, run.id)).toMatchObject({
        status: 'completed',
        worktreePath: null,
        commitHash: 'def456',
      })
    })
    expect(worktreeManager.finalize).toHaveBeenCalled()
  })

  it('uses repo.fullPath and does not finalize when prepare returns null', async () => {
    const { api, client } = createClient({ messages: [assistantMessage('Inline run done.', { completed: true })] })
    const { service, worktreeManager } = createService(client)

    const run = await service.runJob(repo.id, job.id, 'manual')

    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: repo.fullPath },
    }))
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.worktreePath).toBeNull()
    expect(worktreeManager.finalize).not.toHaveBeenCalled()
  })

  it('tears down the worktree on cancel', async () => {
    const { client } = createClient({ messages: [] })
    const { service, worktreeManager } = createService(client)
    worktreeManager.finalize.mockResolvedValue({ commitHash: 'ghi789' })
    const run = createScheduleRun(db, {
      jobId: job.id,
      repoId: repo.id,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunWorktree(db, repo.id, job.id, run.id, { worktreePath })

    const cancelled = await service.cancelRun(repo.id, job.id, run.id)

    expect(cancelled).toMatchObject({ status: 'cancelled' })
    expect(worktreeManager.finalize).toHaveBeenCalled()
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.commitHash).toBe('ghi789')
  })

  it('recovery triggers teardown for orphaned runs with a worktree', async () => {
    const { client } = createClient({ messages: [] })
    const { service, worktreeManager } = createService(client)
    worktreeManager.finalize.mockResolvedValue({ commitHash: null })
    const run = createScheduleRun(db, {
      jobId: job.id,
      repoId: repo.id,
      triggerSource: 'schedule',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunWorktree(db, repo.id, job.id, run.id, { worktreePath })
    updateScheduleRun(db, repo.id, job.id, run.id, { status: 'running', finishedAt: 0, sessionId: 'ses-recover-wt' })

    await service.recoverRunningRuns()

    expect(worktreeManager.finalize).toHaveBeenCalled()
    expect(getScheduleRunById(db, repo.id, job.id, run.id)?.worktreePath).toBeNull()
  })

  it('prevents duplicate finalize when another path owns the teardown guard', async () => {
    const { client } = createClient({ messages: [assistantMessage('Already done', { completed: true })] })
    const { service, worktreeManager } = createService(client)
    const run = createScheduleRun(db, {
      jobId: job.id,
      repoId: repo.id,
      triggerSource: 'manual',
      status: 'running',
      startedAt: Date.now(),
      createdAt: Date.now(),
    })
    updateScheduleRunWorktree(db, repo.id, job.id, run.id, { worktreePath })

    await Promise.allSettled([
      service.cancelRun(repo.id, job.id, run.id),
      service.cancelRun(repo.id, job.id, run.id),
    ])

    expect(worktreeManager.finalize.mock.calls.length).toBeLessThanOrEqual(1)
  })
})

describe('ScheduleRunner', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo

  interface RecordedCron {
    pattern: string
    options: CronOptions
    stop: () => void
  }

  function createCronRecorder() {
    const instances: RecordedCron[] = []
    const factory: CronFactory = (pattern, options) => {
      const instance: RecordedCron = { pattern, options, stop: vi.fn() }
      instances.push(instance)
      return { stop: instance.stop, nextRun: () => null }
    }
    return { instances, factory }
  }

  function createService(client: ReturnType<typeof createStubOpenCodeClient>) {
    return new ScheduleService(db, client, createStubWorktreeManager(), null, null, runs)
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedule-runner-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project' })
    runs = new ScheduleRunRegistry()
  })

  afterEach(() => {
    runs = new ScheduleRunRegistry()
    db.close()
    workspace.restore()
  })

  it('registers enabled interval jobs on start and skips disabled ones', async () => {
    seedScheduleJob(db, repo.id, { name: 'Enabled job', intervalMinutes: 60, nextRunAt: Date.now() + 3_600_000 })
    seedScheduleJob(db, repo.id, { name: 'Disabled job', intervalMinutes: 60, enabled: false, nextRunAt: Date.now() + 3_600_000 })
    const { instances, factory } = createCronRecorder()
    const runner = new ScheduleRunner(createService(createStubOpenCodeClient()), factory)

    await runner.start()
    runner.stop()

    expect(instances).toHaveLength(1)
    expect(instances[0]?.pattern).toBe('0 * * * *')
    expect(instances[0]?.options).toEqual(expect.objectContaining({ protect: true }))
  })

  it('registers a cron job with its timezone', async () => {
    seedScheduleJob(db, repo.id, {
      name: 'Cron job',
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
      nextRunAt: Date.now() + 3_600_000,
    })
    const { instances, factory } = createCronRecorder()
    const runner = new ScheduleRunner(createService(createStubOpenCodeClient()), factory)

    await runner.start()
    runner.stop()

    expect(instances).toHaveLength(1)
    expect(instances[0]?.pattern).toBe('0 9 * * *')
    expect(instances[0]?.options).toEqual(expect.objectContaining({ timezone: 'America/New_York', protect: true }))
  })

  it('stops all cron instances on stop', async () => {
    seedScheduleJob(db, repo.id, { name: 'Stop test', intervalMinutes: 30, nextRunAt: Date.now() + 3_600_000 })
    const { instances, factory } = createCronRecorder()
    const runner = new ScheduleRunner(createService(createStubOpenCodeClient()), factory)

    await runner.start()
    runner.stop()

    expect(instances).toHaveLength(1)
    expect(instances[0]?.stop).toHaveBeenCalledTimes(1)
  })

  it('replaces the previous cron instance when a job is re-registered', async () => {
    const seeded = seedScheduleJob(db, repo.id, {
      name: 'Update test',
      intervalMinutes: 60,
      nextRunAt: Date.now() + 3_600_000,
    })
    const { instances, factory } = createCronRecorder()
    const runner = new ScheduleRunner(createService(createStubOpenCodeClient()), factory)

    await runner.start()
    runner.registerJob({ ...seeded, intervalMinutes: 30 })

    expect(instances).toHaveLength(2)
    expect(instances[0]?.stop).toHaveBeenCalledTimes(1)
  })
})

describe('ScheduleService run history cleanup', () => {
  let workspace: TempWorkspace
  let db: Database
  let repo: Repo
  let job: ScheduleJob

  function createService() {
    const worktreeManager = createStubWorktreeManager()
    const service = new ScheduleService(db, createStubOpenCodeClient(), worktreeManager, null, null, runs)
    return { service, worktreeManager }
  }

  function seedRun(
    status: ScheduleRun['status'],
    options: { worktreePath?: string; runBranch?: string; startedAt?: number } = {},
  ): ScheduleRun {
    const run = createScheduleRun(db, {
      jobId: job.id,
      repoId: repo.id,
      triggerSource: 'manual',
      status,
      startedAt: options.startedAt ?? Date.now(),
      createdAt: options.startedAt ?? Date.now(),
    })
    if (options.worktreePath !== undefined) {
      updateScheduleRunWorktree(db, repo.id, job.id, run.id, {
        worktreePath: options.worktreePath,
        runBranch: options.runBranch,
      })
    }
    return run
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-schedule-history-')
    db = createTestDatabase()
    repo = seedRepo(db, { localPath: 'sample-project' })
    job = seedScheduleJob(db, repo.id, { ...BASE_JOB, nextRunAt: Date.now() + 3_600_000 })
    runs = new ScheduleRunRegistry()
  })

  afterEach(async () => {
    await settleScheduleRuns(runs, [job.id])
    db.close()
    workspace.restore()
  })

  it('clearRunHistory prunes finished runs and skips a running run', async () => {
    const completed = seedRun('completed', { startedAt: 3 })
    const running = seedRun('running', { startedAt: 2 })
    const failed = seedRun('failed', { startedAt: 1 })
    const { service, worktreeManager } = createService()

    const result = await service.clearRunHistory(repo.id, job.id)

    expect(result).toEqual({ cleared: 2 })
    expect(worktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({ id: repo.id }),
      expect.objectContaining({ id: job.id }),
      expect.arrayContaining([
        expect.objectContaining({ id: completed.id }),
        expect.objectContaining({ id: failed.id }),
      ]),
      'commit',
    )
    expect(listScheduleRunsByJob(db, repo.id, job.id).map((run) => run.id)).toEqual([running.id])
  })

  it('clearRunHistory forwards the discard worktrees mode to pruneRunArtifacts', async () => {
    seedRun('completed', { worktreePath: '/wt/3', runBranch: 'schedule/7/run-3' })
    const { service, worktreeManager } = createService()

    const result = await service.clearRunHistory(repo.id, job.id, 'discard')

    expect(result).toEqual({ cleared: 1 })
    expect(worktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [expect.objectContaining({ worktreePath: '/wt/3' })],
      'discard',
    )
  })

  it('clearRunHistory is a no-op when only a running run exists', async () => {
    seedRun('running')
    const { service, worktreeManager } = createService()

    await expect(service.clearRunHistory(repo.id, job.id)).resolves.toEqual({ cleared: 0 })
    expect(worktreeManager.pruneRunArtifacts).not.toHaveBeenCalled()
    expect(listScheduleRunsByJob(db, repo.id, job.id)).toHaveLength(1)
  })

  it('deleteRun prunes the run artifacts and deletes the row', async () => {
    const run = seedRun('completed', { worktreePath: '/wt/5', runBranch: 'schedule/7/run-5' })
    const { service, worktreeManager } = createService()

    await service.deleteRun(repo.id, job.id, run.id)

    expect(worktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [{ runBranch: 'schedule/7/run-5', worktreePath: '/wt/5' }],
      'commit',
    )
    expect(getScheduleRunById(db, repo.id, job.id, run.id)).toBeNull()
  })

  it('deleteRun refuses to delete a run in progress', async () => {
    const run = seedRun('running')
    const { service, worktreeManager } = createService()

    await expect(service.deleteRun(repo.id, job.id, run.id)).rejects.toThrow('Cannot delete a run while it is in progress')
    expect(worktreeManager.pruneRunArtifacts).not.toHaveBeenCalled()
    expect(getScheduleRunById(db, repo.id, job.id, run.id)).not.toBeNull()
  })

  it('listWorktrees marks the shared worktree and running run worktrees as in use', () => {
    const sharedPath = getScheduleWorktreePath(job.id, null)
    const runningPath = getScheduleWorktreePath(job.id, 9)
    const idlePath = getScheduleWorktreePath(job.id, 3)
    seedRun('running', { worktreePath: runningPath })
    const { service, worktreeManager } = createService()
    worktreeManager.listWorktrees.mockReturnValue([
      { jobId: job.id, runId: 3, worktreePath: idlePath, branch: `schedule/${job.id}/run-3` },
      { jobId: job.id, runId: null, worktreePath: sharedPath, branch: `schedule/${job.id}/shared` },
      { jobId: job.id, runId: 9, worktreePath: runningPath, branch: `schedule/${job.id}/run-9` },
    ])

    expect(service.listWorktrees(repo.id, job.id)).toEqual([
      { worktreePath: sharedPath, branch: `schedule/${job.id}/shared`, runId: null, inUse: true },
      { worktreePath: runningPath, branch: `schedule/${job.id}/run-9`, runId: 9, inUse: true },
      { worktreePath: idlePath, branch: `schedule/${job.id}/run-3`, runId: 3, inUse: false },
    ])
  })

  it('removeWorktrees releases idle worktrees and clears run references', async () => {
    const idlePath = getScheduleWorktreePath(job.id, 3)
    const runningPath = getScheduleWorktreePath(job.id, 9)
    const idleRun = seedRun('completed', { worktreePath: idlePath })
    seedRun('running', { worktreePath: runningPath })
    const { service, worktreeManager } = createService()
    worktreeManager.listWorktrees.mockReturnValue([
      { jobId: job.id, runId: 3, worktreePath: idlePath, branch: `schedule/${job.id}/run-3` },
      { jobId: job.id, runId: 9, worktreePath: runningPath, branch: `schedule/${job.id}/run-9` },
    ])

    await expect(service.removeWorktrees(repo.id, job.id)).resolves.toEqual({ removed: 1 })

    expect(worktreeManager.releaseWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: repo.id }),
      expect.objectContaining({ id: job.id }),
      idlePath,
    )
    expect(getScheduleRunById(db, repo.id, job.id, idleRun.id)?.worktreePath).toBeNull()

    await expect(service.removeWorktrees(repo.id, job.id, runningPath)).rejects.toThrow('in use by a running run')
    await expect(service.removeWorktrees(repo.id, job.id, '/etc')).rejects.toThrow('Worktree not found')
  })

  it('removeWorktrees removes the terminals of each released worktree', async () => {
    const idlePath = getScheduleWorktreePath(job.id, 3)
    const { service, worktreeManager } = createService()
    worktreeManager.listWorktrees.mockReturnValue([
      { jobId: job.id, runId: 3, worktreePath: idlePath, branch: `schedule/${job.id}/run-3` },
    ])
    const onWorktreeRemoved = vi.fn(async () => undefined)
    service.setWorktreeRemovedHandler(onWorktreeRemoved)

    await expect(service.removeWorktrees(repo.id, job.id)).resolves.toEqual({ removed: 1 })

    expect(onWorktreeRemoved).toHaveBeenCalledWith(idlePath)
  })

  it('deleteJob reserves the job before awaiting worktree removal and releases the reservation', async () => {
    const idlePath = getScheduleWorktreePath(job.id, 3)
    const { service, worktreeManager } = createService()
    worktreeManager.listWorktrees.mockReturnValue([
      { jobId: job.id, runId: 3, worktreePath: idlePath, branch: `schedule/${job.id}/run-3` },
    ])
    let resolveRelease!: () => void
    worktreeManager.releaseWorktree.mockReturnValueOnce(new Promise<void>((resolve) => { resolveRelease = resolve }))
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)

    const deletePromise = service.deleteJob(repo.id, job.id)
    await vi.waitFor(() => expect(worktreeManager.releaseWorktree).toHaveBeenCalled())

    expect(onJobChange).toHaveBeenCalledWith(null, job.id)
    expect(runs.snapshot(job.id)).not.toBeNull()

    resolveRelease()
    await deletePromise

    expect(getScheduleJobById(db, repo.id, job.id)).toBeNull()
    expect(runs.snapshot(job.id)).toBeNull()
  })

  it('re-registers the job and releases the reservation when worktree removal fails', async () => {
    const idlePath = getScheduleWorktreePath(job.id, 3)
    const { service, worktreeManager } = createService()
    worktreeManager.listWorktrees.mockReturnValue([
      { jobId: job.id, runId: 3, worktreePath: idlePath, branch: `schedule/${job.id}/run-3` },
    ])
    worktreeManager.releaseWorktree.mockRejectedValueOnce(new Error('release failed'))
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)

    await expect(service.deleteJob(repo.id, job.id)).rejects.toThrow('Failed to remove worktree')

    expect(onJobChange).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), job.id)
    expect(getScheduleJobById(db, repo.id, job.id)).not.toBeNull()
    expect(runs.snapshot(job.id)).toBeNull()
  })
})
