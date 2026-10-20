import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OpenCodeProject } from '@/api/opencode'
import { RemoteProjectNavList } from './RemoteProjectNav'

type SessionFixture = {
  id: string
  projectID: string
  title: string
  time: { created: number; updated: number; archived?: number }
  location: { directory: string }
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  useSessionsAcrossDirectories: vi.fn(),
  useCreateSession: vi.fn(),
  sessionsCalls: [] as Array<{ directories: string[]; options?: { serverId?: string } }>,
  createCalls: [] as Array<{ directory?: string; serverId?: string }>,
  sessions: [] as SessionFixture[],
  hasNextPage: { current: false },
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: mocks.listProjects }
})

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (
      directories: string[],
      options?: { serverId?: string },
    ) => {
      mocks.sessionsCalls.push({ directories, options })
      return {
        data: mocks.sessions.filter((session) => directories.includes(session.location.directory)),
        isLoading: false,
        isError: false,
        hasNextPage: mocks.hasNextPage.current,
      }
    },
    useCreateSession: (
      directory: string,
      onSuccess?: (session: { id: string }) => void,
      serverId?: string,
    ) => ({
      mutate: () => {
        mocks.createCalls.push({ directory, serverId })
        onSuccess?.({ id: 'new-session' })
      },
      isPending: false,
    }),
  }
})

vi.mock('@/hooks/useActiveWork', () => ({
  useProjectActivityState: () => null,
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({ hasForSession: () => false }),
  useForms: () => ({ hasForSession: () => false }),
}))

const kitchen = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

function createProject(id: string, name: string | undefined, canonical: string): OpenCodeProject {
  return {
    id,
    canonical,
    name,
    time: { created: 1, updated: 2 },
    sandboxes: [],
  } as OpenCodeProject
}

function createSession(id: string, directory: string, updated = Date.now()): SessionFixture {
  return {
    id,
    projectID: 'proj-1',
    title: `Session ${id}`,
    time: { created: updated - 10000, updated },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

const alpha = createProject('p1', 'Alpha', '/projects/alpha')
const beta = createProject('p2', undefined, '/projects/beta')

function LocationSpy() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function createWrapper(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {children}
                <LocationSpy />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const toggleFor = (name: string) => screen.getByRole('button', { name: `Show sessions in ${name}` })

function RemoteListHarness({ serverId }: { serverId: string }) {
  const navigate = useNavigate()
  return (
    <RemoteProjectNavList
      serverId={serverId}
      isVisible
      onOpenProject={navigate}
      onSelectSession={navigate}
    />
  )
}

describe('RemoteProjectNavList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionsCalls.splice(0, mocks.sessionsCalls.length)
    mocks.createCalls.splice(0, mocks.createCalls.length)
    mocks.sessions = [createSession('a1', '/projects/alpha', Date.now())]
    mocks.hasNextPage.current = false
    mocks.listProjects.mockResolvedValue([alpha, beta])
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: { srv_kitchen: { serverId: 'srv_kitchen', connected: true, version: null, error: null } },
      isLoading: false,
    })
  })

  it('renders project names with their directory and activity indicator slot', async () => {
    render(
      <RemoteProjectNavList
        serverId="srv_kitchen"
        isVisible
        onOpenProject={vi.fn()}
        onSelectSession={vi.fn()}
      />,
      { wrapper: createWrapper('/') },
    )

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('/projects/alpha')).toBeInTheDocument()
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
  })

  it('expands the project of the current project route and loads its sessions', async () => {
    render(<RemoteListHarness serverId="srv_kitchen" />, {
      wrapper: createWrapper('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha'),
    })

    await waitFor(() => expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'true'))
    expect(await screen.findByRole('button', { name: /Session a1/ })).toBeInTheDocument()
    expect(mocks.sessionsCalls.some((call) => call.directories.includes('/projects/alpha'))).toBe(true)
    expect(mocks.sessionsCalls[0]?.options?.serverId).toBe('srv_kitchen')

    fireEvent.click(screen.getByRole('button', { name: /Session a1/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/servers/srv_kitchen/sessions/a1')
  })

  it('opens a project when its name is clicked', async () => {
    render(<RemoteListHarness serverId="srv_kitchen" />, { wrapper: createWrapper('/') })

    fireEvent.click(await screen.findByRole('button', { name: /^Alpha/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha',
    )
  })

  it('expands another project and shows its sessions', async () => {
    mocks.sessions = [
      createSession('a1', '/projects/alpha', Date.now()),
      createSession('b1', '/projects/beta', Date.now() - 1000),
    ]

    render(<RemoteListHarness serverId="srv_kitchen" />, { wrapper: createWrapper('/') })

    await screen.findByText('beta')
    fireEvent.click(toggleFor('beta'))

    expect(await screen.findByRole('button', { name: /Session b1/ })).toBeInTheDocument()
    expect(toggleFor('beta')).toHaveAttribute('aria-expanded', 'true')
  })

  it('creates a session on the selected server and opens it', async () => {
    render(<RemoteListHarness serverId="srv_kitchen" />, { wrapper: createWrapper('/') })

    fireEvent.click(await screen.findByRole('button', { name: 'New session in beta' }))

    expect(mocks.createCalls).toContainEqual({ directory: '/projects/beta', serverId: 'srv_kitchen' })
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/sessions/new-session',
    )
  })

  it('offers All sessions when the project has another page', async () => {
    mocks.hasNextPage.current = true

    render(<RemoteListHarness serverId="srv_kitchen" />, {
      wrapper: createWrapper('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha'),
    })

    fireEvent.click(await screen.findByText('All sessions'))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha',
    )
  })

  it('shows a disabled state for a disabled server', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...kitchen, enabled: false }],
      isLoading: false,
    })

    render(
      <RemoteProjectNavList
        serverId="srv_kitchen"
        isVisible
        onOpenProject={vi.fn()}
        onSelectSession={vi.fn()}
      />,
      { wrapper: createWrapper('/') },
    )

    expect(screen.getByText('Server is disabled')).toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('reports a failed project load', async () => {
    mocks.listProjects.mockRejectedValue(new Error('offline'))

    render(
      <RemoteProjectNavList
        serverId="srv_kitchen"
        isVisible
        onOpenProject={vi.fn()}
        onSelectSession={vi.fn()}
      />,
      { wrapper: createWrapper('/') },
    )

    expect(await screen.findByText('Could not load projects')).toBeInTheDocument()
  })

  it('reports an unreachable server on a failed project load', async () => {
    mocks.listProjects.mockRejectedValue(new Error('offline'))
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: { srv_kitchen: { serverId: 'srv_kitchen', connected: false, version: null, error: 'boom' } },
      isLoading: false,
    })

    render(
      <RemoteProjectNavList
        serverId="srv_kitchen"
        isVisible
        onOpenProject={vi.fn()}
        onSelectSession={vi.fn()}
      />,
      { wrapper: createWrapper('/') },
    )

    expect(await screen.findByText('Server unreachable')).toBeInTheDocument()
  })
})
