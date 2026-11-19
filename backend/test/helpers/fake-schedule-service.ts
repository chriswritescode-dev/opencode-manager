import { vi } from 'vitest'
import { ScheduleJobSchema, ScheduleRunSchema, ScheduleWorktreeSchema } from '@opencode-manager/shared/schemas'
import type { ScheduleJob, ScheduleRun, ScheduleWorktree } from '@opencode-manager/shared/types'
import type { ScheduleRoutesService } from '../../src/routes/schedules'
import type { ScheduleService } from '../../src/services/schedules'
import type {
  ScheduleJobWithRepo,
  ScheduleRunWithContext,
  ScheduleRunWithUnreadPreview,
} from '../../src/db/schedules'

export function buildScheduleJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return ScheduleJobSchema.parse({
    id: 7,
    repoId: 42,
    name: 'Nightly audit',
    description: null,
    enabled: true,
    showInInbox: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Audit the project.',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: 'main',
    workspaceMode: 'worktree',
    sandbox: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  })
}

export function buildScheduleJobWithRepo(
  overrides: Partial<ScheduleJobWithRepo & { retainedWorktreeCount: number }> = {},
): ScheduleJobWithRepo & { retainedWorktreeCount: number } {
  return {
    ...buildScheduleJob(),
    repoName: 'Repo A',
    repoPath: '/repos/repo-a',
    repoUrl: 'https://example.test/repo-a.git',
    serverName: null,
    lastRun: null,
    retainedWorktreeCount: 0,
    ...overrides,
  }
}

export function buildScheduleRun(overrides: Partial<ScheduleRun> = {}): ScheduleRun {
  return ScheduleRunSchema.parse({
    id: 5,
    jobId: 7,
    repoId: 42,
    triggerSource: 'manual',
    status: 'completed',
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_001_000,
    viewedAt: null,
    createdAt: 1_700_000_000_000,
    sessionId: 'ses_run',
    sessionTitle: 'Nightly audit',
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: null,
    commitHash: null,
    worktreePath: null,
    ...overrides,
  })
}

export function buildScheduleRunWithContext(
  overrides: Partial<ScheduleRunWithContext> = {},
): ScheduleRunWithContext {
  return {
    ...buildScheduleRun(),
    jobName: 'Nightly audit',
    repoName: 'Repo A',
    repoPath: '/repos/repo-a',
    serverName: null,
    ...overrides,
  }
}

export function buildUnreadScheduleRun(
  overrides: Partial<ScheduleRunWithUnreadPreview> = {},
): ScheduleRunWithUnreadPreview {
  return {
    ...buildScheduleRunWithContext(),
    preview: null,
    ...overrides,
  }
}

export function buildScheduleWorktree(overrides: Partial<ScheduleWorktree> = {}): ScheduleWorktree {
  return ScheduleWorktreeSchema.parse({
    worktreePath: '/repos/repo-a/.worktrees/schedule-7',
    branch: 'schedule-7',
    runId: null,
    inUse: false,
    ...overrides,
  })
}

export function createFakeScheduleService(
  overrides: Partial<ScheduleRoutesService> = {},
): ScheduleRoutesService {
  return {
    cancelRun: vi.fn(async () => buildScheduleRun()),
    cancelServerRun: vi.fn(async () => buildScheduleRun()),
    clearRunHistory: vi.fn(async () => ({ cleared: 0 })),
    clearServerRunHistory: vi.fn(async () => ({ cleared: 0 })),
    countUnreadRuns: vi.fn(() => ({ total: 0, failed: 0 })),
    createJob: vi.fn(async () => buildScheduleJob()),
    createServerJob: vi.fn(async () => buildScheduleJob()),
    deleteJob: vi.fn(async () => undefined),
    deleteRun: vi.fn(async () => undefined),
    deleteServerJob: vi.fn(async () => undefined),
    deleteServerRun: vi.fn(async () => undefined),
    getJob: vi.fn(() => buildScheduleJob()),
    getRun: vi.fn(() => buildScheduleRun()),
    getServerJob: vi.fn(() => buildScheduleJob()),
    getServerRun: vi.fn(() => buildScheduleRun()),
    listAllJobsWithRepos: vi.fn(() => []),
    listAllRuns: vi.fn(() => []),
    listJobs: vi.fn(() => []),
    listRuns: vi.fn(() => []),
    listServerJobs: vi.fn(() => []),
    listServerRuns: vi.fn(() => []),
    listUnreadRuns: vi.fn(() => []),
    listWorktrees: vi.fn(() => []),
    markAllRunsViewed: vi.fn(() => 0),
    markRunViewed: vi.fn(() => false),
    removeWorktrees: vi.fn(async () => ({ removed: 0 })),
    runJob: vi.fn(async () => buildScheduleRun({ status: 'running', finishedAt: null })),
    runServerJob: vi.fn(async () => buildScheduleRun({ status: 'running', finishedAt: null })),
    updateJob: vi.fn(async () => buildScheduleJob()),
    updateServerJob: vi.fn(async () => buildScheduleJob()),
    ...overrides,
  }
}

export type StubWorktreeManager = ConstructorParameters<typeof ScheduleService>[2]

export function createStubWorktreeManager() {
  return {
    prepare: vi.fn<StubWorktreeManager['prepare']>(async () => null),
    finalize: vi.fn<StubWorktreeManager['finalize']>(async () => ({ commitHash: null })),
    pruneRunArtifacts: vi.fn<StubWorktreeManager['pruneRunArtifacts']>(async () => undefined),
    listWorktrees: vi.fn<StubWorktreeManager['listWorktrees']>(() => []),
    releaseWorktree: vi.fn<StubWorktreeManager['releaseWorktree']>(async () => undefined),
  }
}
