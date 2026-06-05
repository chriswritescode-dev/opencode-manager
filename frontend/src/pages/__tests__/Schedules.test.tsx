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
  useScheduleTab: vi.fn(),
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

vi.mock('@/hooks/useMobileTabBar', () => ({
  useScheduleTab: mocks.useScheduleTab,
}))

vi.mock('@/components/schedules', () => ({
  ScheduleJobDialog: vi.fn(() => <div>ScheduleJobDialog</div>),
  JobsTab: vi.fn(({ onSelectJob }) => (
    <div>
      <button onClick={() => onSelectJob(123)} data-testid="select-job">Select Job</button>
    </div>
  )),
  JobDetailTab: vi.fn(({ onRunNow }) => (
    <div>
      <button onClick={onRunNow} data-testid="run-now">Run Now</button>
    </div>
  )),
  RunHistoryTab: vi.fn(() => <div>RunHistoryTab</div>),
  ScheduleTabMenu: vi.fn(() => <div>ScheduleTabMenu</div>),
}))

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

const renderSchedules = (repoId: string) => {
  return render(
    <MemoryRouter initialEntries={[`/repos/${repoId}/schedules`]}>
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
    mocks.useScheduleTab.mockReturnValue({
      scheduleTab: 'jobs',
      setScheduleTab: vi.fn(),
    })
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
      mocks.useScheduleTab.mockReturnValue({
        scheduleTab: 'detail',
        setScheduleTab: vi.fn(),
      })
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
})
