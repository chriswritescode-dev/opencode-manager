import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ScheduleRunDrawer } from './ScheduleRunDrawer'
import type { ScheduleRunWithContext } from '@/api/schedules'
import type { Repo } from '@/api/types'

const mocks = vi.hoisted(() => ({
  useScheduleRunDetail: vi.fn(),
  useMarkScheduleRunViewed: vi.fn(),
  getRepo: vi.fn(),
}))

vi.mock('@/hooks/useSchedules', () => ({
  useScheduleRunDetail: mocks.useScheduleRunDetail,
  useMarkScheduleRunViewed: mocks.useMarkScheduleRunViewed,
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
}))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: () => null,
}))

const repo: Repo = {
  id: 5,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
}

function makeRun(overrides: Partial<ScheduleRunWithContext> = {}): ScheduleRunWithContext {
  return {
    id: 1,
    jobId: 7,
    repoId: 5,
    triggerSource: 'manual',
    status: 'completed',
    startedAt: 0,
    finishedAt: 60_000,
    viewedAt: 123,
    createdAt: 0,
    sessionId: null,
    sessionTitle: null,
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: 'feature/x',
    commitHash: 'abc1234def',
    worktreePath: null,
    jobName: 'Daily report',
    repoName: 'my-repo',
    repoPath: '/abs/repos/my-repo',
    ...overrides,
  }
}

function renderDrawer(props: Partial<ComponentProps<typeof ScheduleRunDrawer>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ScheduleRunDrawer
          run={makeRun()}
          open
          onClose={vi.fn()}
          onCancelRun={vi.fn()}
          cancelPending={false}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('ScheduleRunDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useScheduleRunDetail.mockReturnValue({ data: undefined, isLoading: false })
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.getRepo.mockResolvedValue(repo)
  })

  it('renders the title and meta row', () => {
    renderDrawer()

    expect(screen.getByRole('heading', { name: 'Daily report' })).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('my-repo')).toBeInTheDocument()
    expect(screen.getByText('feature/x @ abc1234')).toBeInTheDocument()
  })

  it('calls onNextUnread from the Next unread button', () => {
    const onNextUnread = vi.fn()
    renderDrawer({ onNextUnread, nextUnreadCount: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Next unread (3)' }))

    expect(onNextUnread).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a not found message when no run is available', () => {
    renderDrawer({ run: null, open: true })

    expect(screen.getByText('Run not found')).toBeInTheDocument()
  })
})
