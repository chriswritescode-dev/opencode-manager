import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'

const mocks = vi.hoisted(() => ({
  getRepoById: vi.fn(),
  createScheduleJob: vi.fn(),
  createScheduleRun: vi.fn(),
  deleteScheduleJob: vi.fn(),
  getScheduleJobById: vi.fn(),
  getRunningScheduleRunByJob: vi.fn(),
  getScheduleRunById: vi.fn(),
  listDueScheduleJobs: vi.fn(),
  listRunningScheduleRuns: vi.fn(),
  listScheduleJobsByRepo: vi.fn(),
  listScheduleRunsByJob: vi.fn(),
  reserveScheduleJobNextRun: vi.fn(),
  updateScheduleJob: vi.fn(),
  updateScheduleJobRunState: vi.fn(),
  updateScheduleRun: vi.fn(),
  updateScheduleRunMetadata: vi.fn(),
  buildCreateSchedulePersistenceInput: vi.fn(),
  buildUpdatedSchedulePersistenceInput: vi.fn(),
  computeNextRunAtForJob: vi.fn(),
  resolveOpenCodeModel: vi.fn(),
  proxyToOpenCodeWithDirectory: vi.fn(),
  addClient: vi.fn(),
  onEvent: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: mocks.getRepoById,
}))

vi.mock('../../src/db/schedules', () => ({
  createScheduleJob: mocks.createScheduleJob,
  createScheduleRun: mocks.createScheduleRun,
  deleteScheduleJob: mocks.deleteScheduleJob,
  getScheduleJobById: mocks.getScheduleJobById,
  getRunningScheduleRunByJob: mocks.getRunningScheduleRunByJob,
  getScheduleRunById: mocks.getScheduleRunById,
  listDueScheduleJobs: mocks.listDueScheduleJobs,
  listRunningScheduleRuns: mocks.listRunningScheduleRuns,
  listScheduleJobsByRepo: mocks.listScheduleJobsByRepo,
  listScheduleRunsByJob: mocks.listScheduleRunsByJob,
  reserveScheduleJobNextRun: mocks.reserveScheduleJobNextRun,
  updateScheduleJob: mocks.updateScheduleJob,
  updateScheduleJobRunState: mocks.updateScheduleJobRunState,
  updateScheduleRun: mocks.updateScheduleRun,
  updateScheduleRunMetadata: mocks.updateScheduleRunMetadata,
}))

vi.mock('../../src/services/schedule-config', () => ({
  buildCreateSchedulePersistenceInput: mocks.buildCreateSchedulePersistenceInput,
  buildUpdatedSchedulePersistenceInput: mocks.buildUpdatedSchedulePersistenceInput,
  computeNextRunAtForJob: mocks.computeNextRunAtForJob,
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

vi.mock('../../src/services/proxy', () => ({
  proxyToOpenCodeWithDirectory: mocks.proxyToOpenCodeWithDirectory,
}))

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: {
    addClient: mocks.addClient,
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

import { ScheduleRunner, ScheduleService } from '../../src/services/schedules'

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status: number = 200): Response {
  return new Response(body, { status })
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
}

describe('ScheduleService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.get(ScheduleService, 'activeRuns').clear()

    mocks.getRepoById.mockReturnValue(repo)
    mocks.getScheduleJobById.mockReturnValue(job)
    mocks.getRunningScheduleRunByJob.mockReturnValue(null)
    mocks.createScheduleRun.mockReturnValue(baseRun)
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', modelID: 'gpt-5-mini' })
    mocks.addClient.mockReturnValue(vi.fn())
    mocks.onEvent.mockReturnValue(vi.fn())
    mocks.getScheduleRunById.mockReturnValue({
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    })
  })

  it('starts a run immediately and completes it after polling session messages', async () => {
    const service = new ScheduleService({} as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'ses-run-1' }))
      }

      if (path === '/session/ses-run-1/message' && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }

      if (path === '/session/ses-run-1/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            info: { role: 'assistant', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: 'System health is stable.' }],
          },
        ]))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    const result = await service.runJob(42, 7, 'manual')

    expect(result).toEqual(runWithSession)

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

    expect(mocks.updateScheduleJobRunState).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      expect.objectContaining({ nextRunAt: job.nextRunAt }),
    )
  })

  it('completes a run immediately when the prompt endpoint returns JSON', async () => {
    const service = new ScheduleService({} as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-2',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'ses-run-2' }))
      }

      if (path === '/session/ses-run-2/message' && method === 'POST') {
        return Promise.resolve(textResponse(JSON.stringify({
          parts: [{ type: 'text', text: 'Immediate status summary.' }],
        })))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({
          status: 'completed',
          responseText: 'Immediate status summary.',
        }),
      )
    })
  })

  it('rejects a new run when the job already has a running entry', async () => {
    const service = new ScheduleService({} as never)

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
    const service = new ScheduleService({} as never)

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
    const service = new ScheduleService({} as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-6',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'ses-run-6' }))
      }

      if (path === '/session/ses-run-6/message' && method === 'POST') {
        return Promise.resolve(textResponse('Provider unavailable', 500))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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

  it('cancels an in-progress run by aborting the linked session', async () => {
    const service = new ScheduleService({} as never)
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
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-3/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([]))
      }

      if (path === '/session/ses-run-3/abort' && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(cancelledRun)
    expect(mocks.proxyToOpenCodeWithDirectory).toHaveBeenCalledWith(
      '/session/ses-run-3/abort',
      'POST',
      repo.fullPath,
    )
    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({ status: 'cancelled', errorText: 'Run cancelled by user.' }),
    )
  })

  it('rejects cancellation for runs that already finished', async () => {
    const service = new ScheduleService({} as never)

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
    const service = new ScheduleService({} as never)
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
    expect(mocks.proxyToOpenCodeWithDirectory).not.toHaveBeenCalled()
  })

  it('surfaces abort failures when cancellation cannot reach OpenCode', async () => {
    const service = new ScheduleService({} as never)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-7',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-7/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([]))
      }

      if (path === '/session/ses-run-7/abort' && method === 'POST') {
        return Promise.resolve(textResponse('Abort refused', 500))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await expect(service.cancelRun(42, 7, 5)).rejects.toMatchObject({
      message: 'Abort refused',
      status: 502,
    })
  })

  it('marks orphaned idle runs as failed during recovery', async () => {
    const service = new ScheduleService({} as never)
    const orphanedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-4',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      responseText: null,
    }

    mocks.listRunningScheduleRuns.mockReturnValue([orphanedRun])
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-4/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: 'Partial summary' }],
          },
        ]))
      }

      if (path === '/session/status' && method === 'GET') {
        return Promise.resolve(jsonResponse({
          'ses-run-4': { type: 'idle' },
        }))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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
    const service = new ScheduleService({} as never)

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
    const service = new ScheduleService({} as never)
    const completedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-8',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.listRunningScheduleRuns.mockReturnValue([completedRun])
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-8/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            info: { role: 'assistant', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: 'Recovered summary' }],
          },
        ]))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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
    const service = new ScheduleService({} as never)
    const resumedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-9',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }
    let messageRequests = 0

    mocks.listRunningScheduleRuns.mockReturnValue([resumedRun])
    mocks.getScheduleRunById.mockReturnValue(resumedRun)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-9/message' && method === 'GET') {
        messageRequests += 1

        if (messageRequests === 1) {
          return Promise.resolve(jsonResponse([]))
        }

        return Promise.resolve(jsonResponse([
          {
            info: { role: 'assistant', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: 'Recovered after reconnect' }],
          },
        ]))
      }

      if (path === '/session/status' && method === 'GET') {
        return Promise.resolve(jsonResponse({
          'ses-run-9': { type: 'busy' },
        }))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await service.recoverRunningRuns()

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

  it('lists jobs and runs through the persistence layer', () => {
    const service = new ScheduleService({} as never)
    const listedRun = { ...baseRun, status: 'completed', finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0) }

    mocks.listScheduleJobsByRepo.mockReturnValue([job])
    mocks.listScheduleRunsByJob.mockReturnValue([listedRun])

    expect(service.listJobs(42)).toEqual([job])
    expect(service.listRuns(42, 7, 10)).toEqual([listedRun])
    expect(mocks.listScheduleJobsByRepo).toHaveBeenCalledWith(expect.anything(), 42)
    expect(mocks.listScheduleRunsByJob).toHaveBeenCalledWith(expect.anything(), 42, 7, 10)
  })

  it('creates and updates jobs using normalized persistence input', () => {
    const service = new ScheduleService({} as never)
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
    const service = new ScheduleService({} as never)

    mocks.deleteScheduleJob.mockReturnValue(false)
    mocks.getScheduleRunById.mockReturnValue(null)

    expect(() => service.deleteJob(42, 7)).toThrow('Schedule not found')
    expect(() => service.getRun(42, 7, 5)).toThrow('Run not found')
  })

  it('cancels by finalizing the run when the assistant already completed', async () => {
    const service = new ScheduleService({} as never)
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

    mocks.getScheduleRunById.mockReturnValueOnce(runningRun).mockReturnValueOnce(completedRun)
    mocks.proxyToOpenCodeWithDirectory.mockImplementation((path: string, method: string) => {
      if (path === '/session/ses-run-5/message' && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            info: { role: 'assistant', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: 'Completed summary' }],
          },
        ]))
      }

      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(completedRun)
    expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      7,
      5,
      expect.objectContaining({ status: 'completed', responseText: 'Completed summary' }),
    )
  })
})

describe('ScheduleRunner', () => {
  it('recovers interrupted runs and starts due scheduled jobs during a tick', async () => {
    const scheduleService = {
      recoverRunningRuns: vi.fn().mockResolvedValue(undefined),
      listDueJobs: vi.fn().mockReturnValue([{ id: 7, repoId: 42 }]),
      runJob: vi.fn().mockResolvedValue(undefined),
    }
    const runner = new ScheduleRunner(scheduleService as never)

    await (runner as unknown as { tick(): Promise<void> }).tick()

    expect(scheduleService.recoverRunningRuns).toHaveBeenCalled()
    expect(scheduleService.listDueJobs).toHaveBeenCalledWith(expect.any(Number))
    expect(scheduleService.runJob).toHaveBeenCalledWith(42, 7, 'schedule')
  })

  it('ignores overlapping ticks while a previous pass is still running', async () => {
    let resolveRecovery: (() => void) | null = null
    const scheduleService = {
      recoverRunningRuns: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveRecovery = resolve
      })),
      listDueJobs: vi.fn().mockReturnValue([]),
      runJob: vi.fn(),
    }
    const runner = new ScheduleRunner(scheduleService as never)

    const firstTick = (runner as unknown as { tick(): Promise<void> }).tick()
    const secondTick = (runner as unknown as { tick(): Promise<void> }).tick()

    expect(scheduleService.recoverRunningRuns).toHaveBeenCalledTimes(1)

    resolveRecovery?.()

    await firstTick
    await secondTick
  })

  it('starts one interval and stops cleanly', async () => {
    vi.useFakeTimers()

    try {
      const scheduleService = {
        recoverRunningRuns: vi.fn().mockResolvedValue(undefined),
        listDueJobs: vi.fn().mockReturnValue([]),
        runJob: vi.fn(),
      }
      const runner = new ScheduleRunner(scheduleService as never)

      runner.start()
      runner.start()
      await Promise.resolve()

      expect(scheduleService.recoverRunningRuns).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(30_000)
      expect(scheduleService.recoverRunningRuns).toHaveBeenCalledTimes(2)

      runner.stop()
      runner.stop()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(scheduleService.recoverRunningRuns).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
