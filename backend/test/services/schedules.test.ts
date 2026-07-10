import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'

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
  forward: vi.fn(),
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
import type { ForwardRequest, OpenCodeClient } from '../../src/services/opencode/client'

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status: number = 200): Response {
  return new Response(body, { status })
}

function promptReceipt(): Response {
  return jsonResponse({
    data: {
      admittedSeq: 1,
      id: 'msg-1',
      sessionID: 'ses-test',
      delivery: 'steer',
      timeCreated: Math.floor(Date.now() / 1000),
    },
  })
}

function v2Messages(messages: Array<{
  type: string
  id?: string
  content?: Array<{ type: string; text?: string }>
  time?: { created?: number; completed?: number }
  finish?: string
  error?: { name?: string; data?: { message?: string } }
}>): Response {
  return jsonResponse(messages.map(m => ({
    info: {
      id: m.id ?? 'msg-1',
      role: m.type,
      time: m.time,
      error: m.error,
    },
    parts: m.content,
  })))
}

function createOpenCodeClientStub(): OpenCodeClient {
  return {
    forward: mocks.forward,
    forwardRaw: vi.fn(async () => new Response('', { status: 200 })),
    getJson: vi.fn(async () => ({}) as unknown),
    postJson: vi.fn(async () => ({}) as unknown),
    setProviderAuth: vi.fn(async () => true),
    deleteProviderAuth: vi.fn(async () => true),
    startMcpAuth: vi.fn(async () => new Response('', { status: 200 })),
    authenticateMcp: vi.fn(async () => new Response('', { status: 200 })),
  } as OpenCodeClient
}

function routeForward(handler: (req: ForwardRequest) => Promise<Response> | Response) {
  mocks.forward.mockImplementation((req: ForwardRequest) => Promise.resolve(handler(req)))
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
  workspaceId: null,
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
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', modelID: 'gpt-5-mini' })
    mocks.onEvent.mockReturnValue(vi.fn())
    mocks.getScheduleRunById.mockReturnValue({
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    })
  })

  it('starts a run immediately and completes it after polling session messages', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-run-1' } }))
      }

      if (path === `/session/ses-run-1/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }

      if (path.startsWith('/session/ses-run-1/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Stale status.' }], time: { created: 1, completed: 2 }, finish: 'stop' },
          { type: 'assistant', content: [{ type: 'text', text: 'System health is stable.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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

  it('strips thinking blocks from V2 assistant messages', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-think',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-think' } }))
      }
      if (path === `/session/ses-think/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }
      if (path.startsWith('/session/ses-think/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          {
            type: 'assistant',
            content: [{ type: 'text', text: '<think>Let me analyze the system logs...\nThe database connection is healthy.</think>The database connection is healthy.' }],
            time: { created: 1000, completed: 2000 },
            finish: 'stop',
          },
        ]))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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
          responseText: 'The database connection is healthy.',
        }),
      )
    })
  })

  it('sends session and message JSON POSTs with Content-Type: application/json', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-content-type',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-content-type' } })
      }
      if (path === `/session/ses-content-type/message` && method === 'POST') {
        return promptReceipt()
      }
      if (path.startsWith('/session/ses-content-type/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/api/session',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      )
      expect(mocks.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: `/session/ses-content-type/message`,
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      )
    })
  })

  it('proceeds despite title PATCH failure', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-patch-fail',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-patch-fail' } }))
      }

      if (path === `/session/ses-patch-fail/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }

      if (path.startsWith('/session/ses-patch-fail/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Completed despite title issue.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(textResponse('Server Error', 500))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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
          responseText: 'Completed despite title issue.',
          sessionId: 'ses-patch-fail',
        }),
      )
    })
  })

  it('completes a run after prompting the session', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-2',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-run-2' } }))
      }

      if (path === `/session/ses-run-2/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }

      if (path.startsWith('/session/ses-run-2/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Immediate status summary.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-6',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-run-6' } }))
      }

      if (path === `/session/ses-run-6/message` && method === 'POST') {
        return Promise.resolve(textResponse('Provider unavailable', 500))
      }

      if (path.startsWith('/session/ses-run-6/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }

      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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

  it('fails the run when the V2 assistant message carries an error', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-err-v2',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-err-v2' } }))
      }
      if (path === `/session/ses-err-v2/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }
      if (path.startsWith('/session/ses-err-v2/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Partial output' }], error: { name: 'provider_error', data: { message: 'Model crashed' } } },
        ]))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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
          status: 'failed',
          responseText: 'Partial output',
          errorText: 'Model crashed',
        }),
      )
    })
  })

  it('completes when the session stays active longer than RUN_POLL_TIMEOUT_MS', async () => {
    let fakeNow = 1_700_000_000_000
    const RUN_POLL_INTERVAL_MS = 2_000

    vi.stubGlobal('Bun', { sleep: vi.fn(async () => { fakeNow += RUN_POLL_INTERVAL_MS }) })
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

    try {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-active-long',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      let activePolls = 0

      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)
      routeForward(({ path, method }) => {
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-active-long' } }))
        }
        if (path === `/session/ses-active-long/message` && method === 'POST') {
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-active-long/message') && method === 'GET') {
          activePolls++
          if (activePolls <= 155) {
            return Promise.resolve(v2Messages([]))
          }
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Completed after active period' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
          ]))
        }
        if (path === '/api/session/active' && method === 'GET') {
          if (activePolls > 155) {
            return Promise.resolve(jsonResponse({ data: {} }))
          }
          return Promise.resolve(jsonResponse({ data: { 'ses-active-long': { type: 'running' } } }))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
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
            responseText: 'Completed after active period',
          }),
        )
      })
    } finally {
      nowSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('completes when assistant message has time.completed even if session remains in active map', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-completed-still-active',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }

    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)
    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-completed-still-active' } }))
      }
      if (path === `/session/ses-completed-still-active/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }
      if (path.startsWith('/session/ses-completed-still-active/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Completed while still active.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: { 'ses-completed-still-active': { type: 'running' } } }))
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
          responseText: 'Completed while still active.',
          sessionId: 'ses-completed-still-active',
        }),
      )
    })
  })

  it('times out when the session is inactive and never settles', async () => {
    let fakeNow = 1_700_000_000_000
    const RUN_POLL_INTERVAL_MS = 2_000

    vi.stubGlobal('Bun', { sleep: vi.fn(async () => { fakeNow += RUN_POLL_INTERVAL_MS }) })
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

    try {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-timeout',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }

      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)
      routeForward(({ path, method }) => {
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-timeout' } }))
        }
        if (path === `/session/ses-timeout/message` && method === 'POST') {
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-timeout/message') && method === 'GET') {
          return Promise.resolve(v2Messages([]))
        }
        if (path === '/api/session/active' && method === 'GET') {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
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
            status: 'failed',
            errorText: expect.stringContaining('Timed out'),
          }),
        )
      })
    } finally {
      nowSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('cancels an in-progress run by aborting the linked session', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-3/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }

      if (path === `/api/session/ses-run-3/interrupt` && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    const result = await service.cancelRun(42, 7, 5)

    expect(result).toEqual(cancelledRun)
    expect(mocks.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/session/ses-run-3/interrupt`,
        method: 'POST',
      }),
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    expect(mocks.forward).not.toHaveBeenCalled()
  })

  it('surfaces abort failures when cancellation cannot reach OpenCode', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const runningRun: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-run-7',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.getScheduleRunById.mockReturnValue(runningRun)
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-7/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }

      if (path === `/api/session/ses-run-7/interrupt` && method === 'POST') {
        return Promise.resolve(textResponse('Abort refused', 500))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await expect(service.cancelRun(42, 7, 5)).rejects.toMatchObject({
      message: 'Abort refused',
      status: 502,
    })
  })

  it('marks orphaned idle runs as failed during recovery', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const orphanedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-4',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      responseText: null,
    }

    mocks.listRunningScheduleRuns.mockReturnValue([orphanedRun])
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-4/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Partial summary' }] },
        ]))
      }

      if (path === '/api/session/active' && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: {} }))
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const completedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-8',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }

    mocks.listRunningScheduleRuns.mockReturnValue([completedRun])
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-8/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Recovered summary' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const resumedRun: ScheduleRun = {
      ...baseRun,
      triggerSource: 'schedule',
      sessionId: 'ses-run-9',
      sessionTitle: 'Scheduled: Weekly engineering summary',
    }
    let messageRequests = 0
    let assistantSeen = false

    mocks.listRunningScheduleRuns.mockReturnValue([resumedRun])
    mocks.getScheduleRunById.mockReturnValue(resumedRun)
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-9/message') && method === 'GET') {
        messageRequests += 1

        if (messageRequests === 1) {
          return Promise.resolve(v2Messages([]))
        }

        assistantSeen = true
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Recovered after reconnect' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path === '/api/session/active' && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: assistantSeen ? {} : { 'ses-run-9': { type: 'running' } } }))
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const listedRun = { ...baseRun, status: 'completed', finishedAt: Date.UTC(2026, 2, 9, 12, 10, 0) }

    mocks.listScheduleJobsByRepo.mockReturnValue([job])
    mocks.listScheduleRunsByJob.mockReturnValue([listedRun])

    expect(service.listJobs(42)).toEqual([job])
    expect(service.listRuns(42, 7, 10)).toEqual([listedRun])
    expect(mocks.listScheduleJobsByRepo).toHaveBeenCalledWith(expect.anything(), 42)
    expect(mocks.listScheduleRunsByJob).toHaveBeenCalledWith(expect.anything(), 42, 7, 10)
  })

  it('creates and updates jobs using normalized persistence input', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

    mocks.deleteScheduleJob.mockReturnValue(false)
    mocks.getScheduleRunById.mockReturnValue(null)

    expect(() => service.deleteJob(42, 7)).toThrow('Schedule not found')
    expect(() => service.getRun(42, 7, 5)).toThrow('Run not found')
  })

  it('blocks deleteJob when a running run exists in activeRuns', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    Reflect.get(ScheduleService, 'activeRuns').add(7)

    expect(() => service.deleteJob(42, 7)).toThrow('Cannot delete a schedule while it is running. Cancel the run first.')
  })

  it('blocks deleteJob when a running run exists in the database', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    mocks.getRunningScheduleRunByJob.mockReturnValue({ ...baseRun, status: 'running' })

    expect(() => service.deleteJob(42, 7)).toThrow('Cannot delete a schedule while it is running. Cancel the run first.')
  })

  it('blocks prepareRepoDelete when a running run exists in activeRuns', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)
    mocks.listScheduleJobIdsByRepo.mockReturnValue([7, 8])
    Reflect.get(ScheduleService, 'activeRuns').add(7)

    expect(() => service.prepareRepoDelete(42)).toThrow('Cannot delete a repo while a schedule run is in progress. Cancel the run first.')
    expect(onJobChange).not.toHaveBeenCalled()
  })

  it('blocks prepareRepoDelete when a database running run exists', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)
    mocks.listScheduleJobIdsByRepo.mockReturnValue([7, 8])
    mocks.getRunningScheduleRunByJob.mockReturnValue({ ...baseRun, status: 'running' })

    expect(() => service.prepareRepoDelete(42)).toThrow('Cannot delete a repo while a schedule run is in progress. Cancel the run first.')
    expect(onJobChange).not.toHaveBeenCalled()
  })

  it('deleteJob succeeds when no runs are active', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    mocks.deleteScheduleJob.mockReturnValue(true)
    const onJobChange = vi.fn()
    service.setJobChangeHandler(onJobChange)

    service.deleteJob(42, 7)

    expect(mocks.deleteScheduleJob).toHaveBeenCalledWith(expect.anything(), 42, 7)
    expect(onJobChange).toHaveBeenCalledWith(null, 7)
  })

  it('prepares repo deletion by unregistering repo jobs without deleting records', () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-run-5/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Completed summary' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }

      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
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

  describe('skill injection in prompt', () => {
    it('appends skill content to the prompt when skillSlugs are set', async () => {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const jobWithSkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release', 'code-review'], notes: undefined },
      }
      mocks.getScheduleJobById.mockReturnValue(jobWithSkills)

      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-1',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      let capturedPromptBody: string | undefined
      routeForward(({ path, method, body }) => {
        if (path === '/skill' && method === 'GET') {
          return Promise.resolve(jsonResponse([
            { name: 'git-release', description: 'Git release workflow', location: '/path/SKILL.md', content: 'Release instructions here' },
            { name: 'code-review', description: 'Code review workflow', location: '/path/SKILL.md', content: 'Review instructions here' },
          ]))
        }
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-skills-1' } }))
        }
        if (path === `/session/ses-skills-1/message` && method === 'POST') {
          capturedPromptBody = body
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-skills-1/message') && method === 'GET') {
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
          ]))
        }
        if (path === "/api/session/active" && method === "GET") {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        throw new Error(`Unexpected proxy request: ${method} ${path}`)
      })

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(capturedPromptBody).toBeDefined()
      })

      const parsed = JSON.parse(capturedPromptBody!)
      expect(parsed.parts[0].text).toContain('<skill_content name="git-release">')
      expect(parsed.parts[0].text).toContain('<skill_content name="code-review">')
      expect(parsed.parts[0].text).toContain('Release instructions here')
      expect(parsed.parts[0].text).toContain('Review instructions here')
    })

    it('appends skill notes when provided', async () => {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const jobWithSkillsAndNotes: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release'], notes: 'Focus on changelog' },
      }
      mocks.getScheduleJobById.mockReturnValue(jobWithSkillsAndNotes)

      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-2',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      let capturedPromptBody: string | undefined
      routeForward(({ path, method, body }) => {
        if (path === '/skill' && method === 'GET') {
          return Promise.resolve(jsonResponse([
            { name: 'git-release', description: 'Git release workflow', location: '/path/SKILL.md', content: 'Release instructions here' },
          ]))
        }
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-skills-2' } }))
        }
        if (path === `/session/ses-skills-2/message` && method === 'POST') {
          capturedPromptBody = body
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-skills-2/message') && method === 'GET') {
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
          ]))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
        }
        if (path === "/api/session/active" && method === "GET") {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        throw new Error(`Unexpected proxy request: ${method} ${path}`)
      })

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(capturedPromptBody).toBeDefined()
      })

      const parsed = JSON.parse(capturedPromptBody!)
      expect(parsed.parts[0].text).toContain('<skill_content name="git-release">')
      expect(parsed.parts[0].text).toContain('Release instructions here')
      expect(parsed.parts[0].text).toContain('\nSkill notes: Focus on changelog')
    })

    it('does not modify the prompt when skillSlugs is empty', async () => {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const jobWithEmptySkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: [], notes: 'some notes' },
      }
      mocks.getScheduleJobById.mockReturnValue(jobWithEmptySkills)

      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-3',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      let capturedPromptBody: string | undefined
      routeForward(({ path, method, body }) => {
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-skills-3' } }))
        }
        if (path === `/session/ses-skills-3/message` && method === 'POST') {
          capturedPromptBody = body
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-skills-3/message') && method === 'GET') {
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
          ]))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
        }
        if (path === "/api/session/active" && method === "GET") {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        throw new Error(`Unexpected proxy request: ${method} ${path}`)
      })

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(capturedPromptBody).toBeDefined()
      })

      const parsed = JSON.parse(capturedPromptBody!)
      expect(parsed.parts[0].text).toBe(job.prompt)
    })

    it('falls back to name-only injection when skill endpoint fails', async () => {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const jobWithSkills: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['git-release'], notes: undefined },
      }
      mocks.getScheduleJobById.mockReturnValue(jobWithSkills)

      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-4',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      let capturedPromptBody: string | undefined
      routeForward(({ path, method, body }) => {
        if (path === '/skill' && method === 'GET') {
          return Promise.resolve(new Response('error', { status: 500 }))
        }
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-skills-4' } }))
        }
        if (path === `/session/ses-skills-4/message` && method === 'POST') {
          capturedPromptBody = body
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-skills-4/message') && method === 'GET') {
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
          ]))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
        }
        if (path === "/api/session/active" && method === "GET") {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        throw new Error(`Unexpected proxy request: ${method} ${path}`)
      })

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(capturedPromptBody).toBeDefined()
      })

      const parsed = JSON.parse(capturedPromptBody!)
      expect(parsed.parts[0].text).toContain('For this task, use the following skills: git-release')
    })

    it('falls back gracefully when a skill slug is not found in the list', async () => {
      const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
      const jobWithUnknownSkill: ScheduleJob = {
        ...job,
        skillMetadata: { skillSlugs: ['unknown-skill'], notes: undefined },
      }
      mocks.getScheduleJobById.mockReturnValue(jobWithUnknownSkill)

      const runWithSession: ScheduleRun = {
        ...baseRun,
        sessionId: 'ses-skills-5',
        sessionTitle: 'Scheduled: Weekly engineering summary',
        logText: 'Run started. Waiting for assistant response...',
      }
      mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
      mocks.getScheduleRunById.mockReturnValue(runWithSession)

      let capturedPromptBody: string | undefined
      routeForward(({ path, method, body }) => {
        if (path === '/skill' && method === 'GET') {
          return Promise.resolve(jsonResponse([]))
        }
        if (path === '/api/session' && method === 'POST') {
          return Promise.resolve(jsonResponse({ data: { id: 'ses-skills-5' } }))
        }
        if (path === `/session/ses-skills-5/message` && method === 'POST') {
          capturedPromptBody = body
          return Promise.resolve(promptReceipt())
        }
        if (path.startsWith('/session/ses-skills-5/message') && method === 'GET') {
          return Promise.resolve(v2Messages([
            { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
          ]))
        }
        if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
          return Promise.resolve(jsonResponse({}))
        }
        if (path === "/api/session/active" && method === "GET") {
          return Promise.resolve(jsonResponse({ data: {} }))
        }
        throw new Error(`Unexpected proxy request: ${method} ${path}`)
      })

      await service.runJob(42, 7, 'manual')

      await vi.waitFor(() => {
        expect(capturedPromptBody).toBeDefined()
      })

      const parsed = JSON.parse(capturedPromptBody!)
      expect(parsed.parts[0].text).toContain('For this task, use the following skills: unknown-skill')
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

  it('uses worktree directory when prepare returns a context', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    setupWorktreePrepare()

    mocks.updateScheduleRunMetadata.mockReturnValue(worktreeRun)
      mocks.getScheduleRunById.mockReturnValue(worktreeRun)
      routeForward(({ path, method, body }) => {
      if (path === '/api/session' && method === 'POST') {
        const parsed = JSON.parse(body!)
        expect(parsed.location.directory).toBe(worktreePath)
        return Promise.resolve(jsonResponse({ data: { id: 'ses-wt-1' } }))
      }
      if (path === `/session/ses-wt-1/message` && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }
      if (path.startsWith('/session/ses-wt-1/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Worktree run done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    const result = await service.runJob(42, 7, 'manual')

    expect(result.sessionId).toBe('ses-wt-1')
    expect(mocks.updateScheduleRunWorktree).toHaveBeenCalledWith(
      expect.anything(),
      42, 7, 5,
      { worktreePath, runBranch },
    )
  })

  it('calls finalize and clears worktree_path on completion', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { id: 'ses-wt-1' } }))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }
      if (path === `/session/ses-wt-1/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }
      if (path.startsWith('/session/ses-wt-1/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Worktree run done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    // prepare already returns null by default

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-inline-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started. Waiting for assistant response...',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)
    mocks.getScheduleRunById.mockReturnValue(runWithSession)

    let capturedDirectory: string | undefined
    routeForward(({ path, method, body }) => {
      if (path === '/api/session' && method === 'POST') {
        const parsed = JSON.parse(body!)
        capturedDirectory = parsed.location.directory
        return Promise.resolve(jsonResponse({ data: { id: 'ses-inline-1' } }))
      }
      if (path === `/session/ses-inline-1/message` && method === 'POST') {
        return Promise.resolve(promptReceipt())
      }
      if (path.startsWith('/session/ses-inline-1/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Inline run done.' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return Promise.resolve(jsonResponse({}))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await service.runJob(42, 7, 'manual')

    expect(capturedDirectory).toBe(repo.fullPath)
    expect(mocks.updateScheduleRunWorktree).not.toHaveBeenCalled()
    expect(mocks.stubWorktreeManager.finalize).not.toHaveBeenCalled()
  })

  it('tears down worktree on cancel', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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

    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-cancel-wt/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }
      if (path === `/api/session/ses-cancel-wt/interrupt` && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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

    // Session exists but has no completed message — triggers finalizeRecoveredRun
    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-recover-wt/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }
      if (path === '/api/session/active' && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)

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

    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-race-double/message') && method === 'GET') {
        return Promise.resolve(v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Already done' }], time: { created: Math.floor(Date.now() / 1000), completed: Math.floor(Date.now() / 1000) }, finish: 'stop' },
        ]))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

    await service.cancelRun(42, 7, 5)

    // Guard prevented duplicate finalize
    expect(mocks.stubWorktreeManager.finalize).not.toHaveBeenCalled()
    activeTeardowns.delete('42:7:5')
  })

  it('claims and releases the teardown guard around finalize', async () => {
    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    routeForward(({ path, method }) => {
      if (path.startsWith('/session/ses-guard-cycle/message') && method === 'GET') {
        return Promise.resolve(v2Messages([]))
      }
      if (path === `/api/session/ses-guard-cycle/interrupt` && method === 'POST') {
        return Promise.resolve(textResponse(''))
      }
      if (path === "/api/session/active" && method === "GET") {
        return Promise.resolve(jsonResponse({ data: {} }))
      }
      throw new Error(`Unexpected proxy request: ${method} ${path}`)
    })

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

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
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
    return new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
  }

  it('clearRunHistory prunes finished runs and skips a running run', async () => {
    mocks.listScheduleRunArtifactsByJob.mockReturnValue([
      { id: 3, status: 'completed', runBranch: 'schedule/7/run-3', worktreePath: null, workspaceId: null },
      { id: 2, status: 'running', runBranch: 'schedule/7/run-2', worktreePath: '/wt/2', workspaceId: null },
      { id: 1, status: 'failed', runBranch: null, worktreePath: null, workspaceId: null },
    ])
    mocks.deleteScheduleRunsByIds.mockReturnValue(2)

    const result = await makeService().clearRunHistory(42, 7)

    expect(mocks.stubWorktreeManager.pruneRunArtifacts).toHaveBeenCalledWith(repo, [
      { id: 3, status: 'completed', runBranch: 'schedule/7/run-3', worktreePath: null, workspaceId: null },
      { id: 1, status: 'failed', runBranch: null, worktreePath: null, workspaceId: null },
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
      { runBranch: 'schedule/7/run-5', worktreePath: '/wt/5', workspaceId: null },
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
