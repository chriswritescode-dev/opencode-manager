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
  loggerWarn: vi.fn(),
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
    error: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
  },
}))

const mockCronStop = vi.fn()

vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation(() => ({ stop: mockCronStop })),
}))

import { ScheduleService } from '../../src/services/schedules'
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
  return jsonResponse({ data: messages.map(m => ({ ...m, id: m.id ?? 'msg-1' })), cursor: {} })
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

const baseJob: ScheduleJob = {
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

describe('ScheduleService permission auto-responder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.get(ScheduleService, 'activeRuns').clear()
    Reflect.get(ScheduleService, 'activeTeardowns')?.clear()

    mocks.getRepoById.mockReturnValue(repo)
    mocks.getRunningScheduleRunByJob.mockReturnValue(null)
    mocks.createScheduleRun.mockReturnValue(baseRun)
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', modelID: 'gpt-5-mini' })
    mocks.onEvent.mockReturnValue(vi.fn())
    mocks.getScheduleRunById.mockReturnValue({
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    })
  })

  it('denies dangerous bash command with default permission config', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [{ id: 'perm-1', action: 'bash', resources: ['sudo rm -rf /'] }] })
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      const replyCall = mocks.forward.mock.calls.find(
        ([req]) => (req as ForwardRequest).path === `/api/session/ses-perm-auto/permission/perm-1/reply`
          && (req as ForwardRequest).method === 'POST',
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse((replyCall![0] as ForwardRequest).body!)
      expect(body).toEqual({ reply: 'reject', message: 'Denied by schedule permission config' })
    })

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({ status: 'completed' }),
      )
    })
  })

  it('auto-approves benign bash command with reply: once', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [{ id: 'perm-2', action: 'bash', resources: ['git status'] }] })
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      const replyCall = mocks.forward.mock.calls.find(
        ([req]) => (req as ForwardRequest).path === `/api/session/ses-perm-auto/permission/perm-2/reply`
          && (req as ForwardRequest).method === 'POST',
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse((replyCall![0] as ForwardRequest).body!)
      expect(body).toEqual({ reply: 'once' })
    })
  })

  it('rejects external_directory with allowExternalDirectory: false', async () => {
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, permissionConfig: { allowExternalDirectory: false, bashDenyPatterns: [] } })

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [{ id: 'perm-3', action: 'external_directory', resources: ['/etc'] }] })
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      const replyCall = mocks.forward.mock.calls.find(
        ([req]) => (req as ForwardRequest).path === `/api/session/ses-perm-auto/permission/perm-3/reply`
          && (req as ForwardRequest).method === 'POST',
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse((replyCall![0] as ForwardRequest).body!)
      expect(body).toEqual({ reply: 'reject', message: 'Denied by schedule permission config' })
    })
  })

  it('approves external_directory with allowExternalDirectory: true', async () => {
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, permissionConfig: { allowExternalDirectory: true, bashDenyPatterns: [] } })

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [{ id: 'perm-4', action: 'external_directory', resources: ['/some/path'] }] })
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      const replyCall = mocks.forward.mock.calls.find(
        ([req]) => (req as ForwardRequest).path === `/api/session/ses-perm-auto/permission/perm-4/reply`
          && (req as ForwardRequest).method === 'POST',
      )
      expect(replyCall).toBeDefined()
      const body = JSON.parse((replyCall![0] as ForwardRequest).body!)
      expect(body).toEqual({ reply: 'once' })
    })
  })

  it('rejects pending questions', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [{ id: 'q-1' }] })
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.forward).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: `/api/session/ses-perm-auto/question/q-1/reject`,
        }),
      )
    })
  })

  it('completes the run despite permission endpoint returning 500', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return textResponse('Internal Server Error', 500)
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return textResponse('Internal Server Error', 500)
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(mocks.updateScheduleRun).toHaveBeenCalledWith(
        expect.anything(),
        42,
        7,
        5,
        expect.objectContaining({ status: 'completed' }),
      )
    })
  })

  it('handles individual permission reply failure without affecting other replies', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-auto',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    let replyCount = 0
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/api/session' && method === 'POST') {
        return jsonResponse({ data: { id: 'ses-perm-auto' } })
      }
      if (path === `/api/session/ses-perm-auto/prompt` && method === 'POST') {
        return promptReceipt()
      }
      if (path === `/api/session/ses-perm-auto/permission` && method === 'GET') {
        return jsonResponse({ data: [
          { id: 'perm-ok', action: 'bash', resources: ['git status'] },
          { id: 'perm-fail', action: 'bash', resources: ['sudo rm -rf /'] },
        ]})
      }
      if (path === `/api/session/ses-perm-auto/question` && method === 'GET') {
        return jsonResponse({ data: [] })
      }
      if (path.match(/^\/api\/session\/ses-perm-auto\/permission\/[\w-]+\/reply$/) && method === 'POST') {
        replyCount++
        return jsonResponse({})
      }
      if (path.startsWith('/api/session/ses-perm-auto/message') && method === 'GET') {
        return v2Messages([
          { type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 1000, completed: 2000 }, finish: 'stop' },
        ])
      }
      if (path === '/api/session/active' && method === 'GET') {
        return jsonResponse({ data: {} })
      }
      if (path.match(/^\/session\/[\w-]+$/) && method === 'PATCH') {
        return jsonResponse({})
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(replyCount).toBe(2)
    })
  })
})
