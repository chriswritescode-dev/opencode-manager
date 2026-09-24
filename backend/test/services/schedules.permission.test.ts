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
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { assistantMessage, createStubScheduleApi } from '../helpers/stub-schedule-api'

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
}

describe('ScheduleService permission ruleset in session creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.get(ScheduleService, 'activeRuns').clear()
    Reflect.get(ScheduleService, 'activeTeardowns')?.clear()

    mocks.getRepoById.mockReturnValue(repo)
    mocks.getRunningScheduleRunByJob.mockReturnValue(null)
    mocks.createScheduleRun.mockReturnValue(baseRun)
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', id: 'gpt-5-mini', model: 'openai/gpt-5-mini' })
    mocks.onEvent.mockReturnValue(vi.fn())
  })

  it('sends the default permission ruleset when job.permissionConfig is null', async () => {
    mocks.getScheduleJobById.mockReturnValue(baseJob)
    mocks.updateScheduleRunMetadata.mockReturnValue({ ...baseRun, sessionId: 'ses-perm-1' })

    const stub = createStubScheduleApi({
      sessionID: 'ses-perm-1',
      messages: [assistantMessage('', { completed: true })],
    })
    const service = new ScheduleService(
      {} as never,
      createStubOpenCodeClient({ api: stub.api }),
      mocks.stubWorktreeManager as never,
    )

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.create).toHaveBeenCalledWith({
        title: 'Scheduled: Weekly engineering summary',
        agent: undefined,
        model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
        location: { directory: repo.fullPath },
        permissions: buildSchedulePermissionRuleset(null),
      })
    })
  })

  it('sends the custom permission ruleset when job.permissionConfig is set', async () => {
    const customConfig = { allowExternalDirectory: true, allowQuestions: true, bashDenyPatterns: [] }
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, permissionConfig: customConfig })
    mocks.updateScheduleRunMetadata.mockReturnValue({ ...baseRun, sessionId: 'ses-perm-2' })

    const stub = createStubScheduleApi({
      sessionID: 'ses-perm-2',
      messages: [assistantMessage('', { completed: true })],
    })
    const service = new ScheduleService(
      {} as never,
      createStubOpenCodeClient({ api: stub.api }),
      mocks.stubWorktreeManager as never,
    )

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.create).toHaveBeenCalledWith({
        title: 'Scheduled: Weekly engineering summary',
        agent: undefined,
        model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
        location: { directory: repo.fullPath },
        permissions: buildSchedulePermissionRuleset(customConfig),
      })
    })
  })

  it('preserves the title and agent alongside the permission ruleset', async () => {
    mocks.getScheduleJobById.mockReturnValue({ ...baseJob, agentSlug: 'my-agent' })
    mocks.updateScheduleRunMetadata.mockReturnValue({ ...baseRun, sessionId: 'ses-perm-3' })

    const stub = createStubScheduleApi({
      sessionID: 'ses-perm-3',
      messages: [assistantMessage('', { completed: true })],
    })
    const service = new ScheduleService(
      {} as never,
      createStubOpenCodeClient({ api: stub.api }),
      mocks.stubWorktreeManager as never,
    )

    await service.runJob(42, 7, 'manual')

    await vi.waitFor(() => {
      expect(stub.api.session.create).toHaveBeenCalledWith({
        title: 'Scheduled: Weekly engineering summary',
        agent: 'my-agent',
        model: { providerID: 'openai', id: 'gpt-5-mini', variant: undefined },
        location: { directory: repo.fullPath },
        permissions: buildSchedulePermissionRuleset(null),
      })
    })
  })
})
