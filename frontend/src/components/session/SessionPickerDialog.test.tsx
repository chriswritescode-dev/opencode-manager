import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkGroups, ActiveWorkItem, ActiveWorkState } from '@/lib/activeWork'
import { stubMatchMedia } from '@/test/test-utils'
import { makeRepo, makeSession } from '@/test/fixtures/session-picker'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { OpenCodeServerProvider } from '@/contexts/OpenCodeServerContext'
import { SessionPickerDialog } from './SessionPickerDialog'

const mocks = vi.hoisted(() => ({
  sessionsData: [] as Session[],
  lastDirectories: [] as string[],
  lastAllDirectories: false,
  lastProject: undefined as { id: string; subpath: string } | undefined,
  locationData: undefined as
    | { directory: string; project: { id: string; directory: string; canonical: string } }
    | undefined,
  sessionsHook: vi.fn(),
  lastSessionServerId: null as string | null,
  fetchNextPage: vi.fn(),
  deleteSessionMock: vi.fn(),
  deletedSessionServerId: null as string | null,
  createSessionDirectories: [] as string[],
  togglePinMock: vi.fn(),
  getOpenCodeLocation: vi.fn(),
  sessionPins: [] as Array<{ sessionId: string; directory: string; pinnedAt: number }>,
  repos: [] as Repo[],
  activeWorkGroups: { needsInput: [], running: [], recent: [] } as ActiveWorkGroups,
  activeWorkWindowMs: 0,
  preferences: undefined as
    | {
        leaderKey?: string
        keyboardShortcuts?: Record<string, string>
        directShortcuts?: string[]
        activityWindowMinutes?: number
      }
    | undefined,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ preferences: mocks.preferences }),
}))

vi.mock('@/api/repos', () => ({
  listRepos: vi.fn().mockResolvedValue([]),
  createRepo: vi.fn(),
  discoverRepos: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, getOpenCodeLocation: mocks.getOpenCodeLocation }
})

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  const { useOpenCodeServerId } = await import('@/contexts/OpenCodeServerContext')
  return {
    ...actual,
    useSessionsAcrossDirectories: (
      directories: string[],
      options?: { search?: string; allDirectories?: boolean; project?: { id: string; subpath: string } },
    ) => {
      mocks.sessionsHook()
      mocks.lastSessionServerId = useOpenCodeServerId()
      mocks.lastDirectories = directories
      mocks.lastAllDirectories = options?.allDirectories ?? false
      mocks.lastProject = options?.project
      const search = options?.search?.toLowerCase() ?? ''
      const base = directories.length === 0 ? [] : mocks.sessionsData
      const data = search
        ? base.filter((session) => (session.title ?? '').toLowerCase().includes(search))
        : base
      return {
        data,
        isLoading: false,
        isPlaceholderData: false,
        fetchNextPage: mocks.fetchNextPage,
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
      }
    },
    useDeleteSession: () => {
      const serverId = useOpenCodeServerId()
      return {
        mutateAsync: (target: unknown) => {
          mocks.deletedSessionServerId = serverId
          return mocks.deleteSessionMock(target)
        },
        isPending: false,
      }
    },
    useCreateSession: (directory: string, onSuccess?: (session: { id: string }) => void) => ({
      mutate: () => {
        mocks.createSessionDirectories.push(directory)
        onSuccess?.({ id: 'ses_new' })
      },
      isPending: false,
    }),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: mocks.sessionPins }),
  useToggleSessionPin: () => ({ mutate: mocks.togglePinMock }),
}))

vi.mock('@/components/navigation/RemoteProjectNav', () => ({
  RemoteProjectNavList: ({ serverId }: { serverId: string }) => (
    <div data-testid="remote-project-nav" data-server={serverId} />
  ),
}))

vi.mock('@/hooks/useSidebarRepoGroups', () => ({
  useNavigableRepos: () => ({ repos: mocks.repos, isLoading: false, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: (windowMs: number) => {
    mocks.activeWorkWindowMs = windowMs
    return { groups: mocks.activeWorkGroups, isLoading: false, isError: false }
  },
  useActivityWindowMinutes: () =>
    mocks.preferences?.activityWindowMinutes ?? DEFAULT_ACTIVITY_WINDOW_MINUTES,
}))

vi.mock('@/stores/sessionStatusStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/sessionStatusStore')>()
  return { ...actual, useSessionStatusForSession: () => ({ type: 'idle' }) }
})

function activeWorkItem(
  id: string,
  title: string,
  directory: string,
  state: ActiveWorkState = 'recent',
): ActiveWorkItem {
  const itemRepo = mocks.repos.find((candidate) => candidate.fullPath === directory) ?? mocks.repos[0]
  const itemSession = makeSession(id, title, directory)
  return {
    key: `${directory}:${id}`,
    session: itemSession,
    repo: itemRepo,
    serverId: null,
    serverName: null,
    state,
    updatedAt: itemSession.time.updated,
    path: `/repos/${itemRepo.id}/sessions/${id}`,
  }
}

function renderWithClient(ui: React.ReactElement, serverId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const directory = mocks.repos[0]?.fullPath
  if (mocks.locationData && directory) {
    queryClient.setQueryData(['opencode', 'location', directory], mocks.locationData)
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <KeyboardShortcutsProvider>
        {serverId ? (
          <OpenCodeServerProvider serverId={serverId}>{ui}</OpenCodeServerProvider>
        ) : (
          ui
        )}
      </KeyboardShortcutsProvider>
    </QueryClientProvider>,
  )
}

function renderPicker(overrides: Partial<React.ComponentProps<typeof SessionPickerDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onSelectSession = vi.fn()
  const onDeleteActiveSession = vi.fn()
  const onSelectRepo = vi.fn()
  renderWithClient(
    <SessionPickerDialog
      open
      onOpenChange={onOpenChange}
      currentRepo={mocks.repos[0]}
      onSelectSession={onSelectSession}
      onDeleteActiveSession={onDeleteActiveSession}
      onSelectRepo={onSelectRepo}
      {...overrides}
    />,
  )
  return { onOpenChange, onSelectSession, onDeleteActiveSession, onSelectRepo }
}

const combobox = () => screen.getByRole('combobox')

const openProjectsTab = () => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
}

const openActiveTab = () => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
}

describe('SessionPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubMatchMedia(true)
    localStorage.clear()
    mocks.deleteSessionMock.mockResolvedValue(undefined)
    mocks.deletedSessionServerId = null
    mocks.createSessionDirectories.length = 0
    mocks.locationData = {
      directory: '/w/a',
      project: { id: 'global', directory: '/w/a', canonical: '/w/a' },
    }
    mocks.getOpenCodeLocation.mockResolvedValue(mocks.locationData)
    mocks.lastProject = undefined
    mocks.lastSessionServerId = null
    mocks.sessionPins = []
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.sessionsData = []
    mocks.activeWorkGroups = { needsInput: [], running: [], recent: [] }
    mocks.activeWorkWindowMs = 0
    mocks.preferences = undefined
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('opens with the active session as the cursor and marks it with a dot', () => {
    mocks.sessionsData = [
      makeSession('ses_active', 'Active session', '/w/a', 3000),
      makeSession('ses_other', 'Other session', '/w/a', 2000),
    ]

    renderPicker({ activeSessionID: 'ses_active' })

    const active = screen.getByRole('option', { name: /Active session/ })
    const other = screen.getByRole('option', { name: /Other session/ })
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(active.textContent).toContain('●')
    expect(other).toHaveAttribute('aria-selected', 'false')
  })

  it('filters rows immediately as the query is typed', () => {
    mocks.sessionsData = [
      makeSession('ses_alpha', 'alpha task', '/w/a', 2000),
      makeSession('ses_beta', 'beta task', '/w/a', 1000),
    ]

    renderPicker()

    fireEvent.change(combobox(), { target: { value: 'beta' } })

    expect(screen.queryByText('alpha task')).not.toBeInTheDocument()
    expect(screen.getByText('beta task')).toBeInTheDocument()
  })

  it('moves the cursor with arrow keys and Ctrl+N/Ctrl+P, wrapping, and opens the row on Enter', () => {
    mocks.sessionsData = [
      makeSession('ses_1', 'First', '/w/a', 3000),
      makeSession('ses_2', 'Second', '/w/a', 2000),
      makeSession('ses_3', 'Third', '/w/a', 1000),
    ]
    const { onSelectSession } = renderPicker()

    const first = screen.getByRole('option', { name: /First/ })
    const second = screen.getByRole('option', { name: /Second/ })
    const third = screen.getByRole('option', { name: /Third/ })

    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(second).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(third).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'n', ctrlKey: true })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'p', ctrlKey: true })
    expect(third).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })
    expect(onSelectSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ses_3' }),
      mocks.repos[0],
    )
  })

  it('toggles scope with Ctrl+A, persists it, queries every repo directory and shows repo labels', () => {
    mocks.sessionsData = [
      makeSession('ses_a', 'Alpha session', '/w/a', 2000),
      makeSession('ses_b', 'Beta session', '/w/b', 1000),
    ]

    renderPicker()

    expect(mocks.lastDirectories).toEqual(['/w/a'])
    expect(mocks.lastAllDirectories).toBe(false)
    expect(screen.getByRole('tab', { name: 'This project' })).toBeInTheDocument()
    expect(screen.getByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })

    expect(mocks.lastDirectories).toEqual(['/w/a', '/w/b'])
    expect(mocks.lastAllDirectories).toBe(true)
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')
    expect(screen.getByRole('tab', { name: 'All sessions' })).toBeInTheDocument()
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })
    expect(mocks.lastDirectories).toEqual(['/w/a'])
    expect(mocks.lastAllDirectories).toBe(false)
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
    expect(screen.getByRole('tab', { name: 'This project' })).toBeInTheDocument()
  })

  it('toggles the scope when the selected sessions tab is clicked again', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('tab', { name: 'This project' }))

    expect(screen.getByRole('tab', { name: 'All sessions', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')

    await user.click(screen.getByRole('tab', { name: 'All sessions' }))

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
  })

  it('selects the sessions tab without toggling the scope when it was not selected', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    await user.click(screen.getByRole('tab', { name: 'This project' }))

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBeNull()
  })

  it('toggles the scope with Enter on the focused selected sessions tab', async () => {
    const user = userEvent.setup()
    renderPicker()

    await waitFor(() => expect(combobox()).toHaveFocus())

    const sessionsTab = screen.getByRole('tab', { name: 'This project' })
    act(() => {
      sessionsTab.focus()
    })
    expect(sessionsTab).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('tab', { name: 'All sessions', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('true')
  })

  it('labels the sessions tab Sessions and lists every project without a current repo', () => {
    mocks.sessionsData = [
      makeSession('ses_a', 'Alpha session', '/w/a', 2000),
      makeSession('ses_b', 'Beta session', '/w/b', 1000),
    ]

    renderPicker({ currentRepo: undefined })

    expect(screen.getByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
    expect(mocks.lastDirectories).toEqual(['/w/a', '/w/b'])
    expect(mocks.lastAllDirectories).toBe(true)
    expect(screen.getByText('Beta session')).toBeInTheDocument()
    expect(localStorage.getItem('oc:session-picker:all-projects')).toBeNull()
  })

  it('leaves the persisted scope preference unchanged on Ctrl+A without a current repo', () => {
    localStorage.setItem('oc:session-picker:all-projects', 'false')

    renderPicker({ currentRepo: undefined })

    fireEvent.keyDown(combobox(), { key: 'a', ctrlKey: true })

    expect(localStorage.getItem('oc:session-picker:all-projects')).toBe('false')
    expect(mocks.lastAllDirectories).toBe(true)
    expect(screen.getByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
  })

  it('starts a new session in the current repo from the sessions tab header action', () => {
    const onNavigate = vi.fn()
    renderPicker({ onNavigate })

    fireEvent.click(screen.getByRole('button', { name: 'New session in alpha' }))

    expect(mocks.createSessionDirectories).toEqual(['/w/a'])
    expect(onNavigate).toHaveBeenCalledWith('/repos/1/sessions/ses_new')
  })

  it('opens the add repository dialog from the projects tab header action', async () => {
    renderPicker()

    openProjectsTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(await screen.findByRole('dialog', { name: 'Add Repository' })).toBeInTheDocument()
  })

  it('starts a new session in a project row and marks a repo that is not ready', async () => {
    const onNavigate = vi.fn()
    mocks.repos = [
      makeRepo(1, 'alpha', '/w/a'),
      { ...makeRepo(2, 'beta', '/w/b'), cloneStatus: 'cloning' },
    ]
    renderPicker({ onNavigate })

    openProjectsTab()

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    expect(mocks.createSessionDirectories).toEqual(['/w/a'])
    expect(onNavigate).toHaveBeenCalledWith('/repos/1/sessions/ses_new')
    expect(screen.queryByRole('button', { name: 'New session in beta' })).not.toBeInTheDocument()
    expect(screen.getByText('Not ready')).toBeInTheDocument()
  })

  it('lists project sessions across worktrees and labels them with the folder name', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a')]
    mocks.locationData = {
      directory: '/w/a',
      project: { id: 'proj_x', directory: '/w/a', canonical: '/w/a' },
    }
    mocks.sessionsData = [
      makeSession('ses_root', 'Root session', '/w/a', 3000),
      makeSession('ses_wt', 'Worktree session', '/w/.opencode/state/opencode/worktree/proj_x/test', 2000),
      makeSession('ses_schedule', 'Schedule session', '/w/schedule-worktrees/job-11-run-361', 1000),
    ]

    renderPicker()

    expect(await screen.findByText('Worktree session')).toBeInTheDocument()
    expect(screen.getByText('Schedule session')).toBeInTheDocument()
    expect(screen.getByText('Root session')).toBeInTheDocument()
    const rootRow = screen.getByRole('option', { name: /Root session/ })
    const worktreeRow = screen.getByRole('option', { name: /Worktree session/ })
    const scheduleRow = screen.getByRole('option', { name: /Schedule session/ })
    expect(worktreeRow.textContent).toContain('test')
    expect(scheduleRow.textContent).toContain('job-11-run-361')
    expect(rootRow.textContent).not.toContain('test')
    expect(rootRow.textContent).not.toContain('job-11-run-361')
    expect(mocks.lastProject).toEqual({ id: 'proj_x', subpath: '' })
  })

  it('falls back to the repo directory listing when the location project is global', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.sessionsData = [
      makeSession('ses_a', 'Alpha session', '/w/a', 2000),
      makeSession('ses_b', 'Beta session', '/w/b', 1000),
    ]

    renderPicker()

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
    expect(mocks.lastDirectories).toEqual(['/w/a'])
    expect(mocks.lastProject).toBeUndefined()
  })

  it('falls back to the repo directory listing when the location lookup fails', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.locationData = undefined
    mocks.getOpenCodeLocation.mockRejectedValue(new Error('location unavailable'))
    mocks.sessionsData = [
      makeSession('ses_a', 'Alpha session', '/w/a', 2000),
      makeSession('ses_b', 'Beta session', '/w/b', 1000),
    ]

    renderPicker()

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
    expect(screen.queryByText('Beta session')).not.toBeInTheDocument()
    expect(mocks.lastProject).toBeUndefined()
  })

  it('does not issue a directory listing while the location is pending', async () => {
    let resolveLocation:
      | ((value: { directory: string; project: { id: string; directory: string; canonical: string } }) => void)
      | undefined
    mocks.locationData = undefined
    mocks.getOpenCodeLocation.mockReturnValue(new Promise((resolve) => { resolveLocation = resolve }))
    mocks.sessionsData = [makeSession('ses_a', 'Alpha session', '/w/a', 2000)]

    renderPicker()

    expect(screen.getByText('Loading sessions...')).toBeInTheDocument()
    expect(mocks.lastDirectories).toEqual([])
    expect(screen.queryByText('Alpha session')).not.toBeInTheDocument()

    await act(async () => {
      resolveLocation?.({
        directory: '/w/a',
        project: { id: 'global', directory: '/w/a', canonical: '/w/a' },
      })
    })

    expect(await screen.findByText('Alpha session')).toBeInTheDocument()
  })

  it('does not query sessions while closed and queries after opening', async () => {
    mocks.sessionsData = [makeSession('ses_1', 'First', '/w/a', 3000)]

    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={mocks.repos[0]}
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
          />
        </>
      )
    }

    renderWithClient(<Host />)

    expect(mocks.sessionsHook).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() => expect(mocks.sessionsHook).toHaveBeenCalled())
  })

  it('deletes on a second Ctrl+D and clears the pending state on a move', async () => {
    mocks.sessionsData = [
      makeSession('ses_1', 'First', '/w/a', 3000),
      makeSession('ses_2', 'Second', '/w/a', 2000),
    ]
    const { onDeleteActiveSession } = renderPicker()

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    expect(screen.getByText('Press Ctrl+D again to confirm')).toBeInTheDocument()
    expect(mocks.deleteSessionMock).not.toHaveBeenCalled()

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(screen.queryByText('Press Ctrl+D again to confirm')).not.toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    expect(screen.getByText('Press Ctrl+D again to confirm')).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    expect(mocks.deleteSessionMock).toHaveBeenCalledWith({ id: 'ses_2', directory: '/w/a' })
    expect(onDeleteActiveSession).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(screen.queryByText('Press Ctrl+D again to confirm')).not.toBeInTheDocument(),
    )
  })

  it('notifies when the active session is deleted before the delete completes', async () => {
    mocks.sessionsData = [makeSession('ses_active', 'Active', '/w/a', 3000)]
    let resolveDelete: () => void = () => undefined
    mocks.deleteSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve
      }),
    )
    const { onDeleteActiveSession } = renderPicker({ activeSessionID: 'ses_active' })

    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })
    fireEvent.keyDown(combobox(), { key: 'd', ctrlKey: true })

    expect(mocks.deleteSessionMock).toHaveBeenCalledWith({ id: 'ses_active', directory: '/w/a' })
    await waitFor(() => expect(onDeleteActiveSession).toHaveBeenCalled())

    await act(async () => {
      resolveDelete()
    })
  })

  it('moves the cursor when a mouse pointer moves over a row', () => {
    mocks.sessionsData = [
      makeSession('ses_1', 'First', '/w/a', 3000),
      makeSession('ses_2', 'Second', '/w/a', 2000),
    ]
    renderPicker()

    const second = screen.getByRole('option', { name: /Second/ })
    const pointerMove = new Event('pointermove', { bubbles: true })
    Object.defineProperty(pointerMove, 'pointerType', { value: 'mouse' })
    fireEvent(second, pointerMove)

    expect(second).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the delete confirmation from the row menu', async () => {
    mocks.sessionsData = [makeSession('ses_1', 'First', '/w/a', 3000)]
    renderPicker()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    await user.click(await screen.findByText('Delete'))

    expect(await screen.findByRole('dialog', { name: 'Delete Session' })).toBeInTheDocument()
  })

  it('groups older sessions under per-day headings', () => {
    mocks.sessionsData = [
      makeSession('ses_jan2', 'Jan two', '/w/a', new Date(2020, 0, 2, 12).getTime()),
      makeSession('ses_jan1', 'Jan one', '/w/a', new Date(2020, 0, 1, 12).getTime()),
    ]

    renderPicker()

    expect(screen.getByText('Thu, Jan 2, 2020')).toBeInTheDocument()
    expect(screen.getByText('Wed, Jan 1, 2020')).toBeInTheDocument()
  })

  it('resets the query and cursor on reopen', async () => {
    mocks.sessionsData = [
      makeSession('ses_active', 'Active session', '/w/a', 3000),
      makeSession('ses_other', 'Other session', '/w/a', 2000),
    ]

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>close-picker</button>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={mocks.repos[0]}
            activeSessionID="ses_active"
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
          />
        </>
      )
    }

    renderWithClient(<Host />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Other' } })
    expect(screen.queryByText('Active session')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('close-picker'))
    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''))
    expect(screen.getByRole('option', { name: /Active session/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders an Activity/Sessions/Projects tab switcher and defaults to the sessions tab', () => {
    renderPicker()

    expect(screen.getByRole('tab', { name: 'This project' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'false')
    expect(combobox()).toHaveAttribute('placeholder', 'Search sessions...')
  })

  it('exposes a tabpanel labelled by the active tab and swaps panels on tab switch', async () => {
    renderPicker()

    const sessionsPanel = screen.getByRole('tabpanel', { name: 'This project' })
    expect(sessionsPanel).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tabpanel', { name: 'Projects' })).not.toBeInTheDocument()

    openProjectsTab()

    const projectsPanel = await screen.findByRole('tabpanel', { name: 'Projects' })
    expect(projectsPanel).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tabpanel', { name: 'This project' })).not.toBeInTheDocument()
  })

  it('focuses the projects search input after clicking the Projects tab and filters on typing', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('tab', { name: 'Projects' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Search projects...')).toHaveFocus())

    await user.keyboard('beta')

    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()
  })

  it('focuses the projects search input after switching tabs with the shortcut', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByPlaceholderText('Search sessions...'))
    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => expect(screen.getByPlaceholderText('Search projects...')).toHaveFocus())
  })

  it('focuses the projects search input after the switch shortcut on a coarse pointer device', async () => {
    stubMatchMedia(false)
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByPlaceholderText('Search sessions...'))
    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => expect(screen.getByPlaceholderText('Search projects...')).toHaveFocus())
  })

  it('does not focus the projects search input when switching tabs by pointer on a coarse pointer device', async () => {
    stubMatchMedia(false)
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('tab', { name: 'Projects' }))

    expect(await screen.findByPlaceholderText('Search projects...')).not.toHaveFocus()
  })

  it('lists repos in the projects tab and opens the cursor repo on Enter', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const { onSelectRepo } = renderPicker()

    openProjectsTab()

    const alpha = await screen.findByRole('option', { name: /alpha/ })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'Enter' })

    expect(onSelectRepo).toHaveBeenCalledWith(mocks.repos[0])
  })

  it('navigates the projects tab with wrapping arrows, PageUp/PageDown and Enter', async () => {
    mocks.repos = Array.from({ length: 12 }, (_, index) =>
      makeRepo(index + 1, `repo-${index + 1}`, `/w/r${index + 1}`),
    )
    const { onSelectRepo } = renderPicker()

    openProjectsTab()

    expect(await screen.findByRole('option', { name: 'repo-1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.keyDown(combobox(), { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: 'repo-12' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'repo-1' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'PageDown' })
    expect(screen.getByRole('option', { name: 'repo-11' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })
    expect(onSelectRepo).toHaveBeenCalledWith(mocks.repos[10])

    fireEvent.keyDown(combobox(), { key: 'PageUp' })
    expect(screen.getByRole('option', { name: 'repo-1' })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens a repo on click in the projects tab', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    const { onSelectRepo } = renderPicker()

    openProjectsTab()

    fireEvent.click(await screen.findByRole('option', { name: /beta/ }))

    expect(onSelectRepo).toHaveBeenCalledWith(mocks.repos[1])
  })

  it('filters projects by name and branch', async () => {
    mocks.repos = [
      { ...makeRepo(1, 'alpha', '/w/a'), currentBranch: 'feature/x' },
      makeRepo(2, 'beta', '/w/b'),
    ]
    renderPicker()

    openProjectsTab()
    await screen.findByRole('option', { name: /alpha/ })

    fireEvent.change(combobox(), { target: { value: 'beta' } })
    expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /beta/ })).toBeInTheDocument()

    fireEvent.change(combobox(), { target: { value: 'feature/x' } })
    expect(screen.getByRole('option', { name: /alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /beta/ })).not.toBeInTheDocument()
  })

  it('shows the empty projects state when nothing matches', async () => {
    renderPicker()

    openProjectsTab()
    await screen.findByRole('option', { name: /alpha/ })

    fireEvent.change(combobox(), { target: { value: 'zzz' } })

    expect(screen.getByText('No projects found')).toBeInTheDocument()
  })

  it('cycles Activity, Sessions and Projects with the default Ctrl+S binding', async () => {
    renderPicker()

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Projects', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Activity', selected: true })).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 's', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
  })

  it('honors a configured switch binding and shows it in the footer', async () => {
    mocks.preferences = { keyboardShortcuts: { switchPickerTab: 'Ctrl+G' } }
    renderPicker()

    expect(screen.getByText(/Ctrl\+G projects/)).toBeInTheDocument()

    fireEvent.keyDown(combobox(), { key: 'g', ctrlKey: true })
    expect(await screen.findByRole('tab', { name: 'Projects', selected: true })).toBeInTheDocument()

    expect(screen.getByText(/Ctrl\+G active/)).toBeInTheDocument()
  })

  it('shows the normalized leader, arrow and key in the footer for a leader switch binding', () => {
    mocks.preferences = {
      keyboardShortcuts: { switchPickerTab: 'G' },
      directShortcuts: [],
      leaderKey: 'Ctrl+X',
    }
    renderPicker()

    expect(screen.getByText(/Ctrl\+X → G projects/)).toBeInTheDocument()
  })

  it('no longer switches tabs on Ctrl+O', () => {
    renderPicker()

    fireEvent.keyDown(combobox(), { key: 'o', ctrlKey: true })

    expect(screen.getByRole('tab', { name: 'This project', selected: true })).toBeInTheDocument()
  })

  it('resets to the sessions tab when the dialog reopens', async () => {
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>close-picker</button>
          <button type="button" onClick={() => setOpen(true)}>open-picker</button>
          <SessionPickerDialog
            open={open}
            onOpenChange={setOpen}
            currentRepo={mocks.repos[0]}
            onSelectSession={vi.fn()}
            onDeleteActiveSession={vi.fn()}
            onSelectRepo={vi.fn()}
          />
        </>
      )
    }

    renderWithClient(<Host />)

    openProjectsTab()
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByText('close-picker'))
    fireEvent.click(screen.getByText('open-picker'))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'This project' })).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('groups active work into needs input, running and recent sections with repo labels', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.activeWorkGroups = {
      needsInput: [activeWorkItem('ses_ni', 'Needs input task', '/w/a', 'needs-input')],
      running: [activeWorkItem('ses_run', 'Running task', '/w/b', 'running')],
      recent: [activeWorkItem('ses_recent', 'Recent task', '/w/a', 'recent')],
    }

    renderPicker()
    openActiveTab()

    expect(await screen.findByText('Needs input')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Needs input task/ }).textContent).toContain('alpha')
    expect(screen.getByRole('option', { name: /Running task/ }).textContent).toContain('beta')
    expect(screen.getByRole('option', { name: /Recent task/ }).textContent).toContain('alpha')
    expect(mocks.activeWorkWindowMs).toBe(30 * 60 * 1000)
  })

  it('skips empty active work sections and shows the empty state for the configured window', async () => {
    mocks.preferences = { activityWindowMinutes: 120 }

    renderPicker()
    openActiveTab()

    expect(
      await screen.findByText('No active or recent sessions in the last 2 hours'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Needs input')).not.toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('formats a full-day active work window as hours in the empty state', async () => {
    mocks.preferences = { activityWindowMinutes: 1440 }

    renderPicker()
    openActiveTab()

    expect(
      await screen.findByText('No active or recent sessions in the last 24 hours'),
    ).toBeInTheDocument()
    expect(mocks.activeWorkWindowMs).toBe(1440 * 60 * 1000)
  })

  it('opens the cursor active row with Enter and selects its session and repo', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [activeWorkItem('ses_run', 'Running task', '/w/b', 'running')],
      recent: [activeWorkItem('ses_recent', 'Recent task', '/w/a', 'recent')],
    }
    const { onSelectSession } = renderPicker()
    openActiveTab()

    const running = await screen.findByRole('option', { name: /Running task/ })
    expect(running).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Recent task/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(combobox(), { key: 'Enter' })

    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'ses_recent' }), mocks.repos[0])
  })

  it('filters active work rows by title and drops sections left empty', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.activeWorkGroups = {
      needsInput: [activeWorkItem('ses_ni', 'Needs input task', '/w/a', 'needs-input')],
      running: [],
      recent: [activeWorkItem('ses_recent', 'Recent task', '/w/b', 'recent')],
    }
    renderPicker()
    openActiveTab()

    await screen.findByRole('option', { name: /Needs input task/ })

    fireEvent.change(combobox(), { target: { value: 'recent' } })

    expect(screen.queryByRole('option', { name: /Needs input task/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Recent task/ })).toBeInTheDocument()
    expect(screen.queryByText('Needs input')).not.toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
  })

  it('pins an active work row from the shared row menu', async () => {
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [activeWorkItem('ses_run', 'Running task', '/w/b', 'running')],
      recent: [],
    }
    renderPicker()
    const user = userEvent.setup()
    openActiveTab()

    await screen.findByRole('option', { name: /Running task/ })
    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    await user.click(await screen.findByText('Pin'))

    expect(mocks.togglePinMock).toHaveBeenCalledWith({
      sessionId: 'ses_run',
      directory: '/w/b',
      pinned: true,
    })
  })

  describe('linked-server mode', () => {
    beforeEach(() => {
      mocks.repos = [makeRepo(1, 'alpha', '/w/a')]
      mocks.sessionsData = [makeSession('ses_remote', 'Remote session', '/home/me/app')]
    })

    it('lists the project sessions with the linked server projects tab and reports the chosen server session', async () => {
      const onSelectRemoteSession = vi.fn()
      renderPicker({
        remote: {
          serverId: 'srv_kitchen',
          serverName: 'Kitchen',
          projectDirectory: '/home/me/app',
        },
        onSelectRemoteSession,
      })

      expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()

      const row = await screen.findByRole('option', { name: /Remote session/ })
      expect(row).toHaveTextContent('Kitchen')

      fireEvent.click(row)

      expect(onSelectRemoteSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ses_remote' }),
        'srv_kitchen',
      )
    })

    it('renders the linked server projects tab through the shared activity-ordered project list', async () => {
      renderPicker({
        remote: { serverId: 'srv_kitchen', serverName: 'Kitchen', projectDirectory: '/home/me/app' },
      })

      openProjectsTab()

      const nav = await screen.findByTestId('remote-project-nav')
      expect(nav).toHaveAttribute('data-server', 'srv_kitchen')
    })

    it('queries the linked server sessions without a host-supplied server provider', async () => {
      renderPicker({
        remote: { serverId: 'srv-1', serverName: 'Kitchen', projectDirectory: '/home/me/app' },
      })

      expect(await screen.findByRole('option', { name: /Remote session/ })).toBeInTheDocument()
      expect(mocks.lastSessionServerId).toBe('srv-1')
    })

    it('navigates a remote active work row through the owning server', async () => {
      const onSelectRemoteSession = vi.fn()
      mocks.activeWorkGroups = {
        needsInput: [
          {
            key: '/home/me/app/ses_remote',
            session: makeSession('ses_remote', 'Remote pending', '/home/me/app'),
            repo: null,
            serverId: 'srv_kitchen',
            serverName: 'Kitchen',
            state: 'needs-input',
            updatedAt: Date.now(),
            path: '/servers/srv_kitchen/sessions/ses_remote',
          },
        ],
        running: [],
        recent: [],
      }
      renderPicker({
        remote: {
          serverId: 'srv_kitchen',
          serverName: 'Kitchen',
          projectDirectory: '/home/me/app',
        },
        onSelectRemoteSession,
      })
      openActiveTab()

      const row = await screen.findByRole('option', { name: /Remote pending/ })
      expect(row).toHaveTextContent('Kitchen')
      expect(screen.queryByRole('button', { name: 'Session actions' })).not.toBeInTheDocument()

      fireEvent.click(row)

      expect(onSelectRemoteSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ses_remote' }),
        'srv_kitchen',
      )
    })

    it('deletes a local active work row through the local server', async () => {
      const user = userEvent.setup()
      mocks.activeWorkGroups = {
        needsInput: [],
        running: [activeWorkItem('ses_local', 'Local task', '/w/a', 'running')],
        recent: [],
      }
      renderWithClient(
        <SessionPickerDialog
          open
          onOpenChange={vi.fn()}
          currentRepo={mocks.repos[0]}
          onSelectSession={vi.fn()}
          onDeleteActiveSession={vi.fn()}
          onSelectRepo={vi.fn()}
          onSelectRemoteSession={vi.fn()}
          remote={{ serverId: 'srv_kitchen', serverName: 'Kitchen', projectDirectory: '/home/me/app' }}
        />,
        'srv_kitchen',
      )
      openActiveTab()

      await screen.findByRole('option', { name: /Local task/ })

      await user.click(screen.getByRole('button', { name: 'Session actions' }))
      await user.click(await screen.findByText('Delete'))

      const dialog = await screen.findByRole('dialog', { name: 'Delete Session' })
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() =>
        expect(mocks.deleteSessionMock).toHaveBeenCalledWith({ id: 'ses_local', directory: '/w/a' }),
      )
      expect(mocks.deletedSessionServerId).toBe(LOCAL_OPENCODE_SERVER_ID)
    })
  })
})
