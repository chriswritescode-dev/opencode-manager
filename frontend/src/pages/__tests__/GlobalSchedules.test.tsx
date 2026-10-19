import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GlobalSchedules } from '../GlobalSchedules'

const mocks = vi.hoisted(() => ({
  useAllSchedules: vi.fn(),
  useAllScheduleRuns: vi.fn(),
  useCreateRepoSchedule: vi.fn(),
  useUpdateScheduleTarget: vi.fn(),
  useDeleteScheduleTarget: vi.fn(),
  useRunScheduleTarget: vi.fn(),
  useCancelScheduleTargetRun: vi.fn(),
  useUnreadScheduleRuns: vi.fn(),
  useScheduleUrlState: vi.fn(),
  ScheduleJobsTable: vi.fn(() => null),
  ScheduleRunsTable: vi.fn(() => null),
  ScheduleRunDrawer: vi.fn(() => null),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useAllSchedules: mocks.useAllSchedules,
  useAllScheduleRuns: mocks.useAllScheduleRuns,
  useCreateRepoSchedule: mocks.useCreateRepoSchedule,
  useUpdateScheduleTarget: mocks.useUpdateScheduleTarget,
  useDeleteScheduleTarget: mocks.useDeleteScheduleTarget,
  useRunScheduleTarget: mocks.useRunScheduleTarget,
  useCancelScheduleTargetRun: mocks.useCancelScheduleTargetRun,
  useUnreadScheduleRuns: mocks.useUnreadScheduleRuns,
}))

vi.mock('@/hooks/useScheduleUrlState', () => ({
  useScheduleUrlState: mocks.useScheduleUrlState,
}))

vi.mock('@/components/notifications/ScheduleReportsBell', () => ({
  ScheduleReportsBell: vi.fn(() => null),
}))

vi.mock('@/components/schedules', () => ({
  ScheduleJobDialog: vi.fn(() => null),
  ScheduleJobsTable: mocks.ScheduleJobsTable,
  ScheduleRunsTable: mocks.ScheduleRunsTable,
  ScheduleRunDrawer: mocks.ScheduleRunDrawer,
  ScheduleListToolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PromptsTab: vi.fn(() => null),
  ScheduleRepoSwitcher: ({ name }: { name: string }) => <div>{name}</div>,
}))

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    jobId: 7,
    repoId: 42,
    triggerSource: 'manual',
    status: 'completed',
    startedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    finishedAt: Date.UTC(2026, 2, 9, 12, 5, 0),
    viewedAt: 123,
    createdAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    sessionId: 'ses-1',
    sessionTitle: 'Run title',
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: null,
    commitHash: null,
    worktreePath: null,
    jobName: 'Weekly summary',
    repoName: 'my-repo',
    repoPath: '/home/user/my-repo',
    ...overrides,
  }
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    repoId: 42,
    name: 'Weekly summary',
    description: 'Summarize the week',
    enabled: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Summarize the week',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: null,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    repoName: 'my-repo',
    repoPath: '/home/user/my-repo',
    repoUrl: 'https://example.com/my-repo',
    lastRun: null,
    ...overrides,
  }
}

function createMockScheduleUrlState(overrides: Record<string, unknown> = {}) {
  return {
    scheduleTab: 'runs',
    setScheduleTab: vi.fn(),
    dialog: null,
    promptDialog: null,
    jobId: null,
    runId: null,
    templateId: null,
    openNewJob: vi.fn(),
    openEditJob: vi.fn(),
    openDeleteJob: vi.fn(),
    openNewTemplate: vi.fn(),
    openEditTemplate: vi.fn(),
    openDeleteTemplate: vi.fn(),
    openImportTemplate: vi.fn(),
    closeDialog: vi.fn(),
    closePromptDialog: vi.fn(),
    selectRun: vi.fn(),
    selectJobAndView: vi.fn(),
    selectJobAndCloseDialog: vi.fn(),
    replaceUrlParams: vi.fn(),
    ...overrides,
  }
}

let mainRunsResult: { data: unknown; isLoading: boolean; isError?: boolean }
let selectedRunResult: { data: unknown; isLoading: boolean; isError?: boolean; refetch?: () => void }

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const renderGlobalSchedules = () => {
  return render(
    <MemoryRouter initialEntries={['/schedules']}>
      <GlobalSchedules />
    </MemoryRouter>,
    { wrapper: createWrapper() }
  )
}

const runsTableProps = () => mocks.ScheduleRunsTable.mock.calls.at(-1)?.[0] as {
  runs: Array<{ id: number }>
  selectedRunId: number | null
}

const drawerProps = () => mocks.ScheduleRunDrawer.mock.calls.at(-1)?.[0] as {
  run: { id: number } | null
  open: boolean
  runLoading: boolean
  runError: boolean
  onRetry?: () => void
  onClose: () => void
}

const jobsTableProps = () => mocks.ScheduleJobsTable.mock.calls.at(-1)?.[0] as {
  onOpen: (job: unknown) => void
}

describe('GlobalSchedules run history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mainRunsResult = { data: [], isLoading: false }
    selectedRunResult = { data: undefined, isLoading: false, isError: false }

    mocks.useAllScheduleRuns.mockImplementation((params: { limit?: number }) =>
      params.limit === 1 ? selectedRunResult : mainRunsResult
    )
    mocks.useAllSchedules.mockReturnValue({ data: [], isLoading: false, error: null })
    mocks.useCreateRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useUpdateScheduleTarget.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useDeleteScheduleTarget.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useRunScheduleTarget.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCancelScheduleTargetRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useUnreadScheduleRuns.mockReturnValue({ data: { runs: [], total: 0, failed: 0 } })
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState())
  })

  it('loads and pins a selected run outside the loaded history', () => {
    const historyRuns = Array.from({ length: 50 }, (_, index) => makeRun({ id: index + 1, sessionTitle: `Run ${index + 1}` }))
    mainRunsResult = { data: historyRuns, isLoading: false }
    selectedRunResult = { data: [makeRun({ id: 999, sessionTitle: 'Deep linked run' })], isLoading: false, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    renderGlobalSchedules()

    expect(mocks.useAllScheduleRuns).toHaveBeenCalledWith({ limit: 1, runId: 999 }, true)
    const props = runsTableProps()
    expect(props.selectedRunId).toBe(999)
    expect(props.runs.some((run) => run.id === 999)).toBe(true)
    expect(drawerProps().run?.id).toBe(999)
  })

  it('does not duplicate a selected run already present in history', () => {
    mainRunsResult = { data: [makeRun({ id: 5 }), makeRun({ id: 6 })], isLoading: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 5 }))

    renderGlobalSchedules()

    expect(mocks.useAllScheduleRuns).toHaveBeenCalledWith({ limit: 1, runId: 5 }, false)
    const props = runsTableProps()
    expect(props.runs.filter((run) => run.id === 5)).toHaveLength(1)
  })

  it('reports loading through the drawer while the selected run lookup is pending', () => {
    selectedRunResult = { data: undefined, isLoading: true, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    renderGlobalSchedules()

    expect(drawerProps().runLoading).toBe(true)
    expect(drawerProps().run).toBeNull()
    expect(mocks.ScheduleRunsTable).toHaveBeenCalled()
  })

  it('reports not found through the drawer when the selected run lookup returns empty', () => {
    selectedRunResult = { data: [], isLoading: false, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    renderGlobalSchedules()

    expect(drawerProps().run).toBeNull()
    expect(drawerProps().runLoading).toBe(false)
    expect(drawerProps().runError).toBe(false)
    expect(mocks.ScheduleRunsTable).toHaveBeenCalled()
  })

  it('reports an error with a retry through the drawer when the lookup fails', () => {
    const refetch = vi.fn()
    selectedRunResult = { data: undefined, isLoading: false, isError: true, refetch }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    renderGlobalSchedules()

    expect(drawerProps().runError).toBe(true)

    drawerProps().onRetry?.()
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders the cached selected run when a background refetch fails', () => {
    selectedRunResult = { data: [makeRun({ id: 999, sessionTitle: 'Deep linked run' })], isLoading: false, isError: true }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    renderGlobalSchedules()

    expect(drawerProps().runError).toBe(false)
    expect(drawerProps().run?.id).toBe(999)
    const props = runsTableProps()
    expect(props.selectedRunId).toBe(999)
    expect(props.runs.filter((run) => run.id === 999)).toHaveLength(1)
  })

  it('re-queries when the selected run id changes', () => {
    mainRunsResult = { data: [], isLoading: false }
    selectedRunResult = { data: [makeRun({ id: 999 })], isLoading: false, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    const { rerender } = renderGlobalSchedules()

    expect(mocks.useAllScheduleRuns).toHaveBeenCalledWith({ limit: 1, runId: 999 }, true)

    selectedRunResult = { data: [makeRun({ id: 1000 })], isLoading: false, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 1000 }))

    rerender(
      <MemoryRouter initialEntries={['/schedules']}>
        <GlobalSchedules />
      </MemoryRouter>
    )

    expect(mocks.useAllScheduleRuns).toHaveBeenCalledWith({ limit: 1, runId: 1000 }, true)
    expect(runsTableProps().runs.some((run) => run.id === 1000)).toBe(true)
  })

  it('ignores cached selected run data when the selection is cleared', () => {
    mainRunsResult = { data: [], isLoading: false }
    selectedRunResult = { data: [makeRun({ id: 999, sessionTitle: 'Deep linked run' })], isLoading: false, isError: false }
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: 999 }))

    const { rerender } = renderGlobalSchedules()

    expect(runsTableProps().runs.some((run) => run.id === 999)).toBe(true)

    mocks.ScheduleRunsTable.mockClear()
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'runs', runId: null }))

    rerender(
      <MemoryRouter initialEntries={['/schedules']}>
        <GlobalSchedules />
      </MemoryRouter>
    )

    expect(drawerProps().open).toBe(false)
    expect(runsTableProps().runs.some((run) => run.id === 999)).toBe(false)
  })

  it('queries the selected run on the jobs tab as well', () => {
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'jobs', runId: 999 }))

    renderGlobalSchedules()

    expect(mocks.useAllScheduleRuns).toHaveBeenCalledWith({ limit: 1, runId: 999 }, true)
  })

  it('opens the report drawer from a job row that has a last run', () => {
    const selectRun = vi.fn()
    mocks.useAllSchedules.mockReturnValue({
      data: [makeJob({ lastRun: { id: 5, status: 'completed', startedAt: 0, finishedAt: 1, viewedAt: 1, preview: null } })],
      isLoading: false,
      error: null,
    })
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'jobs', runId: null, selectRun }))

    renderGlobalSchedules()

    jobsTableProps().onOpen(makeJob({ lastRun: { id: 5 } }))

    expect(selectRun).toHaveBeenCalledWith(5)
  })

  it('keeps the jobs tab visible with the empty state when there are no jobs', () => {
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({ scheduleTab: 'jobs', runId: null }))

    renderGlobalSchedules()

    expect(screen.getByText('No schedules yet')).toBeInTheDocument()
  })
})
