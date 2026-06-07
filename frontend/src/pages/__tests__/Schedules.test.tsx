import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Schedules } from '../Schedules'

const mocks = vi.hoisted(() => ({
  useScheduleTarget: vi.fn(),
  useRepoSchedules: vi.fn(),
  useRepoSchedule: vi.fn(),
  useRepoScheduleRuns: vi.fn(),
  useRepoScheduleRun: vi.fn(),
  useCreateRepoSchedule: vi.fn(),
  useUpdateRepoSchedule: vi.fn(),
  useDeleteRepoSchedule: vi.fn(),
  useRunRepoSchedule: vi.fn(),
  useCancelRepoScheduleRun: vi.fn(),
  useRepoActivity: vi.fn(),
  useScheduleUrlState: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal('react-router-dom')),
  useNavigate: () => mockNavigate,
}))

vi.mock('@/hooks/useScheduleTarget', () => ({
  useScheduleTarget: mocks.useScheduleTarget,
}))

vi.mock('@/hooks/useSchedules', () => ({
  useRepoSchedules: mocks.useRepoSchedules,
  useRepoSchedule: mocks.useRepoSchedule,
  useRepoScheduleRuns: mocks.useRepoScheduleRuns,
  useRepoScheduleRun: mocks.useRepoScheduleRun,
  useCreateRepoSchedule: mocks.useCreateRepoSchedule,
  useUpdateRepoSchedule: mocks.useUpdateRepoSchedule,
  useDeleteRepoSchedule: mocks.useDeleteRepoSchedule,
  useRunRepoSchedule: mocks.useRunRepoSchedule,
  useCancelRepoScheduleRun: mocks.useCancelRepoScheduleRun,
}))

vi.mock('@/hooks/useRepoActivity', () => ({
  useRepoActivity: mocks.useRepoActivity,
}))

vi.mock('@/hooks/useScheduleUrlState', () => ({
  useScheduleUrlState: mocks.useScheduleUrlState,
}))

vi.mock('@/components/schedules', () => ({
  ScheduleJobDialog: vi.fn(({ onOpenChange }) => (
    <div>
      ScheduleJobDialog
      <button onClick={() => onOpenChange(false)} data-testid="close-job-dialog">Close</button>
    </div>
  )),
  JobsTab: vi.fn(({ onSelectJob }) => (
    <div>
      <button onClick={() => onSelectJob(123)} data-testid="select-job">Select Job</button>
    </div>
  )),
  JobDetailTab: vi.fn(({ onEdit, onDelete, onRunNow }) => (
    <div>
      <button onClick={onRunNow} data-testid="run-now">Run Now</button>
      <button onClick={() => onEdit({ id: 123 })} data-testid="edit-job">Edit Job</button>
      <button onClick={() => onDelete(123)} data-testid="delete-job">Delete Job</button>
    </div>
  )),
  RunHistoryTab: vi.fn(() => <div>RunHistoryTab</div>),
  ScheduleTabMenu: vi.fn(() => <div>ScheduleTabMenu</div>),
}))

function createMockScheduleUrlState(overrides: Record<string, unknown> = {}) {
  return {
    scheduleTab: 'jobs',
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

const renderSchedules = (repoId: string, initialEntry = `/repos/${repoId}/schedules`) => {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/repos/:id/schedules" element={<Schedules />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createWrapper() }
  )
}

describe('Schedules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState())
    mocks.useCreateRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useUpdateRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useDeleteRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useRunRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCancelRepoScheduleRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  describe('assistant schedule target (repoId=0)', () => {
    it('renders assistant title and subtitle', () => {
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 0,
          kind: 'assistant',
          name: 'Assistant',
          subtitle: 'Built-in assistant',
          fullPath: '/abs/assistant',
          backHref: '/assistant',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('0')

      expect(screen.getByText('Assistant')).toBeInTheDocument()
      expect(screen.getByText('Built-in assistant')).toBeInTheDocument()
    })

    it('does not render Repository not found', () => {
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 0,
          kind: 'assistant',
          name: 'Assistant',
          subtitle: 'Built-in assistant',
          fullPath: '/abs/assistant',
          backHref: '/assistant',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('0')

      expect(screen.queryByText('Repository not found')).not.toBeInTheDocument()
    })

    it('renders back button with correct href', () => {
      mockNavigate.mockClear()

      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 0,
          kind: 'assistant',
          name: 'Assistant',
          subtitle: 'Built-in assistant',
          fullPath: '/abs/assistant',
          backHref: '/assistant',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('0')

      const backButton = screen.getAllByRole('button')[0]
      expect(backButton).toBeInTheDocument()
      fireEvent.click(backButton)
      expect(mockNavigate).toHaveBeenCalledWith('/assistant')
    })

    it('calls runMutation with repoId=0 when Run Now is clicked', () => {
      const mutateMock = vi.fn()
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 0,
          kind: 'assistant',
          name: 'Assistant',
          subtitle: 'Built-in assistant',
          fullPath: '/abs/assistant',
          backHref: '/assistant',
        },
        isLoading: false,
        isError: false,
      })
      const mockJob = {
        id: 123,
        name: 'Test Job',
        repoId: 0,
        cronExpression: null,
        intervalMinutes: 30,
        timezone: 'UTC',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        scheduleMode: 'interval' as const,
        agentSlug: null,
        prompt: 'test',
        triggerSource: 'manual' as const,
        lastRunAt: null,
        nextRunAt: null,
        skillMetadata: null,
      }
      mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({
        scheduleTab: 'detail',
      }))
      mocks.useRepoSchedules.mockReturnValue({ data: [mockJob], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: mockJob, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })
      mocks.useRunRepoSchedule.mockReturnValue({ mutate: mutateMock, isPending: false })

      renderSchedules('0')

      const runNowButton = screen.getByTestId('run-now')
      runNowButton.click()

      expect(mutateMock).toHaveBeenCalledWith({ repoId: 0, jobId: 123 }, expect.any(Object))
    })
  })

  describe('repo schedule target (repoId=5)', () => {
    it('renders repo name and subtitle', () => {
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5')

      expect(screen.getByText('my-repo')).toBeInTheDocument()
      expect(screen.getByText('repos/my-repo')).toBeInTheDocument()
    })

    it('renders back button with correct href', () => {
      mockNavigate.mockClear()

      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5')

      const backButton = screen.getAllByRole('button')[0]
      expect(backButton).toBeInTheDocument()
      fireEvent.click(backButton)
      expect(mockNavigate).toHaveBeenCalledWith('/repos/5')
    })

    it('uses returnTo param for back button when present', () => {
      mockNavigate.mockClear()

      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5', '/repos/5/schedules?returnTo=%2Frepos%2F5%2Fsessions%2Fabc%3Fassistant%3D1')

      fireEvent.click(screen.getAllByRole('button')[0])

      expect(mockNavigate).toHaveBeenCalledWith('/repos/5/sessions/abc?assistant=1')
    })

    it('normalizes prompts tab to jobs when jobs exist', () => {
      const setScheduleTab = vi.fn()
      mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({
        scheduleTab: 'prompts',
        jobId: 123,
        setScheduleTab,
      }))
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      const mockJob = {
        id: 123,
        name: 'Test Job',
        repoId: 5,
        cronExpression: null,
        intervalMinutes: 30,
        timezone: 'UTC',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        scheduleMode: 'interval' as const,
        agentSlug: null,
        prompt: 'test',
        triggerSource: 'manual' as const,
        lastRunAt: null,
        nextRunAt: null,
        skillMetadata: null,
      }
      mocks.useRepoSchedules.mockReturnValue({ data: [mockJob], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: mockJob, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5')

      // The normalization effect should have reset the tab to 'jobs'
      expect(setScheduleTab).toHaveBeenCalledWith('jobs')
      // Jobs tab content should render instead of blank
      expect(screen.getByText('Select Job')).toBeInTheDocument()
    })
  })

  describe('schedule target not found', () => {
    it('renders not found fallback for real repo', () => {
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: undefined,
        isLoading: false,
        isError: true,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: undefined, isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('999')

      expect(screen.getByText('Repository not found')).toBeInTheDocument()
    })

    it('renders not found fallback for assistant', () => {
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: undefined,
        isLoading: false,
        isError: true,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: undefined, isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: undefined, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('0')

      expect(screen.getByText('Assistant not found')).toBeInTheDocument()
    })
  })

  describe('dialog interactions', () => {
    it('closing ScheduleJobDialog calls closeDialog', () => {
      const closeDialog = vi.fn()
      mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({
        dialog: 'edit',
        jobId: 123,
        closeDialog,
      }))
      const mockJob = {
        id: 123,
        name: 'Test Job',
        repoId: 5,
        cronExpression: null,
        intervalMinutes: 30,
        timezone: 'UTC',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        scheduleMode: 'interval' as const,
        agentSlug: null,
        prompt: 'test',
        triggerSource: 'manual' as const,
        lastRunAt: null,
        nextRunAt: null,
        skillMetadata: null,
      }
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [mockJob], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: mockJob, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5')

      const closeButton = screen.getByTestId('close-job-dialog')
      fireEvent.click(closeButton)

      expect(closeDialog).toHaveBeenCalled()
    })

    it('delete mutation success calls closeDialog', () => {
      const closeDialog = vi.fn()
      const deleteMutate = vi.fn((_args, { onSuccess }) => { onSuccess() })
      mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({
        dialog: 'delete',
        jobId: 123,
        closeDialog,
      }))
      const mockJob = {
        id: 123,
        name: 'Test Job',
        repoId: 5,
        cronExpression: null,
        intervalMinutes: 30,
        timezone: 'UTC',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        scheduleMode: 'interval' as const,
        agentSlug: null,
        prompt: 'test',
        triggerSource: 'manual' as const,
        lastRunAt: null,
        nextRunAt: null,
        skillMetadata: null,
      }
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [mockJob], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: mockJob, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })
      mocks.useDeleteRepoSchedule.mockReturnValue({ mutate: deleteMutate, isPending: false })

      renderSchedules('5')

      // The DeleteDialog renders a Confirm button that calls onConfirm.
      // Find the confirm button and click it to trigger handleDelete.
      const confirmButton = screen.getByText('Delete')
      fireEvent.click(confirmButton)

      // The mutation runs and onSuccess calls closeDialog
      expect(closeDialog).toHaveBeenCalled()
    })

    it('edit button on JobDetailTab calls openEditJob', () => {
      const openEditJob = vi.fn()
      mocks.useScheduleUrlState.mockReturnValue(createMockScheduleUrlState({
        scheduleTab: 'detail',
        jobId: 123,
        openEditJob,
      }))
      const mockJob = {
        id: 123,
        name: 'Test Job',
        repoId: 5,
        cronExpression: null,
        intervalMinutes: 30,
        timezone: 'UTC',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        scheduleMode: 'interval' as const,
        agentSlug: null,
        prompt: 'test',
        triggerSource: 'manual' as const,
        lastRunAt: null,
        nextRunAt: null,
        skillMetadata: null,
      }
      mocks.useScheduleTarget.mockReturnValue({
        scheduleTarget: {
          repoId: 5,
          kind: 'repo',
          name: 'my-repo',
          subtitle: 'repos/my-repo',
          fullPath: '/abs/repos/my-repo',
          backHref: '/repos/5',
        },
        isLoading: false,
        isError: false,
      })
      mocks.useRepoSchedules.mockReturnValue({ data: [mockJob], isLoading: false })
      mocks.useRepoSchedule.mockReturnValue({ data: mockJob, isFetching: false })
      mocks.useRepoScheduleRuns.mockReturnValue({ data: [], isLoading: false })
      mocks.useRepoScheduleRun.mockReturnValue({ data: undefined, isLoading: false })

      renderSchedules('5')

      const editButton = screen.getByTestId('edit-job')
      fireEvent.click(editButton)

      expect(openEditJob).toHaveBeenCalledWith(123)
    })
  })
})
