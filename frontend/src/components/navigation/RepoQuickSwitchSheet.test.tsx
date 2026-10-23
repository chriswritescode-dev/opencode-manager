import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoQuickSwitchSheet } from './RepoQuickSwitchSheet'
import { getRepoSiblings, listRepos } from '@/api/repos'
import { stubMatchMedia } from '@/test/test-utils'
import { listProjects, type OpenCodeProject } from '@/api/opencode'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import type { ActiveWorkItem } from '@/lib/activeWork'

type SessionFixture = {
  id: string
  projectID: string
  title: string
  time: { created: number; updated: number }
  location: { directory: string }
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

const { sessionsData, sessionsHookCalls, permissionSessions, createSessionDirectories } = vi.hoisted(() => ({
  sessionsData: [] as Array<{
    id: string
    projectID: string
    title: string
    time: { created: number; updated: number }
    location: { directory: string }
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }>,
  sessionsHookCalls: [] as string[][],
  permissionSessions: { current: new Set<string>() },
  createSessionDirectories: [] as string[],
}))

const activityMocks = vi.hoisted(() => ({
  useActiveWork: vi.fn(),
  useActivityWindowMinutes: vi.fn(),
}))

const serverMocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: serverMocks.useOpenCodeServers,
  useOpenCodeServerStatuses: serverMocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: activityMocks.useActiveWork,
  useActivityWindowMinutes: activityMocks.useActivityWindowMinutes,
  useRepoActivityState: () => null,
  useServerActivityState: () => null,
  useLocalActivityState: () => null,
  useProjectActivityState: () => null,
}))

vi.mock('@/api/repos')

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: vi.fn() }
})

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({
    hasForSession: (id: string) => permissionSessions.current.has(id),
  }),
  useForms: () => ({ hasForSession: () => false }),
}))

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (directories: string[]) => {
      sessionsHookCalls.push(directories)
      return { data: sessionsData, isLoading: false, isError: false }
    },
    useCreateSession: (directory: string, onSuccess?: (session: { id: string }) => void) => ({
      mutate: () => {
        createSessionDirectories.push(directory)
        onSuccess?.({ id: 'new-session' })
      },
    }),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: [] }),
}))

function createSession(id: string, updated: number, directory: string): SessionFixture {
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

function createRepo(id: number, name: string, fullPath: string) {
  return {
    id,
    name,
    repoUrl: `https://github.com/test/${name}.git`,
    localPath: fullPath,
    fullPath,
    sourcePath: null,
    currentBranch: 'main',
    defaultBranch: 'main',
    cloneStatus: 'ready' as const,
    clonedAt: 0,
    isLocal: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function createActiveWorkItem(): ActiveWorkItem {
  const session = createSession('s1', Date.now(), '/path/to/repo1')
  return {
    key: '1:s1',
    state: 'recent',
    session,
    repo: createRepo(1, 'repo1', '/path/to/repo1'),
    updatedAt: session.time.updated,
    path: '/repos/1/sessions/s1',
  }
}

function setActivityGroups(groups: {
  needsInput?: ActiveWorkItem[]
  running?: ActiveWorkItem[]
  recent?: ActiveWorkItem[]
}) {
  activityMocks.useActiveWork.mockReturnValue({
    groups: {
      needsInput: groups.needsInput ?? [],
      running: groups.running ?? [],
      recent: groups.recent ?? [],
    },
    isLoading: false,
    isError: false,
  })
}

function createLinkedServer(id: string, name: string, enabled = true) {
  return {
    id,
    name,
    baseUrl: `https://${id}.example.com`,
    username: 'opencode',
    enabled,
    hasPassword: true,
    createdAt: 1,
    updatedAt: 2,
  }
}

function createProject(id: string, name: string, canonical: string): OpenCodeProject {
  return {
    id,
    canonical,
    name,
    time: { created: 1, updated: 2 },
    sandboxes: [],
  } as OpenCodeProject
}

function setLinkedServers(servers: Array<ReturnType<typeof createLinkedServer>>) {
  serverMocks.useOpenCodeServers.mockReturnValue({ servers, isLoading: false })
  serverMocks.useOpenCodeServerStatuses.mockReturnValue({
    statuses: [],
    statusById: Object.fromEntries(
      servers.map((server) => [
        server.id,
        { serverId: server.id, connected: true, version: null, error: null },
      ]),
    ),
    isLoading: false,
  })
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function LocationSpy() {
  const { pathname, search } = useLocation()
  return <div data-testid="location">{`${pathname}${search}`}</div>
}

function MobileSheetHarness() {
  const { close } = useMobileTabBar()
  return (
    <>
      <RepoQuickSwitchSheet isOpen onClose={close} />
      <LocationSpy />
    </>
  )
}

describe('RepoQuickSwitchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    vi.mocked(getRepoSiblings).mockResolvedValue([])
    vi.mocked(listProjects).mockResolvedValue([])
    sessionsData.splice(0, sessionsData.length)
    sessionsHookCalls.splice(0, sessionsHookCalls.length)
    permissionSessions.current.clear()
    activityMocks.useActivityWindowMinutes.mockReturnValue(30)
    setActivityGroups({})
    setLinkedServers([])
    stubMatchMedia(true)
  })

  it('renders with loading state', async () => {
    vi.mocked(listRepos).mockImplementation(() => new Promise(() => {}))
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search repos...')).toBeInTheDocument()
    })
  })

  it('renders empty state when no repos', async () => {
    vi.mocked(listRepos).mockResolvedValue([])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('No repos found')).toBeInTheDocument()
    })
  })

  it('renders repo list and filters on search', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo2.git',
        localPath: '/path/to/repo2',
        sourcePath: null,
        currentBranch: 'develop',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })
    const input = screen.getByPlaceholderText('Search repos...')
    fireEvent.change(input, { target: { value: 'repo1' } })
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.queryByText('repo2')).not.toBeInTheDocument()
    })
  })

  it('distinguishes worktrees of the same repo by branch', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1/.worktrees/feature-a',
        sourcePath: null,
        currentBranch: 'feature-a',
        isWorktree: true,
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 3,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1/.worktrees/feature-b',
        sourcePath: null,
        currentBranch: 'feature-b',
        isWorktree: true,
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getAllByText('repo1')).toHaveLength(3)
      expect(screen.getByText('feature-a')).toBeInTheDocument()
      expect(screen.getByText('feature-b')).toBeInTheDocument()
    })
  })

  it('shows assistant as the first repo option', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: ASSISTANT_REPO_ID,
        repoUrl: 'Assistant',
        localPath: '/assistant',
        sourcePath: null,
        currentBranch: null,
        isLocal: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    const repoNames = screen.getAllByText(/^(Assistant|repo1)$/).map((node) => node.textContent)
    expect(repoNames).toEqual(['Assistant', 'repo1'])
  })

  it('navigates on repo click and closes sheet', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <RepoQuickSwitchSheet isOpen onClose={handleClose} />,
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('repo1'))
    expect(handleClose).toHaveBeenCalled()
  })

  it('navigates to assistant when mobileTabAction is assistant', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/schedules?mobileTab=repos&mobileTabAction=assistant']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/assistant')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('navigates from assistant to repo detail when clicking repo on canonical assistant route', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('navigates from legacy assistant route to repo detail when clicking repo', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('does not mark any repo active on /assistant', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo2.git',
        localPath: '/path/to/repo2',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()
  })

  it('does not mark any repo active on legacy /repos/1/assistant', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo2.git',
        localPath: '/path/to/repo2',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const handleClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1/assistant?mobileTab=repos']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { current: 'page' })).toBeNull()
  })

  it('switches repos from the mobile repos sheet without navigating back to the previous repo', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      {
        id: 1,
        repoUrl: 'https://github.com/test/repo1.git',
        localPath: '/path/to/repo1',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        repoUrl: 'https://github.com/test/repo2.git',
        localPath: '/path/to/repo2',
        sourcePath: null,
        currentBranch: 'main',
        isLocal: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1?mobileTab=repos']}>
          <Routes>
            <Route path="*" element={<MobileSheetHarness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo2'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/2')
  })

  it('does not render sessions for collapsed repos and does not fetch them', async () => {
    const now = Date.now()
    vi.mocked(listRepos).mockResolvedValue([
      createRepo(1, 'repo1', '/path/to/repo1'),
      createRepo(2, 'repo2', '/path/to/repo2'),
    ])
    sessionsData.push(createSession('s1', now, '/path/to/repo1'))

    render(
      <RepoQuickSwitchSheet isOpen onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
      expect(screen.getByText('repo2')).toBeInTheDocument()
    })

    expect(screen.queryByText('Session s1')).not.toBeInTheDocument()
    expect(sessionsHookCalls.some((directories) => directories.includes('/path/to/repo1'))).toBe(false)
  })

  it('expands a repo to show its sessions', async () => {
    const now = Date.now()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    sessionsData.push(createSession('s1', now, '/path/to/repo1'))

    render(
      <RepoQuickSwitchSheet isOpen onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    const toggle = await screen.findByRole('button', { name: 'Show sessions in repo1' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(await screen.findByText('Session s1')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(sessionsHookCalls.some((directories) => directories.includes('/path/to/repo1'))).toBe(true)
  })

  it('navigates to a session when it is tapped', async () => {
    const now = Date.now()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    sessionsData.push(createSession('s1', now, '/path/to/repo1'))

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/?mobileTab=repos']}>
          <Routes>
            <Route path="*" element={<MobileSheetHarness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Show sessions in repo1' }))
    fireEvent.click(await screen.findByText('Session s1'))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/s1')
  })

  it('expands the active repo by default and shows its sessions', async () => {
    const now = Date.now()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    sessionsData.push(createSession('s1', now, '/path/to/repo1'))

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <Routes>
            <Route path="*" element={<MobileSheetHarness />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Session s1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show sessions in repo1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('clears the search with the clear button', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      createRepo(1, 'repo1', '/path/to/repo1'),
      createRepo(2, 'repo2', '/path/to/repo2'),
    ])

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    const input = await screen.findByPlaceholderText('Search repos...')
    await waitFor(() => expect(screen.getByText('repo2')).toBeInTheDocument())
    expect(screen.queryByLabelText('Clear search')).toBeNull()

    fireEvent.change(input, { target: { value: 'repo1' } })
    expect(screen.queryByText('repo2')).toBeNull()

    fireEvent.click(screen.getByLabelText('Clear search'))

    expect(input).toHaveValue('')
    expect(screen.getByText('repo2')).toBeInTheDocument()
    expect(screen.queryByLabelText('Clear search')).toBeNull()
  })

  it('keeps only one repo expanded at a time', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      createRepo(1, 'repo1', '/path/to/repo1'),
      createRepo(2, 'repo2', '/path/to/repo2'),
    ])

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1?mobileTab=repos']}>
          <Routes>
            <Route path="*" element={<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const repo1Toggle = await screen.findByRole('button', { name: 'Show sessions in repo1' })
    const repo2Toggle = screen.getByRole('button', { name: 'Show sessions in repo2' })

    expect(repo1Toggle).toHaveAttribute('aria-expanded', 'true')
    expect(repo2Toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('HERE')).toBeNull()
    expect(screen.getByText('repo1').closest('button')).toHaveAttribute('aria-current', 'page')

    fireEvent.click(repo2Toggle)

    expect(repo1Toggle).toHaveAttribute('aria-expanded', 'false')
    expect(repo2Toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(repo2Toggle)

    expect(repo1Toggle).toHaveAttribute('aria-expanded', 'false')
    expect(repo2Toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('makes the expanded repo header sticky and leaves collapsed headers static', async () => {
    vi.mocked(listRepos).mockResolvedValue([
      createRepo(1, 'repo1', '/path/to/repo1'),
      createRepo(2, 'repo2', '/path/to/repo2'),
    ])

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1?mobileTab=repos']}>
          <Routes>
            <Route path="*" element={<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const expandedToggle = await screen.findByRole('button', { name: 'Show sessions in repo1' })
    const collapsedToggle = screen.getByRole('button', { name: 'Show sessions in repo2' })

    expect(expandedToggle.parentElement).toHaveClass('sticky')
    expect(collapsedToggle.parentElement).not.toHaveClass('sticky')
  })

  it('renders a pending permission indicator on a session row', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    sessionsData.push(createSession('s1', Date.now(), '/path/to/repo1'))
    permissionSessions.current.add('s1')

    render(
      <RepoQuickSwitchSheet isOpen onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Show sessions in repo1' }))

    expect(await screen.findByLabelText('Pending permission')).toBeInTheDocument()
  })

  it('renders the relative time on a session row', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    sessionsData.push(createSession('s1', Date.now() - 5 * 60_000, '/path/to/repo1'))

    render(
      <RepoQuickSwitchSheet isOpen onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Show sessions in repo1' }))

    expect(await screen.findByText('5m ago')).toBeInTheDocument()
  })

  it('renders a closing spacer at the end of the scroll area', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])

    render(
      <RepoQuickSwitchSheet isOpen onClose={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    expect(document.body.querySelector('[aria-hidden="true"].h-16')).not.toBeNull()
  })

  it('renders the Activity section above the repo list when there are items', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    setActivityGroups({ recent: [createActiveWorkItem()] })

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    const heading = screen.getByRole('heading', { name: 'Activity' })
    const repo = screen.getByText('repo1')
    expect(screen.getByText('Session s1')).toBeInTheDocument()
    expect(heading.compareDocumentPosition(repo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the Activity section when there are no items', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    setActivityGroups({})

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    expect(screen.queryByRole('heading', { name: 'Activity' })).toBeNull()
    expect(screen.queryByText('Session s1')).toBeNull()
  })

  it('hides the Activity section while a search query is entered', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    setActivityGroups({ recent: [createActiveWorkItem()] })

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search repos...'), { target: { value: 'repo' } })

    expect(screen.queryByRole('heading', { name: 'Activity' })).toBeNull()
    expect(screen.queryByText('Session s1')).toBeNull()
  })

  it('navigates to the item path and closes the sheet when an activity row is clicked', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    setActivityGroups({ recent: [createActiveWorkItem()] })
    const handleClose = vi.fn()

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Session s1/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/s1')
    expect(handleClose).toHaveBeenCalled()
  })

  it('starts a new session in a repo, opens it and closes the sheet', async () => {
    createSessionDirectories.splice(0, createSessionDirectories.length)
    vi.mocked(listRepos).mockResolvedValue([
      createRepo(1, 'repo1', '/path/to/repo1'),
      createRepo(2, 'repo2', '/path/to/repo2'),
    ])
    const handleClose = vi.fn()
    let pathname = ''
    function LocationProbe() {
      pathname = useLocation().pathname
      return null
    }

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <RepoQuickSwitchSheet isOpen onClose={handleClose} />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'New session in repo2' }))

    expect(createSessionDirectories).toEqual(['/path/to/repo2'])
    expect(pathname).toBe('/repos/2/sessions/new-session')
    expect(handleClose).toHaveBeenCalled()
  })

  it('renders the server switcher when enabled linked servers exist', async () => {
    const user = userEvent.setup()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    setLinkedServers([
      createLinkedServer('srv_kitchen', 'Kitchen'),
      createLinkedServer('srv_office', 'Office', false),
    ])

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    const trigger = await screen.findByRole('button', { name: 'Switch server, current: OC Manager' })
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Servers' })).not.toBeInTheDocument()

    await user.click(trigger)

    expect(await screen.findByRole('menuitem', { name: /Kitchen/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Office/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('hides the server switcher when no linked servers exist', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('repo1')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Switch server/ })).toBeNull()
  })

  it('switches to a linked server without navigating or closing the sheet', async () => {
    const user = userEvent.setup()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    vi.mocked(listProjects).mockResolvedValue([createProject('p1', 'Alpha', '/projects/alpha')])
    setLinkedServers([createLinkedServer('srv_kitchen', 'Kitchen')])
    const handleClose = vi.fn()

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Switch server, current: OC Manager' }))
    await user.click(await screen.findByRole('menuitem', { name: /Kitchen/ }))

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('repo1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add repository/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1')
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('opens a remote project from the sheet and closes it', async () => {
    const user = userEvent.setup()
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    vi.mocked(listProjects).mockResolvedValue([createProject('p1', 'Alpha', '/projects/alpha')])
    setLinkedServers([createLinkedServer('srv_kitchen', 'Kitchen')])
    const handleClose = vi.fn()

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/repos/1']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <RepoQuickSwitchSheet isOpen onClose={handleClose} />
                  <LocationSpy />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Switch server, current: OC Manager' }))
    await user.click(await screen.findByRole('menuitem', { name: /Kitchen/ }))
    await user.click(await screen.findByRole('button', { name: /^Alpha/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha',
    )
    expect(handleClose).toHaveBeenCalled()
  })

  it('leaves the search input unfocused on touch screens so the keyboard stays closed', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    stubMatchMedia(false)

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    const input = await screen.findByPlaceholderText('Search repos...')
    expect(input).not.toHaveFocus()
  })

  it('focuses the search input when a fine pointer is available', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    stubMatchMedia(true)

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    const input = await screen.findByPlaceholderText('Search repos...')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('uses project wording for the search placeholder when a linked server is selected', async () => {
    vi.mocked(listRepos).mockResolvedValue([createRepo(1, 'repo1', '/path/to/repo1')])
    vi.mocked(listProjects).mockResolvedValue([createProject('p1', 'Alpha', '/projects/alpha')])
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    render(<RepoQuickSwitchSheet isOpen onClose={vi.fn()} />, { wrapper: createWrapper() })

    expect(await screen.findByPlaceholderText('Search projects...')).toBeInTheDocument()
  })
})
