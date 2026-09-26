import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  getRepoById: vi.fn(),
  createScheduleJob: vi.fn(),
  createScheduleRun: vi.fn(),
  deleteScheduleJob: vi.fn(),
  deleteScheduleRunById: vi.fn(),
  deleteScheduleRunsByIds: vi.fn(),
  listScheduleRunArtifactsByJob: vi.fn(),
  cleanupOrphanedSchedules: vi.fn(),
  getScheduleJobById: vi.fn(),
  getRunningScheduleRunByJob: vi.fn(),
  getScheduleRunById: vi.fn(),
  listEnabledScheduleJobs: vi.fn(),
  listRunningScheduleRuns: vi.fn(),
  listScheduleJobIdsByRepo: vi.fn(),
  listScheduleJobsByRepo: vi.fn(),
  listScheduleRunsByJob: vi.fn(),
  updateScheduleJob: vi.fn(),
  updateScheduleJobRunState: vi.fn(),
  updateScheduleRun: vi.fn(),
  updateScheduleRunMetadata: vi.fn(),
  buildCreateSchedulePersistenceInput: vi.fn(),
  buildUpdatedSchedulePersistenceInput: vi.fn(),
  computeNextRunAtForJob: vi.fn(),

  resolveOpenCodeModel: vi.fn(),
  onEvent: vi.fn(),
  loggerError: vi.fn(),
  updateScheduleRunWorktree: vi.fn(),
  stubWorktreeManager: {
    prepare: vi.fn().mockResolvedValue(null),
    finalize: vi.fn().mockResolvedValue({ commitHash: null }),
    pruneRunArtifacts: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: mocks.getRepoById,
}))

vi.mock('../../src/db/schedules', () => ({
  createScheduleJob: mocks.createScheduleJob,
  createScheduleRun: mocks.createScheduleRun,
  deleteScheduleJob: mocks.deleteScheduleJob,
  deleteScheduleRunById: mocks.deleteScheduleRunById,
  deleteScheduleRunsByIds: mocks.deleteScheduleRunsByIds,
  listScheduleRunArtifactsByJob: mocks.listScheduleRunArtifactsByJob,
  cleanupOrphanedSchedules: mocks.cleanupOrphanedSchedules,
  getScheduleJobById: mocks.getScheduleJobById,
  getRunningScheduleRunByJob: mocks.getRunningScheduleRunByJob,
  getScheduleRunById: mocks.getScheduleRunById,
  listEnabledScheduleJobs: mocks.listEnabledScheduleJobs,
  listRunningScheduleRuns: mocks.listRunningScheduleRuns,
  listScheduleJobIdsByRepo: mocks.listScheduleJobIdsByRepo,
  listScheduleJobsByRepo: mocks.listScheduleJobsByRepo,
  listScheduleRunsByJob: mocks.listScheduleRunsByJob,
  updateScheduleJob: mocks.updateScheduleJob,
  updateScheduleJobRunState: mocks.updateScheduleJobRunState,
  updateScheduleRun: mocks.updateScheduleRun,
  updateScheduleRunMetadata: mocks.updateScheduleRunMetadata,
  updateScheduleRunWorktree: mocks.updateScheduleRunWorktree,
}))

vi.mock('../../src/services/schedule-config', () => ({
  buildCreateSchedulePersistenceInput: mocks.buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput: mocks.buildUpdatedSchedulePersistenceInput,
  computeNextRunAtForJob: mocks.computeNextRunAtForJob,
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: {
    onEvent: mocks.onEvent,
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockCronStop = vi.fn()
const mockCronInstances: Array<{ callback: () => void; options: Record<string, unknown>; pattern: string; stop: typeof mockCronStop }> = []

vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation((pattern: string, options: Record<string, unknown>, callback: () => void) => {
    const instance = { pattern, options, callback, stop: mockCronStop }
    mockCronInstances.push(instance)
    return instance
  }),
}))

import { ScheduleRunner, ScheduleService } from '../../src/services/schedules'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { assistantMessage, createStubScheduleApi, skill } from '../helpers/stub-schedule-api'

function makeService(api: OpenCodeApi): ScheduleService {
  return new ScheduleService({} as never, createStubOpenCodeClient({ api }), mocks.stubWorktreeManager as never)
}

function sessionIdleEvent(directory: string, sessionID: string) {
  return {
    id: `evt_${sessionID}`,
    created: Date.now(),
    type: 'session.idle',
    location: { directory },
    data: { sessionID },
  }
}

function captureEventListener(): (directory: string, event: unknown) => void {
  return mocks.onEvent.mock.calls[0]?.[0] as (directory: string, event: unknown) => void
}

const repo = {
  id: 42,
  fullPath: '/workspace/repos/sample-project',
  localPath: 'sample-project',
  repoUrl: 'https://github.com/example/sample-project',
}

const job: ScheduleJob = {
  id: 7,
  repoId: 42,
  name: 'Weekly engineering summary',
  description: 'Summarize repo health and recent changes.',
  enabled: true,
  scheduleMode: 'interval',
  intervalMinutes: 60,
  cronExpression: null,
  timezone: null,
  agentSlug: null,
  prompt: 'Review the repository and summarize the current state.',
  model: null,
  skillMetadata: null,
  permissionConfig: null,
  branch: null,
  nextRunAt: Date.UTC(2026, 2, 9, 13, 0, 0),
  lastRunAt: Date.UTC(2026, 2, 9, 12, 0, 0),
  createdAt: Date.UTC(2026, 2, 8, 12, 0, 0),
  updatedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
}

const baseRun: ScheduleRun = {
  id: 5,
  jobId: 7,
  repoId: 42,
  triggerSource: 'manual',
  status: 'running',
  startedAt: Date.UTC(2026, 2, 9, 12, 5, 0),
  finishedAt: null,
  createdAt: Date.UTC(2026, 2, 9, 12, 5, 0),
  sessionId: null,
  sessionTitle: null,
  logText: null,
  responseText: null,
  errorText: null,
  runBranch: null,
  commitHash: null,
  worktreePath: null,
}

describe('ScheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.get(ScheduleService, 'activeRuns').clear()
    Reflect.get(ScheduleService, 'activeTeardowns')?.clear()

    mocks.getRepoById.mockReturnValue(repo)
    mocks.getScheduleJobById.mockReturnValue(job)
    mocks.getRunningScheduleRunByJob.mockReturnValue(null)
    mocks.createScheduleRun.mockReturnValue(baseRun)
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', id: 'gpt-5-mini', model: 'openai/gpt-5-mini' })
    mocks.onEvent.mockReturnValue(vi.fn())
    mocks.getScheduleRunById.mockReturnValue({
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    })
  })

  it('starts a run immediately and completes it from the newest assistant message', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-run-1',
      messages: [assistantMessage('System health is stable.', { completed: true })],
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    const result = await service.runJob(42, 7, 'manual')

    expect(result).toEqual(runWithSession)
    expect(stub.api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: repo.fullPath },
    }))

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'completed',
          responseText: 'System health is stable.',
          sessionId: 'ses-run-1',
        }),
      )
    })

    expect(stub.api.message.list).toHaveBeenCalledWith({
      sessionID: 'ses-run-1',
      order: 'desc',
      limit: 20,
    })

    expect(mocks.updateScheduleJobRunState).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      expect.objectContaining({ nextRunAt: job.nextRunAt }),
    )
  })

  it('strips thinking blocks from the persisted assistant response while joining text items', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-think',
      messages: [assistantMessage('', {
        completed: true,
        content: [
          { type: 'text', text: '\u003cthink\u003eprivate reasoning\u003c/think\u003e\nFinal answer' },
          { type: 'text', text: 'Second paragraph.' },
        ],
      })],
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-think',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'completed',
          responseText: 'Final answer\n\nSecond paragraph.',
        }),
      )
    })
  })

  it('creates the session with the resolved fallback model when the stored job model is gone', async () => {
    mocks.getScheduleJobById.mockReturnValue({ ...job, model: 'openai/retired' })
    mocks.resolveOpenCodeModel.mockResolvedValue({
      providerID: 'openai',
      id: 'gpt-5',
      variant: 'high',
      model: 'openai/gpt-5#high',
    })

    const stub = createStubScheduleApi({
      sessionID: 'ses-fallback-model',
      messages: [assistantMessage('Done.', { completed: true })],
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-fallback-model',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Scheduled: Weekly engineering summary',
        model: { providerID: 'openai', id: 'gpt-5', variant: 'high' },
        location: { directory: repo.fullPath },
      }))
    })

    expect(mocks.resolveOpenCodeModel).toHaveBeenCalledWith(
      expect.anything(),
      repo.fullPath,
      { preferredModel: 'openai/retired' },
    )
  })

  it('submits exactly one session.prompt carrying the job prompt', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-prompt',
      messages: [assistantMessage('Done.', { completed: true })],
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-prompt',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.prompt).toHaveBeenCalledTimes(1)
    })
    expect(stub.api.session.prompt).toHaveBeenCalledWith({
      sessionID: 'ses-prompt',
      text: job.prompt,
    })
  })

  it('submits without holding the request open and completes from the session completion event', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-run-2',
      active: { 'ses-run-2': { type: 'running' } },
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-2',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.active).toHaveBeenCalled()
    })
    expect(mocks.updateScheduleRun).not.toHaveBeenCalled()

    stub.state.active = {}
    stub.state.messages = [assistantMessage('Event driven summary.', { completed: true })]
    captureEventListener()(repo.fullPath, sessionIdleEvent(repo.fullPath, 'ses-run-2'))

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'completed',
          responseText: 'Event driven summary.',
        }),
      )
    })
  })

  it('keeps waiting when an intermediate assistant step completes while the session is still busy', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-multi',
      active: { 'ses-multi': { type: 'running' } },
      messages: [assistantMessage('', { completed: true })],
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-multi',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.active).toHaveBeenCalled()
    })
    expect(mocks.updateScheduleRun).not.toHaveBeenCalled()

    stub.state.active = {}
    stub.state.messages = [assistantMessage('Final answer.', { completed: true })]
    captureEventListener()(repo.fullPath, sessionIdleEvent(repo.fullPath, 'ses-multi'))

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({ status: 'completed', responseText: 'Final answer.' }),
      )
    })
  })

  it('rejects a new run when the job already has a running entry', async () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)

    mocks.getRunningScheduleRunByJob.mockReturnValue({
      ...baseRun,
      sessionId: 'ses-existing',
      sessionTitle: 'Scheduled: Existing run',
    })

    await expect(service.runJob(42, 7, 'manual')).rejects.toMatchObject({
      message: 'Schedule is already running',
      status: 409,
    })
  })

  it('surfaces setup failures when the model cannot be resolved', async () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)

    mocks.resolveOpenCodeModel.mockRejectedValueOnce(new Error('No configured models are available.'))
    mocks.updateScheduleRun.mockReturnValue({
      ...baseRun,
      status: 'failed',
      finishedAt: Date.UTC(2026, 2, 9, 12, 6, 0),
      errorText: 'No configured models are available.',
    })

    await expect(service.runJob(42, 7, 'manual')).rejects.toMatchObject({
      message: 'No configured models are available.',
      status: 500,
    })

    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({
        status: 'failed',
        errorText: 'No configured models are available.',
      }),
    )
  })

  it('marks the run failed when prompt submission is rejected after session creation', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-run-6',
      promptError: new Error('Provider unavailable'),
    })
    const service = makeService(stub.api)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-6',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    const result = await service.runJob(42, 7, 'manual')

    expect(result).toEqual(runWithSession)

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'failed',
          errorText: 'Provider unavailable',
          sessionId: 'ses-run-6',
        }),
      )
    })
  })

  it('cancels an in-progress run by interrupting the linked session', async () => {
    const stub = createStubScheduleApi({ messages: [] })
    const service = makeService(stub.api)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-3',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    const cancelledRun: ScheduleRun = {
      ...runningRun,
      status: 'cancelled',
      finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0),
      errorText: 'Run cancelled by user.',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)
    mocks.updateScheduleRun.mockReturnValue(cancelledRun)

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(cancelledRun)
    expect(stub.api.session.interrupt).toHaveBeenCalledWith({ sessionID: 'ses-run-3' })
    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({ status: 'cancelled', errorText: 'Run cancelled by user.' }),
    )
  })

  it('interrupts a busy session on cancel even when an intermediate assistant message completed', async () => {
    const stub = createStubScheduleApi({
      active: { 'ses-cancel-busy': { type: 'running' } },
      messages: [assistantMessage('Intermediate step.', { completed: true })],
    })
    const service = makeService(stub.api)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-cancel-busy',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }
    const cancelledRun: ScheduleRun = {
      ...runningRun,
      status: 'cancelled',
      finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0),
      errorText: 'Run cancelled by user.',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)
    mocks.updateScheduleRun.mockReturnValue(cancelledRun)

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(cancelledRun)
    expect(stub.api.session.interrupt).toHaveBeenCalledWith({ sessionID: 'ses-cancel-busy' })
    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({ status: 'cancelled', errorText: 'Run cancelled by user.' }),
    )
  })

  it('rejects cancellation for runs that already finished', async () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)

    mocks.getScheduleRunById.mockReturnValue({
      ...baseRun,
      status: 'completed',
      finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0),
      responseText: 'Already done',
    })

    await expect(service.cancelRun(42, 7, 5)).rejects.toMatchObject({
      message: 'Only running schedule runs can be cancelled',
      status: 409,
    })
  })

  it('cancels a running entry without a linked session', async () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: null,
      sessionTitle: null,
    }
    const cancelledRun: ScheduleRun = {
      ...runningRun,
      status: 'cancelled',
      finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0),
      errorText: 'Run cancelled by user.',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)
    mocks.updateScheduleRun.mockReturnValue(cancelledRun)

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(cancelledRun)
    expect(stub.api.session.interrupt).not.toHaveBeenCalled()
  })

  it('surfaces interrupt failures when cancellation cannot reach OpenCode', async () => {
    const stub = createStubScheduleApi({
      messages: [],
      interruptError: new Error('Abort refused'),
    })
    const service = makeService(stub.api)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-7',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)

    await expect(service.cancelRun(42, 7, 5)).rejects.toMatchObject({
      message: 'Abort refused',
      status: 502,
    })
  })

  it('marks orphaned idle runs as failed during recovery', async () => {
    const stub = createStubScheduleApi({ messages: [assistantMessage('Partial summary')] })
    const service = makeService(stub.api)
    const orphanedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-4',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      responseText: null,
    }

    mocks.listRunningScheduleRuns.mockReturnValue([orphanedRun])

    await service.recoverRunningRuns()

    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({
        status: 'failed',
        responseText: 'Partial summary',
        errorText: expect.stringContaining('interrupted before completion'),
      }),
    )
  })

  it('finalizes interrupted runs without a linked session during recovery', async () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)

    mocks.listRunningScheduleRuns.mockReturnValue([
      {
        ...baseRun,
        sessionId: null,
        sessionTitle: null,
      },
    ])

    await service.recoverRunningRuns()

    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({
        status: 'failed',
        errorText: expect.stringContaining('no linked session to recover'),
      }),
    )
  })

  it('completes recoverable runs when the assistant already finished', async () => {
    const stub = createStubScheduleApi({
      messages: [assistantMessage('Recovered summary', { completed: true })],
    })
    const service = makeService(stub.api)
    const completedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-8',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.listRunningScheduleRuns.mockReturnValue([completedRun])

    await service.recoverRunningRuns()

    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({
        status: 'completed',
        responseText: 'Recovered summary',
      }),
    )
  })

  it('resumes recoverable runs when the session is still active', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-run-9',
      active: { 'ses-run-9': { type: 'running' } },
    })
    const service = makeService(stub.api)
    const resumedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-9',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.listRunningScheduleRuns.mockReturnValue([resumedRun])
    mocks.getScheduleRunById.mockReturnValue(resumedRun)

    await service.recoverRunningRuns()

    stub.state.active = {}
    stub.state.messages = [assistantMessage('Recovered after reconnect', { completed: true })]
    captureEventListener()(repo.fullPath, sessionIdleEvent(repo.fullPath, 'ses-run-9'))

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'completed',
          responseText: 'Recovered after reconnect',
          sessionId: 'ses-run-9',
        }),
      )
    })
  })

  it('keeps an active session running during recovery until it goes idle after an intermediate completed step', async () => {
    const worktreePath = '/workspace/worktrees/job-7-run-5'
    const stub = createStubScheduleApi({
      sessionID: 'ses-recover-busy',
      active: { 'ses-recover-busy': { type: 'running' } },
      messages: [assistantMessage('Intermediate step.', { completed: true })],
    })
    const service = makeService(stub.api)
    const busyRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-recover-busy',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      worktreePath,
      runBranch: 'schedule/7/run-5',
    }

    mocks.listRunningScheduleRuns.mockReturnValue([busyRun])
    mocks.getScheduleRunById.mockReturnValue(busyRun)

    await service.recoverRunningRuns()

    expect(mocks.updateScheduleRun).not.toHaveBeenCalled()
    expect(mocks.stubWorktreeManager.finalize).not.toHaveBeenCalled()

    stub.state.active = {}
    stub.state.messages = [assistantMessage('Final answer.', { completed: true })]
    captureEventListener()(worktreePath, sessionIdleEvent(worktreePath, 'ses-recover-busy'))

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({ status: 'completed', responseText: 'Final answer.' }),
      )
    })
    expect(mocks.stubWorktreeManager.finalize).toHaveBeenCalled()
  })

  it('lists jobs and runs through the persistence layer', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const listedRun = { ...baseRun, status: 'completed', finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0) }

    mocks.listScheduleJobsByRepo.mockReturnValue([job])
    mocks.listScheduleRunsByJob.mockReturnValue([listedRun])

    expect(service.listJobs(42)).toEqual([job])
    expect(service.listRuns(42, 7, 10)).toEqual([listedRun])
    expect(mocks.listScheduleJobsByRepo).toHaveBeenCalledWith(expect.anything(), 42)
    expect(mocks.listScheduleRunsByJob).toHaveBeenCalledWith(expect.anything(), 42, 7, 10)
  })

  it('creates and updates jobs using normalized persistence input', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const createdJob = { ...job, id: 8, name: 'Daily release summary' }
    const updatedJob = { ...job, name: 'Updated release summary' }

    mocks.buildCreateSchedulePersistenceInput.mockReturnValue({ name: 'Daily release summary' })
    mocks.createScheduleJob.mockReturnValue(createdJob)
    mocks.buildUpdatedSchedulePersistenceInput.mockReturnValue({ name: 'Updated release summary' })
    mocks.updateScheduleJob.mockReturnValue(updatedJob)

    const createResult = service.createJob(42, {
      name: 'Daily release summary',
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      prompt: 'Summarize release readiness.',
    })
    const updateResult = service.updateJob(42, 7, { name: 'Updated release summary' })

    expect(createResult).toEqual(createdJob)
    expect(updateResult).toEqual(updatedJob)
    expect(mocks.buildCreateSchedulePersistenceInput).toHaveBeenCalled()
    expect(mocks.buildUpdatedSchedulePersistenceInput).toHaveBeenCalledWith(job, { name: 'Updated release summary' })
  })

  it('throws when deleting or loading missing records', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)

    mocks.deleteScheduleJob.mockReturnValue(false)
    mocks.getScheduleRunById.mockReturnValue(null)

    expect(() => service.deleteJob(42, 7)).toThrow('Schedule not found')
    expect(() => service.getRun(42, 7, 5)).toThrow('Run not found')
  })

  it('blocks deleteJob when a running run exists in activeRuns', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    Reflect.get(ScheduleService, 'activeRuns').add(7)

    expect(() => service.deleteJob(42, 7)).toThrow('Cannot delete a schedule while it is running. Cancel the run first.')
  })

  it('blocks deleteJob when a running run exists in the database', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    mocks.getRunningScheduleRunByJob.mockReturnValue({ ...baseRun, status: 'running' })

    expect(() => service.deleteJob(42, 7)).toThrow('Cannot delete a schedule while it is running. Cancel the run first.')
  })

  it('blocks prepareRepoDelete when a running run exists in activeRuns', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)
    mocks.listScheduleJobIdsByRepo.mockReturnValue([7, 8])
    Reflect.get(ScheduleService, 'activeRuns').add(7)

    expect(() => service.prepareRepoDelete(42)).toThrow('Cannot delete a repo while a schedule run is in progress. Cancel the run first.')
    expect(onJobChange).not.toHaveBeenCalled()
  })

  it('blocks prepareRepoDelete when a database running run exists', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)
    mocks.listScheduleJobIdsByRepo.mockReturnValue([7, 8])
    mocks.getRunningScheduleRunByJob.mockReturnValue({ ...baseRun, status: 'running' })

    expect(() => service.prepareRepoDelete(42)).toThrow('Cannot delete a repo while a schedule run is in progress. Cancel the run first.')
    expect(onJobChange).not.toHaveBeenCalled()
  })

  it('deleteJob succeeds when no runs are active', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    mocks.deleteScheduleJob.mockReturnValue(true)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)

    service.deleteJob(42, 7)

    expect(mocks.deleteScheduleJob).toHaveBeenCalledWith(expect.anything(), 42, 7)
    expect(onJobChange).toHaveBeenCalledWith(null, 7)
  })

  it('prepares repo deletion by unregistering repo jobs without deleting records', () => {
    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)
    mocks.listScheduleJobIdsByRepo.mockReturnValue([7, 8])

    service.prepareRepoDelete(42)

    expect(mocks.listScheduleJobIdsByRepo).toHaveBeenCalledWith(expect.anything(), 42)
    expect(onJobChange).toHaveBeenCalledWith(null, 7)
    expect(onJobChange).toHaveBeenCalledWith(null, 8)
    expect(onJobChange).toHaveBeenCalledTimes(2)
  })

  it('cancels by finalizing the run when the assistant already completed', async () => {
    const stub = createStubScheduleApi({
      messages: [assistantMessage('Completed summary', { completed: true })],
    })
    const service = makeService(stub.api)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-5',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }
    const completedRun: ScheduleRun = {
      ...runningRun,
      status: 'completed',
      finishedAt: Date.UTC(2026, 2, 9, 12, 20, 0),
      responseText: 'Completed summary',
    }

    mocks.getScheduleRunById.mockReturnValueOnce(runningRun).mockReturnValueOnce(runningRun).mockReturnValueOnce(completedRun)

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(completedRun)
    expect(stub.api.session.interrupt).not.toHaveBeenCalled()
    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({ status: 'completed', responseText: 'Completed summary' }),
    )
  })

  describe('skill attachments in the prompt', () => {
    it('attaches every registered skill slug as a native skill attachment', async () => {
      const stub = createStubScheduleApi({
        sessionID: 'ses-skills-1',
        skills: [skill('git-release'), skill('code-review')],
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const service = makeService(stub.api)
      const jobWithSkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release', 'code-review'], notes: undefined },
      }
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-1',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      mocks.getScheduleJobById.mockReturnValue(jobWithSkills)
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(stub.api.session.prompt).toHaveBeenCalledWith({
          sessionID: 'ses-skills-1',
          text: job.prompt,
          skills: [{ id: 'git-release' }, { id: 'code-review' }],
        })
      })
      expect(stub.api.skill.list).toHaveBeenCalledWith({ location: { directory: repo.fullPath } })
    })

    it('drops skill slugs that are not registered in the location', async () => {
      const stub = createStubScheduleApi({
        sessionID: 'ses-skills-2',
        skills: [skill('git-release')],
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const service = makeService(stub.api)
      const jobWithUnknownSkill: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release', 'unknown-skill'], notes: undefined },
      }
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-2',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      mocks.getScheduleJobById.mockReturnValue(jobWithUnknownSkill)
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(stub.api.session.prompt).toHaveBeenCalledWith({
          sessionID: 'ses-skills-2',
          text: job.prompt,
          skills: [{ id: 'git-release' }],
        })
      })
    })

    it('omits skill attachments when skillSlugs is empty and carries the skill notes', async () => {
      const stub = createStubScheduleApi({
        sessionID: 'ses-skills-3',
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const service = makeService(stub.api)
      const jobWithEmptySkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: [], notes: 'some notes' },
      }
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-3',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      mocks.getScheduleJobById.mockReturnValue(jobWithEmptySkills)
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(stub.api.session.prompt).toHaveBeenCalledWith({
          sessionID: 'ses-skills-3',
          text: `${job.prompt}\n\nSkill notes: some notes`,
        })
      })
      expect(stub.api.skill.list).not.toHaveBeenCalled()
    })

    it('continues without skill attachments when the skill list fails', async () => {
      const stub = createStubScheduleApi({
        sessionID: 'ses-skills-4',
        skillError: new Error('skill endpoint unavailable'),
        messages: [assistantMessage('Done.', { completed: true })],
      })
      const service = makeService(stub.api)
      const jobWithSkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release'], notes: undefined },
      }
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-4',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      mocks.getScheduleJobById.mockReturnValue(jobWithSkills)
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(stub.api.session.prompt).toHaveBeenCalledWith({
          sessionID: 'ses-skills-4',
          text: job.prompt,
        })
      })
    })
  })
})

describe('ScheduleService worktree isolation', () => {
  const worktreePath = '/workspace/worktrees/job-7-run-5'
  const runBranch = 'schedule/7/run-5'

  function setupWorktreePrepare() {
    mocks.stubWorktreeManager.prepare.mockResolvedValue({
      directory: worktreePath,
      worktreePath,
      runBranch,
    })
  }

  function setupWorktreeFinalize(commitHash: string | null = 'abc123') {
    mocks.stubWorktreeManager.finalize.mockResolvedValue({ commitHash })
  }

  const worktreeRun: ScheduleRun = {
    ...baseRun,
    sessionId: 'ses-wt-1',
    sessionTitle: 'Scheduled: Weekly engineering summary',
    logText: 'Run started. Waiting for assistant response...',
    worktreePath,
    runBranch,
  }

  beforeEach(() => {
    mocks.stubWorktreeManager.prepare.mockReset()
    mocks.stubWorktreeManager.finalize.mockReset()
    mocks.stubWorktreeManager.prepare.mockResolvedValue(null)
    mocks.stubWorktreeManager.finalize.mockResolvedValue({ commitHash: null })
    mocks.updateScheduleRunWorktree.mockClear()
  })

  it('creates the session in the worktree directory when prepare returns a context', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-wt-1',
      messages: [assistantMessage('Worktree run done.', { completed: true })],
    })
    const service = makeService(stub.api)
    setupWorktreePrepare()

    mocks.updateScheduleRunMetadata.mockReturnValue(worktreeRun)
    mocks.getScheduleRunById.mockReturnValue(worktreeRun)

    const result = await service.runJob(42, 7, 'manual')

    expect(result.sessionId).toBe('ses-wt-1')
    expect(stub.api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: worktreePath },
    }))
    expect(mocks.updateScheduleRunWorktree).toHaveBeenCalledWith(
      expect.anything(),
      42, 7, 5,
      { worktreePath, runBranch },
    )
  })

  it('calls finalize and clears worktree_path on completion', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-wt-1',
      messages: [assistantMessage('Worktree run done.', { completed: true })],
    })
    const service = makeService(stub.api)
    setupWorktreePrepare()
    setupWorktreeFinalize('def456')

    // For teardownWorktree to proceed, getScheduleRunById must return a run with worktreePath
    const runWithWorktree: ScheduleRun = {
      ...worktreeRun,
      commitHash: null,
    }
    // After finalize, the updated run should have commitHash but null worktreePath
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithWorktree)
    // Return runWithWorktree for the initial getRun + any teardown check
    // Return runAfterFinalize for the final check after updateScheduleRunWorktree clears it
    mocks.getScheduleRunById.mockReturnValue(runWithWorktree)

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.stubWorktreeManager.finalize).toHaveBeenCalled()
      // After submitPromptAndMonitor completes, teardownWorktree clears worktree_path
      expect(mocks.updateScheduleRunWorktree).toHaveBeenCalledWith(
        expect.anything(),
        42, 7, 5,
        expect.objectContaining({ worktreePath: null, commitHash: 'def456' }),
      )
    })
  })

  it('uses repo.fullPath and does not finalize when prepare returns null (inline)', async () => {
    const stub = createStubScheduleApi({
      sessionID: 'ses-inline-1',
      messages: [assistantMessage('Inline run done.', { completed: true })],
    })
    const service = makeService(stub.api)
    // prepare already returns null by default

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-inline-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    await service.runJob(42, 7, 'manual')

    expect(stub.api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      location: { directory: repo.fullPath },
    }))
    expect(mocks.updateScheduleRunWorktree).not.toHaveBeenCalled()
    expect(mocks.stubWorktreeManager.finalize).not.toHaveBeenCalled()
  })

  it('tears down worktree on cancel', async () => {
    const stub = createStubScheduleApi({ messages: [] })
    const service = makeService(stub.api)

    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-cancel-wt',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      worktreePath,
      runBranch,
    }
    const cancelledRun: ScheduleRun = {
      ...runningRun,
      status: 'cancelled',
      finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0),
      errorText: 'Run cancelled by user.',
      worktreePath,
    }

    // getScheduleRunById is called by: getRun, teardownWorktree (x2: get fresh + final clear), cancelRun's final getRun
    mocks.getScheduleRunById.mockReturnValue(runningRun)
    mocks.updateScheduleRun.mockReturnValue(cancelledRun)

    setupWorktreeFinalize('ghi789')

    await service.cancelRun(42, 7, 5)

    // teardownWorktree fetches fresh run, finalizes, clears worktree_path
    expect(mocks.stubWorktreeManager.finalize).toHaveBeenCalled()
    expect(mocks.updateScheduleRunWorktree).toHaveBeenCalledWith(
      expect.anything(),
      42, 7, 5,
      expect.objectContaining({ worktreePath: null, commitHash: 'ghi789' }),
    )
  })

  it('recovery triggers teardown for orphaned runs with worktree_path', async () => {
    const stub = createStubScheduleApi({ messages: [] })
    const service = makeService(stub.api)

    const orphanedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-recover-wt',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      worktreePath,
      runBranch,
    }

    mocks.listRunningScheduleRuns.mockReturnValue([orphanedRun])
    mocks.getScheduleRunById.mockReturnValue(orphanedRun)

    await service.recoverRunningRuns()

    // finalizeRecoveredRun calls teardownWorktree which calls finalize and clears worktree_path
    expect(mocks.stubWorktreeManager.finalize).toHaveBeenCalled()
    expect(mocks.updateScheduleRunWorktree).toHaveBeenCalledWith(
      expect.anything(),
      42, 7, 5,
      expect.objectContaining({ worktreePath: null }),
    )
  })

  it('prevents duplicate finalize when two paths race to teardown the same worktree', async () => {
    const stub = createStubScheduleApi({
      messages: [assistantMessage('Already done', { completed: true })],
    })
    const service = makeService(stub.api)

    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-race-double',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      worktreePath,
      runBranch,
    }

    // Assistant already completed → cancelRun goes via finalizeRecoveredRun → teardownWorktree
    mocks.getScheduleRunById.mockReturnValue(runningRun)

    // Pre-seed the guard to simulate an in-progress teardown (e.g. from monitor's finally block)
    const activeTeardowns = Reflect.get(ScheduleService, 'activeTeardowns') as Set<string>
    activeTeardowns.add('42:7:5')

    await service.cancelRun(42, 7, 5)

    // Guard prevented duplicate finalize
    expect(mocks.stubWorktreeManager.finalize).not.toHaveBeenCalled()
    activeTeardowns.delete('42:7:5')
  })

  it('claims and releases the teardown guard around finalize', async () => {
    const stub = createStubScheduleApi({ messages: [] })
    const service = makeService(stub.api)
    const activeTeardowns = Reflect.get(ScheduleService, 'activeTeardowns') as Set<string>
    activeTeardowns.clear()

    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-guard-cycle',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      worktreePath,
      runBranch,
    }

    let resolveFinalize!: (value: { commitHash: string | null }) => void
    const finalizeDeferred = new Promise<{ commitHash: string | null }>((resolve) => {
      resolveFinalize = resolve
    })
    let finalizeCalled = false
    mocks.stubWorktreeManager.finalize.mockImplementation(async () => {
      finalizeCalled = true
      return await finalizeDeferred
    })

    mocks.getScheduleRunById.mockReturnValue(runningRun)

    const cancelledRun: ScheduleRun = {
      ...runningRun,
      status: 'cancelled',
    }
    mocks.updateScheduleRun.mockReturnValue(cancelledRun)

    const cancelPromise = service.cancelRun(42, 7, 5)

    // Wait until finalize is called (guard is claimed)
    await vi.waitFor(() => expect(finalizeCalled).toBe(true))
    expect(activeTeardowns.has('42:7:5')).toBe(true)

    // Release
    resolveFinalize!({ commitHash: 'abc123' })
    await cancelPromise

    // Guard should be released
    expect(activeTeardowns.has('42:7:5')).toBe(false)
  })
})

describe('ScheduleRunner', () => {
  beforeEach(() => {
    mockCronInstances.length = 0
    mockCronStop.mockClear()
    mocks.cleanupOrphanedSchedules.mockReturnValue({ orphanedJobs: 0, orphanedRuns: 0 })
  })

  it('recovers running runs and registers all enabled jobs on start', async () => {
    const mockJob: ScheduleJob = {
      id: 1,
      repoId: 10,
      name: 'Test Job',
      description: null,
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Test',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      branch: null,
      nextRunAt: Date.now(),
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.listRunningScheduleRuns.mockReturnValue([])
    mocks.listEnabledScheduleJobs.mockReturnValue([mockJob])

    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runner = new ScheduleRunner(service)
    await runner.start()

    expect(mocks.listRunningScheduleRuns).toHaveBeenCalled()
    expect(mocks.listEnabledScheduleJobs).toHaveBeenCalled()
    expect(mockCronInstances).toHaveLength(1)
    expect(mockCronInstances[0]?.pattern).toBe('0 * * * *')
    expect(mockCronInstances[0]?.options).toEqual(expect.objectContaining({ protect: true }))
  })

  it('registers a cron job with timezone', async () => {
    const mockJob: ScheduleJob = {
      id: 2,
      repoId: 10,
      name: 'Test Cron',
      description: null,
      enabled: true,
      scheduleMode: 'cron',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
      intervalMinutes: null,
      agentSlug: null,
      prompt: 'Test',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      branch: null,
      nextRunAt: Date.now(),
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.listRunningScheduleRuns.mockReturnValue([])
    mocks.listEnabledScheduleJobs.mockReturnValue([mockJob])

    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runner = new ScheduleRunner(service)
    await runner.start()

    expect(mockCronInstances).toHaveLength(1)
    expect(mockCronInstances[0]?.pattern).toBe('0 9 * * *')
    expect(mockCronInstances[0]?.options).toEqual(expect.objectContaining({ timezone: 'America/New_York', protect: true }))
  })

  it('skips disabled jobs', async () => {
    const mockJob: ScheduleJob = {
      id: 3,
      repoId: 10,
      name: 'Disabled Job',
      description: null,
      enabled: false,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Test',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      branch: null,
      nextRunAt: Date.now(),
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.listRunningScheduleRuns.mockReturnValue([])
    mocks.listEnabledScheduleJobs.mockReturnValue([])

    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runner = new ScheduleRunner(service)
    await runner.start()

    runner.registerJob(mockJob)
    expect(mockCronInstances).toHaveLength(0)
  })

  it('stops all cron instances on stop', async () => {
    const mockJob: ScheduleJob = {
      id: 4,
      repoId: 10,
      name: 'Stop Test',
      description: null,
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 30,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Test',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      branch: null,
      nextRunAt: Date.now(),
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.listRunningScheduleRuns.mockReturnValue([])
    mocks.listEnabledScheduleJobs.mockReturnValue([mockJob])

    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runner = new ScheduleRunner(service)
    await runner.start()

    runner.stop()
    expect(mockCronStop).toHaveBeenCalled()
  })

  it('unregisters and re-registers a job on update via onJobChange', async () => {
    const mockJob: ScheduleJob = {
      id: 5,
      repoId: 10,
      name: 'Update Test',
      description: null,
      enabled: true,
      scheduleMode: 'interval',
      intervalMinutes: 60,
      cronExpression: null,
      timezone: null,
      agentSlug: null,
      prompt: 'Test',
      model: null,
      skillMetadata: null,
      permissionConfig: null,
      branch: null,
      nextRunAt: Date.now(),
      lastRunAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mocks.listRunningScheduleRuns.mockReturnValue([])
    mocks.listEnabledScheduleJobs.mockReturnValue([mockJob])

    const stub = createStubScheduleApi()
    const service = makeService(stub.api)
    const runner = new ScheduleRunner(service)
    await runner.start()

    expect(mockCronInstances).toHaveLength(1)

    const updatedJob = { ...mockJob, intervalMinutes: 30 }
    runner.registerJob(updatedJob)

    expect(mockCronStop).toHaveBeenCalled()
    expect(mockCronInstances).toHaveLength(2)
  })
})

describe('ScheduleService run history cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRepoById.mockReturnValue(repo)
    mocks.getScheduleJobById.mockReturnValue(job)
    mocks.stubWorktreeManager.pruneRunArtifacts.mockResolvedValue(undefined)
  })

  function makeService() {
    return new ScheduleService(
      {} as never,
      createStubOpenCodeClient({ api: createStubScheduleApi().api }),
      mocks.stubWorktreeManager as never,
    )
  }

  it('clearRunHistory prunes finished runs and skips a running run', async () => {
    mocks.listScheduleRunArtifactsByJob.mockReturnValue([
      { id: 3, status: 'completed', runBranch: 'schedule/7/run-3', worktreePath: null },
      { id: 2, status: 'running', runBranch: 'schedule/7/run-2', worktreePath: '/wt/2' },
      { id: 1, status: 'failed', runBranch: null, worktreePath: null },
    ])
    mocks.deleteScheduleRunsByIds.mockReturnValue(2)

    const result = await makeService().clearRunHistory(42, 7)

    expect(mocks.stubWorktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(repo, [
      { id: 3, status: 'completed', runBranch: 'schedule/7/run-3', worktreePath: null },
      { id: 1, status: 'failed', runBranch: null, worktreePath: null },
    ])
    expect(mocks.deleteScheduleRunsByIds).toHaveBeenCalledWith({}, 42, 7, [3, 1])
    expect(result).toEqual({ cleared: 2 })
  })

  it('clearRunHistory is a no-op when only a running run exists', async () => {
    mocks.listScheduleRunArtifactsByJob.mockReturnValue([
      { id: 2, status: 'running', runBranch: 'schedule/7/run-2', worktreePath: '/wt/2' },
    ])

    const result = await makeService().clearRunHistory(42, 7)

    expect(mocks.stubWorktreeManager.pruneRunArtifacts).not.toHaveBeenCalled()
    expect(mocks.deleteScheduleRunsByIds).not.toHaveBeenCalled()
    expect(result).toEqual({ cleared: 0 })
  })

  it('deleteRun prunes the run artifacts and deletes the row', async () => {
    mocks.getScheduleRunById.mockReturnValue({ ...baseRun, id: 5, status: 'completed', runBranch: 'schedule/7/run-5', worktreePath: '/wt/5' })
    mocks.deleteScheduleRunById.mockReturnValue(true)

    await makeService().deleteRun(42, 7, 5)

    expect(mocks.stubWorktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(repo, [
      { runBranch: 'schedule/7/run-5', worktreePath: '/wt/5' },
    ])
    expect(mocks.deleteScheduleRunById).toHaveBeenCalledWith({}, 42, 7, 5)
  })

  it('deleteRun refuses to delete a run in progress', async () => {
    mocks.getScheduleRunById.mockReturnValue({ ...baseRun, id: 5, status: 'running' })

    await expect(makeService().deleteRun(42, 7, 5)).rejects.toThrow('Cannot delete a run while it is in progress')
    expect(mocks.stubWorktreeManager.pruneRunArtifacts).not.toHaveBeenCalled()
    expect(mocks.deleteScheduleRunById).not.toHaveBeenCalled()
  })
})
