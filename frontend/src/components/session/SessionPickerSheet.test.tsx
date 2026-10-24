import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkGroups, ActiveWorkItem } from '@/lib/activeWork'
import { DEFAULT_ACTIVITY_WINDOW_MINUTES } from '@/api/types/settings'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { stubMatchMedia } from '@/test/test-utils'
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
  repos: [] as Repo[],
  activeWorkGroups: { needsInput: [], running: [], recent: [] } as ActiveWorkGroups,
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ preferences: undefined }),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, getOpenCodeLocation: mocks.getOpenCodeLocation, listProjects: mocks.listProjects }
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

function session(id: string, title: string, directory: string, updated = Date.now()): Session {
  return {
    id,
    projectID: 'proj',
    title,
    time: { created: updated, updated },
    location: { directory },
    cost: 0,
    tokens: {},
  } as unknown as Session
}

function repo(id: number, name: string, fullPath: string): Repo {
  return {
    id,
    name,
    localPath: fullPath,
    fullPath,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
  }
}

function activeWorkItem(
  id: string,
  directory: string,
  server?: { id: string; name: string },
): ActiveWorkItem {
  const now = Date.now()
  return {
    key: `${server?.id ?? LOCAL_OPENCODE_SERVER_ID}:${id}`,
    state: 'recent',
    session: session(id, `Active ${id}`, directory, now),
    repo: server ? null : repo(1, 'alpha', directory),
    serverId: server?.id ?? null,
    serverName: server?.name ?? null,
    updatedAt: now,
    path: `/repos/1/sessions/${id}`,
  }
}

function LocationProbe() {
  const location = useLocation()
  const navigationType = useNavigationType()
  return (
    <div data-testid="location">{`${location.pathname}${location.search} ${navigationType}`}</div>
  )
}

function renderSheet(initialEntries: string[] = ['/repos/1?mobileTab=sessions']) {
  const onClose = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <KeyboardShortcutsProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <SessionPickerSheet isOpen onClose={onClose} />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </KeyboardShortcutsProvider>
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('SessionPickerSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    stubMatchMedia(true)
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    mocks.repos = [repo(1, 'alpha', '/w/a'), repo(2, 'beta', '/w/b')]
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
    mocks.sessionsData = [session('ses_one', 'Solo session', '/w/a')]

    renderSheet()

    const row = await screen.findByRole('option', { name: /Solo session/ })
    fireEvent.click(row)

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/ses_one REPLACE')
  })

  it('closes instead of navigating when the chosen session is already open', async () => {
    mocks.sessionsData = [session('ses_one', 'Solo session', '/w/a')]

    const { onClose } = renderSheet(['/repos/1/sessions/ses_one?mobileTab=sessions'])

    const row = await screen.findByRole('option', { name: /Solo session/ })
    fireEvent.click(row)

    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/repos/1/sessions/ses_one?mobileTab=sessions POP',
    )
  })

  it('creates a session in the current repo from the header action and opens it', async () => {
    renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: 'New session in alpha' }))

    expect(mocks.createSessionDirectories).toEqual(['/w/a'])
    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/ses_new REPLACE')
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
    mocks.sessionsData = [session('ses_remote', 'Remote session', '/home/me/app')]

    renderSheet()

    const row = await screen.findByRole('option', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(mocks.lastDirectories).toEqual([])
    expect(mocks.lastAllDirectories).toBe(true)
    expect(screen.getByTestId('linked-servers-nav')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'This project' })).not.toBeInTheDocument()

    fireEvent.click(row)

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/sessions/ses_remote REPLACE',
    )
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

    renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Projects' }))
    fireEvent.click(await screen.findByText('Alpha'))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha REPLACE',
    )
  })

  it('follows the sidebar server selection to list that server', async () => {
    mocks.sessionsData = [session('ses_remote', 'Remote session', '/home/me/app')]

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

    renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_active/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/ses_active REPLACE')
  })

  it('opens a remote activity row on its own server while the local server is selected', async () => {
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_kitchen', '/home/me/app', { id: 'srv_kitchen', name: 'Kitchen' })],
    }

    renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_kitchen/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/sessions/ses_kitchen REPLACE',
    )
  })

  it('opens an activity row of another linked server than the selected one', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.activeWorkGroups = {
      needsInput: [],
      running: [],
      recent: [activeWorkItem('ses_hall', '/home/me/hall', { id: 'srv_hall', name: 'Hall' })],
    }

    renderSheet()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }))
    fireEvent.click(await screen.findByRole('option', { name: /Active ses_hall/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_hall/sessions/ses_hall REPLACE',
    )
  })
})
