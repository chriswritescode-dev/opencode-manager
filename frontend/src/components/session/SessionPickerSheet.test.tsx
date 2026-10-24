import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkGroups, ActiveWorkItem } from '@/lib/activeWork'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { LocationCatcher, stubMatchMedia } from '@/test/test-utils'
import { makeRepo, makeSession } from '@/test/fixtures/session-picker'
import { SessionPickerSheet } from './SessionPickerSheet'

const mocks = vi.hoisted(() => ({
  sessionsData: [] as Session[],
  lastDirectories: [] as string[],
  lastAllDirectories: false,
  createSessionDirectories: [] as string[],
  deleteSessionMock: vi.fn(),
  locationData: undefined as
    | { directory: string; project: { id: string; directory: string; canonical: string } }
    | undefined,
  getOpenCodeLocation: vi.fn(),
  listProjects: vi.fn(),
  getSession: vi.fn(),
  repos: [] as Repo[],
  activeWorkGroups: { needsInput: [], running: [], recent: [] } as ActiveWorkGroups,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ preferences: undefined }),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    getOpenCodeLocation: mocks.getOpenCodeLocation,
    listProjects: mocks.listProjects,
    getSession: mocks.getSession,
  }
})

vi.mock('@/api/repos', () => ({
  listRepos: vi.fn().mockResolvedValue([]),
  createRepo: vi.fn(),
  discoverRepos: vi.fn(),
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (
      directories: string[],
      options?: { search?: string; allDirectories?: boolean },
    ) => {
      mocks.lastDirectories = directories
      mocks.lastAllDirectories = options?.allDirectories ?? false
      const search = options?.search?.toLowerCase() ?? ''
      const base = directories.length === 0 && !options?.allDirectories ? [] : mocks.sessionsData
      const data = search
        ? base.filter((session) => (session.title ?? '').toLowerCase().includes(search))
        : base
      return {
        data,
        isLoading: false,
        isPlaceholderData: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
      }
    },
    useDeleteSession: () => ({
      mutateAsync: mocks.deleteSessionMock,
      isPending: false,
    }),
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
  useSessionPins: () => ({ data: [] }),
  useToggleSessionPin: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/useSidebarRepoGroups', () => ({
  useNavigableRepos: () => ({ repos: mocks.repos, isLoading: false, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: () => ({ groups: mocks.activeWorkGroups, isLoading: false, isError: false }),
  useActivityWindowMinutes: () => DEFAULT_ACTIVITY_WINDOW_MINUTES,
  useProjectActivityState: () => null,
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: () => ({
    servers: [{ id: 'srv_kitchen', name: 'Kitchen', enabled: true }],
    isLoading: false,
  }),
  useOpenCodeServerStatuses: () => ({ statuses: [], statusById: {}, isLoading: false }),
}))

vi.mock('@/components/navigation/LinkedServersNav', () => ({
  LinkedServersNav: () => <div data-testid="linked-servers-nav" />,
}))

vi.mock('@/stores/sessionStatusStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/sessionStatusStore')>()
  return { ...actual, useSessionStatusForSession: () => ({ type: 'idle' }) }
})

function activeWorkItem(
  id: string,
  directory: string,
  server?: { id: string; name: string },
): ActiveWorkItem {
  const now = Date.now()
  return {
    key: `${server?.id ?? LOCAL_OPENCODE_SERVER_ID}:${id}`,
    state: 'recent',
    session: makeSession(id, `Active ${id}`, directory, now),
    repo: server ? null : makeRepo(1, 'alpha', directory),
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    updatedAt: now,
    path: `/repos/1/sessions/${id}`,
  }
}

function renderSheet(
  initialEntries: string[] = ['/repos/1?mobileTab=sessions'],
  options: { isOpen?: boolean; cachedRepos?: Repo[] } = {},
) {
  const onClose = vi.fn()
  const capturedPathname: { current: string } = { current: '' }
  const capturedSearch: { current: string } = { current: '' }
  const capturedNavigationType: { current: string } = { current: '' }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (options.cachedRepos) queryClient.setQueryData(['repos'], options.cachedRepos)
  render(
    <QueryClientProvider client={queryClient}>
      <KeyboardShortcutsProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <SessionPickerSheet isOpen={options.isOpen ?? true} onClose={onClose} />
                  <LocationCatcher
                    capturedPathname={capturedPathname}
                    capturedSearch={capturedSearch}
                    capturedNavigationType={capturedNavigationType}
                  />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </KeyboardShortcutsProvider>
    </QueryClientProvider>,
  )
  return {
    onClose,
    location: () =>
      `${capturedPathname.current}${capturedSearch.current} ${capturedNavigationType.current}`,
  }
}

describe('SessionPickerSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    stubMatchMedia(true)
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    mocks.repos = [makeRepo(1, 'alpha', '/w/a'), makeRepo(2, 'beta', '/w/b')]
    mocks.sessionsData = []
    mocks.lastDirectories = []
    mocks.lastAllDirectories = false
    mocks.createSessionDirectories = []
    mocks.activeWorkGroups = { needsInput: [], running: [], recent: [] }
    mocks.listProjects.mockResolvedValue([])
    mocks.locationData = {
      directory: '/w/a',
      project: { id: 'global', directory: '/w/a', canonical: '/w/a' },
    }
    mocks.getOpenCodeLocation.mockResolvedValue(mocks.locationData)
    mocks.getSession.mockResolvedValue(null)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('renders the picker in a bottom sheet with Activity, Sessions and Projects tabs', () => {
    renderSheet(['/'])

    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sessions', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByTestId('linked-servers-nav')).toBeInTheDocument()
  })

  it('navigates to the chosen session, replacing the sheet history entry', async () => {
    mocks.sessionsData = [makeSession('ses_one', 'Solo session', '/w/a')]

    const { location } = renderSheet()

    const row = await screen.findByRole('option', { name: /Solo session/ })
    fireEvent.click(row)

    expect(location()).toBe('/repos/1/sessions/ses_one REPLACE')
  })

  it('closes instead of navigating when the chosen session is already open', async () => {
    mocks.sessionsData = [makeSession('ses_one', 'Solo session', '/w/a')]

    const { onClose, location } = renderSheet(['/repos/1/sessions/ses_one?mobileTab=sessions'])

    const row = await screen.findByRole('option', { name: /Solo session/ })
    fireEvent.click(row)

    expect(onClose).toHaveBeenCalled()
    expect(location()).toBe('/repos/1/sessions/ses_one?mobileTab=sessions POP')
  })

  it('creates a session in the current repo from the header action and opens it', async () => {
    const { location } = renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    expect(mocks.createSessionDirectories).toEqual(['/w/a'])
    expect(location()).toBe('/repos/1/sessions/ses_new REPLACE')
  })

  it('opens the add repository dialog from the projects tab header action', async () => {
    const { onClose } = renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))

    expect(await screen.findByRole('dialog', { name: 'Add Repository' })).toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('lists and opens the linked server sessions when a linked server is selected', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.sessionsData = [makeSession('ses_remote', 'Remote session', '/home/me/app')]

    const { location } = renderSheet()

    const row = await screen.findByRole('option', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(mocks.lastDirectories).toEqual([])
    expect(mocks.lastAllDirectories).toBe(true)
    expect(screen.getByTestId('linked-servers-nav')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'This project' })).not.toBeInTheDocument()

    fireEvent.click(row)

    expect(location()).toBe('/servers/srv_kitchen/sessions/ses_remote REPLACE')
  })

  it('lists the linked server projects on the projects tab and opens one', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.listProjects.mockResolvedValue([
      {
        id: 'p1',
        name: 'Alpha',
        canonical: '/projects/alpha',
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
    ])

    const { location } = renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByText('Alpha'))

    expect(location()).toBe('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha REPLACE')
  })

  it('follows the sidebar server selection to list that server', async () => {
    mocks.sessionsData = [makeSession('ses_remote', 'Remote session', '/home/me/app')]

    renderSheet()

    act(() => {
      useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    })

    const row = await screen.findByRole('option', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(screen.queryByRole('tab', { name: 'This project' })).not.toBeInTheDocument()
  })

  it('lists activity sessions and opens one', async () => {
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_active', '/w/a')],
    }

    const { location } = renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_active/ }))

    expect(location()).toBe('/repos/1/sessions/ses_active REPLACE')
  })

  it('opens a remote activity row on its own server while the local server is selected', async () => {
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_kitchen', '/home/me/app', { id: 'srv_kitchen', name: 'Kitchen' })],
    }

    const { location } = renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_kitchen/ }))

    expect(location()).toBe('/servers/srv_kitchen/sessions/ses_kitchen REPLACE')
  })

  it('opens a remote activity row of the same session id that is open on another server', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_shared', '/home/me/hall', { id: 'srv_hall', name: 'Hall' })],
    }

    const { onClose, location } = renderSheet([
      '/servers/srv_kitchen/sessions/ses_shared?mobileTab=sessions',
    ])

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_shared/ }))

    expect(onClose).not.toHaveBeenCalled()
    expect(location()).toBe('/servers/srv_hall/sessions/ses_shared REPLACE')
  })

  it('opens a local session row that shares the id of the open remote session', async () => {
    mocks.sessionsData = [makeSession('ses_shared', 'Shared session', '/w/a')]

    const { onClose, location } = renderSheet([
      '/servers/srv_kitchen/sessions/ses_shared?mobileTab=sessions',
    ])

    fireEvent.click(await screen.findByRole('option', { name: /Shared session/ }))

    expect(onClose).not.toHaveBeenCalled()
    expect(location()).toBe('/repos/1/sessions/ses_shared REPLACE')
  })

  it('opens a session row of another linked server than the selected one', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_hall', '/home/me/hall', { id: 'srv_hall', name: 'Hall' })],
    }

    const { location } = renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_hall/ }))

    expect(location()).toBe('/servers/srv_hall/sessions/ses_hall REPLACE')
  })

  it('keeps the assistant session flag when choosing another session of the same repo', async () => {
    mocks.sessionsData = [makeSession('ses_b', 'Second assistant session', '/w/a')]

    const { location } = renderSheet(['/repos/1/sessions/ses_a?assistant=1&mobileTab=sessions'])

    fireEvent.click(await screen.findByRole('option', { name: /Second assistant session/ }))

    expect(location()).toBe('/repos/1/sessions/ses_b?assistant=1 REPLACE')
  })

  it('drops the assistant session flag when choosing a session of another repo', async () => {
    localStorage.setItem('oc:session-picker:all-projects', 'true')
    mocks.sessionsData = [
      makeSession('ses_a', 'Assistant session', '/w/a'),
      makeSession('ses_b', 'Beta session', '/w/b'),
    ]

    const { location } = renderSheet(['/repos/1/sessions/ses_a?assistant=1&mobileTab=sessions'])

    fireEvent.click(await screen.findByRole('option', { name: /Beta session/ }))

    expect(location()).toBe('/repos/2/sessions/ses_b REPLACE')
  })

  it('scopes the sheet to the open remote session directory on a linked server session route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.getSession.mockResolvedValue(makeSession('ses_remote', 'Remote session', '/home/me/app'))

    renderSheet(['/servers/srv_kitchen/sessions/ses_remote?mobileTab=sessions'])

    await waitFor(() => expect(mocks.lastDirectories).toEqual(['/home/me/app']))
    expect(mocks.lastAllDirectories).toBe(false)
  })

  it('does not resolve the remote session directory while the sheet is closed', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderSheet(['/servers/srv_kitchen/sessions/ses_remote'], { isOpen: false })

    await waitFor(() => expect(mocks.getSession).not.toHaveBeenCalled())
  })

  it('prefetches the project location on a repo route while the sheet is closed', async () => {
    renderSheet(['/repos/1'], { isOpen: false, cachedRepos: mocks.repos })

    await waitFor(() =>
      expect(mocks.getOpenCodeLocation).toHaveBeenCalledWith('/w/a', LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('does not prefetch the project location outside a repo route', async () => {
    renderSheet(['/'], { isOpen: false, cachedRepos: mocks.repos })

    await waitFor(() => expect(mocks.getOpenCodeLocation).not.toHaveBeenCalled())
  })
})
