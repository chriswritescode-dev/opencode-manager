import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleJob, ScheduleRun } from '@opencode-manager/shared/types'
import { buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'

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

describe('ScheduleService permission ruleset in session creation', () => {
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
      sessionId: 'ses-perm-test',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    })
  })

  it('sends default permission ruleset when job.permissionConfig is null', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-1',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/session' && method === 'POST') {
        return jsonResponse({ id: 'ses-perm-1' })
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'POST') {
        return textResponse('')
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'GET') {
        return jsonResponse([{ info: { role: 'assistant', time: { completed: Date.now() } }, parts: [] }])
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    const sessionCall = mocks.forward.mock.calls.find(
      ([req]) => (req as ForwardRequest).path === '/session' && (req as ForwardRequest).method === 'POST',
    )
    expect(sessionCall).toBeDefined()
    const body = JSON.parse((sessionCall![0] as ForwardRequest).body!)
    expect(body.title).toBe('Scheduled: Weekly engineering summary')
    expect(body.agent).toBeUndefined()

    const expectedRules = buildSchedulePermissionRuleset(null)
    expect(body.permission).toEqual(expectedRules)
  })

  it('sends custom permission ruleset when job has custom permissionConfig', async () => {
    const customConfig = { allowExternalDirectory: true, bashDenyPatterns: [] }
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, permissionConfig: customConfig })

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-2',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/session' && method === 'POST') {
        return jsonResponse({ id: 'ses-perm-2' })
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'POST') {
        return textResponse('')
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'GET') {
        return jsonResponse([{ info: { role: 'assistant', time: { completed: Date.now() } }, parts: [] }])
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    const sessionCall = mocks.forward.mock.calls.find(
      ([req]) => (req as ForwardRequest).path === '/session' && (req as ForwardRequest).method === 'POST',
    )
    expect(sessionCall).toBeDefined()
    const body = JSON.parse((sessionCall![0] as ForwardRequest).body!)
    expect(body.title).toBe('Scheduled: Weekly engineering summary')
    expect(body.agent).toBeUndefined()

    const expectedRules = buildSchedulePermissionRuleset(customConfig)
    expect(body.permission).toEqual(expectedRules)
  })

  it('preserves existing fields (title, agent) when permission is added', async () => {
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, agentSlug: 'my-agent' })

    const runWithSession: ScheduleRun = {
      ...baseRun,
      sessionId: 'ses-perm-3',
      sessionTitle: 'Scheduled: Weekly engineering summary',
      logText: 'Run started.',
    }
    mocks.updateScheduleRunMetadata.mockReturnValue(runWithSession)

    routeForward(({ path, method }) => {
      if (path === '/session' && method === 'POST') {
        return jsonResponse({ id: 'ses-perm-3' })
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'POST') {
        return textResponse('')
      }
      if (path.match(/^\/session\/[\w-]+\/message$/) && method === 'GET') {
        return jsonResponse([{ info: { role: 'assistant', time: { completed: Date.now() } }, parts: [] }])
      }
      throw new Error(`Unexpected forward request: ${method} ${path}`)
    })

    const service = new ScheduleService({} as never, createOpenCodeClientStub(), mocks.stubWorktreeManager as never)
    await service.runJob(42, 7, 'manual')

    const sessionCall = mocks.forward.mock.calls.find(
      ([req]) => (req as ForwardRequest).path === '/session' && (req as ForwardRequest).method === 'POST',
    )
    expect(sessionCall).toBeDefined()
    const body = JSON.parse((sessionCall![0] as ForwardRequest).body!)
    expect(body.title).toBe('Scheduled: Weekly engineering summary')
    expect(body.agent).toBe('my-agent')
    expect(body.permission).toBeDefined()
    expect(body.permission['*']).toBe('allow')
  })
})
