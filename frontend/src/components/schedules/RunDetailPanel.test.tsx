import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { RunDetailPanel } from './RunDetailPanel'
import type { Repo } from '@/api/types'
import type { ScheduleRun } from '@opencode-manager/shared/types'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useMarkScheduleRunViewed: vi.fn(),
  useTTS: vi.fn(),
}))

const tts = {
  speakMessage: vi.fn(),
  stop: vi.fn(),
  unlock: vi.fn(),
  isEnabled: true,
  isPlaying: false,
  isLoading: false,
  activeMessageId: null as string | null,
}

vi.mock('@/hooks/useTTS', () => ({
  useTTS: mocks.useTTS,
}))

const apiMocks = vi.hoisted(() => ({
  createSessionWithContext: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
}))

vi.mock('@/api/opencode', () => ({
  createSessionWithContext: apiMocks.createSessionWithContext,
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

vi.mock('@/hooks/useSchedules', () => ({
  useMarkScheduleRunViewed: mocks.useMarkScheduleRunViewed,
}))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: ({ isOpen, initialSelectedFile }: { isOpen: boolean; initialSelectedFile?: string }) =>
    isOpen ? <div data-testid="file-browser-sheet" data-selected-file={initialSelectedFile} /> : null,
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

const run: ScheduleRun = {
  id: 1,
  jobId: 1,
  repoId: 5,
  triggerSource: 'manual',
  status: 'completed',
  startedAt: 0,
  finishedAt: null,
  viewedAt: null,
  createdAt: 0,
  sessionId: null,
  sessionTitle: null,
  logText: null,
  responseText: '[Report](recaps/daily.html)\n\n[Docs](https://example.com)',
  errorText: null,
  runBranch: null,
  commitHash: null,
  worktreePath: null,
}

function renderPanel(activeRun: ScheduleRun | null = run) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RunDetailPanel
          repoId={5}
          activeRun={activeRun}
          selectedRunLoading={false}
          onCancelRun={vi.fn()}
          cancelRunPending={false}
        />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function clickLink(name: string) {
  const link = screen.getByRole('link', { name })
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(link, event)
  return event
}

beforeEach(() => {
  mocks.useTTS.mockReturnValue(tts)
})

describe('RunDetailPanel read aloud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.getRepo.mockResolvedValue(repo)
  })

  it('reads the run output aloud', () => {
    mocks.useTTS.mockReturnValue(tts)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))

    expect(tts.speakMessage).toHaveBeenCalledWith('schedule-run-1', run.responseText)
  })

  it('stops playback when this run is playing', () => {
    mocks.useTTS.mockReturnValue({ ...tts, isPlaying: true, activeMessageId: 'schedule-run-1' })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Stop playback' }))

    expect(tts.stop).toHaveBeenCalled()
  })

  it('hides the button without output or when TTS is disabled', () => {
    mocks.useTTS.mockReturnValue(tts)
    const empty = renderPanel({ ...run, responseText: null })
    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument()
    empty.unmount()

    mocks.useTTS.mockReturnValue({ ...tts, isEnabled: false })
    renderPanel()
    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument()
  })
})

describe('RunDetailPanel local link handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('prevents navigation and opens no sheet while the repo query is pending', async () => {
    mocks.getRepo.mockReturnValue(new Promise(() => {}))
    renderPanel()

    await screen.findByRole('status')

    const event = clickLink('Report')

    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByTestId('file-browser-sheet')).not.toBeInTheDocument()
  })

  it('prevents navigation, shows a retryable error, and refetches when the repo query fails', async () => {
    mocks.getRepo.mockRejectedValue(new Error('failed'))
    renderPanel()

    await screen.findByRole('alert')
    expect(mocks.getRepo).toHaveBeenCalledTimes(1)

    const event = clickLink('Report')

    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByTestId('file-browser-sheet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.getRepo).toHaveBeenCalledTimes(2))
  })

  it('opens the sheet with the resolved path once the repo is loaded and keeps external links external', async () => {
    mocks.getRepo.mockResolvedValue(repo)
    renderPanel()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())

    const event = clickLink('Report')

    expect(event.defaultPrevented).toBe(true)
    const sheet = await screen.findByTestId('file-browser-sheet')
    expect(sheet.getAttribute('data-selected-file')).toBe('repos/my-repo/recaps/daily.html')

    const docs = screen.getByRole('link', { name: 'Docs' })
    expect(docs.getAttribute('target')).toBe('_blank')
    expect(docs.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('marks an unread completed run viewed and skips running or already-viewed runs', () => {
    const completedMutate = vi.fn()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: completedMutate, isPending: false })
    const completed = renderPanel({ ...run, status: 'completed', viewedAt: null })
    expect(completedMutate).toHaveBeenCalledTimes(1)
    expect(completedMutate).toHaveBeenCalledWith(1)
    completed.unmount()

    const runningMutate = vi.fn()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: runningMutate, isPending: false })
    const running = renderPanel({ ...run, status: 'running', viewedAt: null })
    expect(runningMutate).not.toHaveBeenCalled()
    running.unmount()

    const viewedMutate = vi.fn()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: viewedMutate, isPending: false })
    renderPanel({ ...run, status: 'completed', viewedAt: 123 })
    expect(viewedMutate).not.toHaveBeenCalled()
  })
})

describe('RunDetailPanel open session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMarkScheduleRunViewed.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.getRepo.mockResolvedValue(repo)
  })

  async function clickOpenSession() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open session' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))
  }

  it('opens the original session for a run that worked in the repository', async () => {
    renderPanel({ ...run, sessionId: 'ses_run', worktreePath: null })

    await clickOpenSession()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/ses_run'))
    expect(apiMocks.createSessionWithContext).not.toHaveBeenCalled()
  })

  it('opens the original session while a worktree run is still running', async () => {
    renderPanel({ ...run, status: 'running', sessionId: 'ses_run', worktreePath: '/abs/worktrees/run-1', runBranch: 'schedule/1/run-1' })

    await clickOpenSession()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/ses_run'))
    expect(apiMocks.createSessionWithContext).not.toHaveBeenCalled()
  })

  it('opens the original session for a finished run whose worktree was kept', async () => {
    renderPanel({ ...run, status: 'completed', sessionId: 'ses_run', worktreePath: '/abs/worktrees/job-1-run-1', runBranch: 'schedule/1/run-1' })

    await clickOpenSession()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/ses_run'))
    expect(apiMocks.createSessionWithContext).not.toHaveBeenCalled()
  })

  it('opens a new repo session seeded with the full output and branch for a finished worktree run', async () => {
    apiMocks.createSessionWithContext.mockResolvedValue({ id: 'ses_new' })
    renderPanel({
      ...run,
      sessionId: 'ses_run',
      sessionTitle: 'Daily recap',
      finishedAt: Date.UTC(2026, 9, 2),
      worktreePath: null,
      runBranch: 'schedule/run-1',
      commitHash: 'abc123',
    })

    await clickOpenSession()

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/repos/5/sessions/ses_new'))
    const [input, context] = apiMocks.createSessionWithContext.mock.calls[0] ?? []
    expect(input).toEqual({ directory: '/abs/repos/my-repo', title: 'Daily recap (continued)' })
    expect(context).toContain('scheduled run #1 "Daily recap", which completed and finished at 2026-10-02T00:00:00.000Z')
    expect(context).toContain('branch `schedule/run-1` at commit `abc123`')
    expect(context).toContain(`Run output:\n\n${run.responseText}`)
  })

  it('includes the error and notes no committed changes for a failed worktree run', async () => {
    apiMocks.createSessionWithContext.mockResolvedValue({ id: 'ses_new' })
    renderPanel({ ...run, status: 'failed', responseText: null, errorText: 'Model timed out', worktreePath: null, runBranch: 'schedule/1/run-1' })

    await clickOpenSession()

    await waitFor(() => expect(apiMocks.createSessionWithContext).toHaveBeenCalled())
    const [input, context] = apiMocks.createSessionWithContext.mock.calls[0] ?? []
    expect(input).toEqual({ directory: '/abs/repos/my-repo', title: 'Scheduled run (continued)' })
    expect(context).toContain('ended as failed')
    expect(context).toContain('committed no changes')
    expect(context).toContain('The run produced no output.')
    expect(context).toContain('Run error:\n\nModel timed out')
  })

  it('shows a single open session button', async () => {
    renderPanel({ ...run, sessionId: 'ses_run', worktreePath: null, runBranch: 'schedule/1/run-1' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open session' })).toBeEnabled())
    expect(screen.getAllByRole('button', { name: /session|repo/i })).toHaveLength(1)
  })
})
