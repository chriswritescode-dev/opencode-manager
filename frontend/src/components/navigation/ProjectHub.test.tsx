import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Repo } from '@/api/types'
import type { RepoSibling } from '@/api/repos'
import type { ProjectConfigResponse } from '@opencode-manager/shared/types'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { FetchError } from '@/api/fetchWrapper'
import { useSideMenu } from '@/hooks/useSideMenu'
import { encodeProjectTarget, type ProjectTarget } from '@/lib/projectTarget'
import { ProjectHub } from './ProjectHub'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useRepoSiblings: vi.fn(),
  useCreateRepoWorkspace: vi.fn(),
  useDeleteRepoWorkspaces: vi.fn(),
  useRepoActivity: vi.fn(),
  useSSE: vi.fn(),
  useCreateSession: vi.fn(),
  useDeleteSession: vi.fn(),
  useUpdateSession: vi.fn(),
  useMultiRuns: vi.fn(),
  useProjectConfig: vi.fn(),
  useTerminals: vi.fn(),
  getProjectConfig: vi.fn(),
  runMutate: vi.fn(),
  removeMutate: vi.fn(),
  trustMutate: vi.fn(),
  createWorkspaceMutate: vi.fn(),
  useOpenCodeServers: vi.fn(),
  openSettingsTab: vi.fn(),
  refetchServers: vi.fn(),
  lastDirectories: { current: [] as string[] },
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: () => ({ openTab: mocks.openSettingsTab }),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  workspaceLabel: (workspace: { currentBranch?: string; branch?: string; localPath?: string }) =>
    workspace.currentBranch || workspace.branch || workspace.localPath || 'worktree',
  worktreeSourceLabel: (worktree: { schedule?: { runId: number | null }; worktreeSource?: string }) => {
    if (worktree.schedule) {
      return worktree.schedule.runId === null ? 'Schedule · shared' : `Schedule · run #${worktree.schedule.runId}`
    }
    if (worktree.worktreeSource === 'git') return 'Git'
    return worktree.worktreeSource === 'opencode' ? 'OpenCode' : null
  },
}))

vi.mock('@/api/projectConfig', () => ({
  getProjectConfig: mocks.getProjectConfig,
  useProjectConfig: mocks.useProjectConfig,
  useRunProjectAction: () => ({ mutate: mocks.runMutate, isPending: false }),
  useTrustRepoConfig: () => ({ mutate: mocks.trustMutate, isPending: false }),
}))

vi.mock('@/api/terminals', () => ({
  useTerminals: mocks.useTerminals,
  useRemoveTerminal: () => ({ mutate: mocks.removeMutate, isPending: false }),
}))

vi.mock('@/hooks/useRepoSiblings', () => ({
  useRepoSiblings: mocks.useRepoSiblings,
  useCreateRepoWorkspace: mocks.useCreateRepoWorkspace,
  useDeleteRepoWorkspaces: mocks.useDeleteRepoWorkspaces,
}))

vi.mock('@/hooks/useRepoActivity', () => ({ useRepoActivity: mocks.useRepoActivity }))
vi.mock('@/hooks/useSSE', () => ({ useSSE: mocks.useSSE }))
vi.mock('@/hooks/useMultiRuns', () => ({ useMultiRuns: mocks.useMultiRuns }))
vi.mock('@/hooks/useOpenCode', () => ({
  useCreateSession: mocks.useCreateSession,
  useDeleteSession: mocks.useDeleteSession,
  useUpdateSession: mocks.useUpdateSession,
}))
vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: [] }),
  useToggleSessionPin: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/components/session/SessionCard', () => ({
  SessionCard: ({ session, onSelect }: { session: { id: string }; onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect(session.id)}>open-{session.id}</button>
  ),
}))

vi.mock('@/hooks/useSessionSearch', async () => {
  const React = await import('react')
  return {
    useSessionSearch: (directories: string[]) => {
      mocks.lastDirectories.current = directories
      const [query, setQuery] = React.useState('')
      const sessions = [{
        id: 'ses_1',
        title: 'One',
        time: { created: 1, updated: 2 },
        location: { directory: '/abs/repos/one' },
      }]
      const trimmedQuery = query.trim()
      const filteredSessions = trimmedQuery
        ? sessions.filter((session) => session.title.toLowerCase().includes(trimmedQuery.toLowerCase()))
        : sessions
      return {
        query,
        setQuery,
        trimmedQuery,
        sessions,
        filteredSessions,
        isSearchPending: false,
        isLoading: false,
        isPending: false,
        isPlaceholderData: false,
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        canFetchNextPage: false,
      }
    },
  }
})

vi.mock('@/components/repo/WorktreeTabs', () => ({
  WorktreeTabs: ({
    value,
    onValueChange,
    onCreateWorkspace,
  }: {
    value: string
    onValueChange: (value: 'workspaces') => void
    onCreateWorkspace?: () => void
  }) => (
    <div data-testid="worktree-tab" data-value={value}>
      <button type="button" onClick={() => onValueChange('workspaces')}>Worktrees tab</button>
      <button type="button" onClick={onCreateWorkspace}>New workspace</button>
    </div>
  ),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

function makeConfig(actions: ProjectConfigResponse['actions'] = []): ProjectConfigResponse {
  return {
    actions,
    worktreeSetup: [],
    repoFile: {
      path: '.ocm/project.json',
      exists: false,
      trusted: true,
      hash: null,
      warnings: [],
      executable: null,
    },
  }
}

const baseRepo: Repo = {
  id: 1,
  name: 'my-repo',
  localPath: 'repos/my-repo',
  fullPath: '/abs/repos/my-repo',
  defaultBranch: 'main',
  currentBranch: 'main',
  branch: 'main',
  cloneStatus: 'ready',
  clonedAt: 1,
  isWorktree: false,
}

const secondRepo: Repo = {
  ...baseRepo,
  id: 2,
  name: 'other-repo',
  localPath: 'repos/other-repo',
  fullPath: '/abs/repos/other-repo',
}

const assistantRepo: Repo = {
  ...baseRepo,
  id: 0,
  name: 'Assistant',
  localPath: 'assistant',
  fullPath: '/abs/assistant',
}

const enabledServer: OpenCodeServer = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'http://kitchen:5551',
  username: 'opencode',
  enabled: true,
  hasPassword: false,
  createdAt: 1,
  updatedAt: 1,
}

const serverDirectory = '/abs/server/app'

const opencodeWorktree: RepoSibling = {
  ...baseRepo,
  id: 2,
  fullPath: '/abs/repos/my-repo-ws',
  currentBranch: 'feature/x',
  branch: 'feature/x',
  isWorktree: true,
  worktreeSource: 'opencode',
}

const scheduleWorktree: RepoSibling = {
  ...baseRepo,
  id: 3,
  fullPath: '/abs/repos/schedule-nightly',
  currentBranch: 'schedule/5/run-7',
  branch: 'schedule/5/run-7',
  isWorktree: true,
  worktreeSource: 'schedule',
  schedule: { repoId: 1, jobId: 5, runId: 7, inUse: false, name: 'Nightly' },
}

const newWorkspaceDirectory = '/abs/repos/my-repo-ws'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function MenuControls() {
  const { openMenu } = useSideMenu()
  const navigate = useNavigate()
  return (
    <div>
      <button
        type="button"
        onClick={() => openMenu({ page: 'sessions', project: { kind: 'repo', repoId: 1 } })}
      >
        open-menu
      </button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </div>
  )
}

function currentParams(): URLSearchParams {
  const location = screen.getByTestId('location').textContent ?? ''
  return new URLSearchParams(location.split('?')[1] ?? '')
}

function hubTree(queryClient: QueryClient, target: ProjectTarget, key: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/?menu=sessions&menuProject=${encodeProjectTarget(target)}`]}>
        <LocationProbe />
        <ProjectHub key={key} target={target} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderHub(target: ProjectTarget = { kind: 'repo', repoId: 1 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(hubTree(queryClient, target, encodeProjectTarget(target)))
  return {
    ...rendered,
    queryClient,
    rerenderHub: (nextTarget: ProjectTarget, key: string) => {
      rendered.rerender(hubTree(queryClient, nextTarget, key))
    },
  }
}

function renderPushedHub(target: ProjectTarget = { kind: 'repo', repoId: 1 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
        <MenuControls />
        <ProjectHub target={target} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

class SignalFreeRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init ? { ...init, signal: undefined } : init)
  }
}

function renderSessionRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/', element: <ProjectHub target={{ kind: 'repo', repoId: 1 }} /> },
      {
        path: '/repos/:id/sessions/:sessionId',
        element: <div data-testid="session-route" />,
        loader: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25))
          return null
        },
      },
    ],
    {
      initialEntries: [
        '/',
        {
          pathname: '/',
          search: '?menu=sessions&menuProject=repo:1',
          state: { urlParamHistory: { previousSearch: '' } },
        },
      ],
      initialIndex: 1,
    },
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('ProjectHub', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lastDirectories.current = []
    mocks.getRepo.mockResolvedValue(baseRepo)
    mocks.useRepoSiblings.mockReturnValue({ data: [] })
    mocks.useCreateRepoWorkspace.mockReturnValue({ mutate: mocks.createWorkspaceMutate, isPending: false })
    mocks.useDeleteRepoWorkspaces.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useCreateSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useDeleteSession.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    mocks.useUpdateSession.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mocks.useMultiRuns.mockReturnValue({ data: [] })
    mocks.useProjectConfig.mockReturnValue({ data: makeConfig() })
    mocks.useTerminals.mockReturnValue({ data: [] })
    mocks.getProjectConfig.mockResolvedValue(makeConfig())
    mocks.createWorkspaceMutate.mockImplementation(() => {})
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [enabledServer],
      showsInitialLoading: false,
      isPaused: false,
      refetch: mocks.refetchServers,
    })
  })

  it('shows a not-found state without retrying the missing repo', async () => {
    mocks.getRepo.mockRejectedValue(new FetchError('Repository not found', 404))

    renderHub({ kind: 'repo', repoId: 999 })

    expect(await screen.findByText('Repository not found')).toBeInTheDocument()
    expect(mocks.getRepo).toHaveBeenCalledTimes(1)
  })

  it('fetches a schedule worktree directory only after its group is expanded', async () => {
    mocks.useRepoSiblings.mockReturnValue({ data: [opencodeWorktree, scheduleWorktree] })
    const user = userEvent.setup()
    renderHub()

    await user.click(await screen.findByRole('button', { name: 'Worktrees tab' }))

    await waitFor(() => {
      expect(mocks.lastDirectories.current).toEqual(['/abs/repos/my-repo-ws'])
    })

    await user.click(screen.getByRole('button', { expanded: false, name: /schedule\/5\/run-7/ }))

    await waitFor(() => {
      expect(mocks.lastDirectories.current).toEqual([
        '/abs/repos/my-repo-ws',
        '/abs/repos/schedule-nightly',
      ])
    })
  })

  it('opens the new workspace terminal when setup starts from the repo tab', async () => {
    mocks.createWorkspaceMutate.mockImplementation((_request: unknown, options: { onSuccess: (value: unknown) => void }) => {
      options.onSuccess({
        directory: newWorkspaceDirectory,
        worktreeSetup: {
          status: 'started',
          terminal: {
            id: 'pty-new',
            title: 'Worktree setup',
            kind: 'setup',
            cwd: newWorkspaceDirectory,
            status: 'running',
          },
          repoCommandsSkipped: false,
        },
      })
    })
    const user = userEvent.setup()
    renderHub()

    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    await user.click(await screen.findByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => {
      const params = currentParams()
      expect(params.get('dialog')).toBe('terminal')
      expect(params.get('terminal')).toBe('pty-new')
      expect(params.get('toolProject')).toBe('repo:1')
      expect(params.get('repoTab')).toBe('workspaces')
      expect(params.get('terminalDirectory')).toBe(newWorkspaceDirectory)
    })
  })

  it('stays on the workspace tab without a terminal when setup does not start', async () => {
    mocks.createWorkspaceMutate.mockImplementation((_request: unknown, options: { onSuccess: (value: unknown) => void }) => {
      options.onSuccess({
        directory: newWorkspaceDirectory,
        worktreeSetup: { status: 'none' },
      })
    })
    const user = userEvent.setup()
    renderHub()

    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    await user.click(await screen.findByRole('button', { name: 'Create Worktree' }))

    await waitFor(() => {
      expect(screen.getByTestId('worktree-tab')).toHaveAttribute('data-value', 'workspaces')
    })
    expect(currentParams().has('terminal')).toBe(false)
    expect(currentParams().get('dialog')).not.toBe('terminal')
  })

  it('sends the typed worktree name and blocks names that are not a single folder', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(await screen.findByRole('button', { name: 'New workspace' }))
    const nameInput = await screen.findByLabelText('Name')
    await user.type(nameInput, '../escape')
    expect(screen.getByRole('button', { name: 'Create Worktree' })).toBeDisabled()
    expect(screen.getByText('Directory name cannot contain dot-dot path segments')).toBeInTheDocument()

    await user.clear(nameInput)
    await user.type(nameInput, 'feature-login')
    await user.click(screen.getByRole('button', { name: 'Create Worktree' }))

    expect(mocks.createWorkspaceMutate).toHaveBeenCalledWith({ name: 'feature-login' }, expect.anything())
  })

  it('shows the session controls, worktree tabs and the multi-run entry', async () => {
    const user = userEvent.setup()
    renderHub()

    expect(await screen.findByRole('button', { name: 'New Session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project actions' })).toBeInTheDocument()
    expect(screen.getByTestId('worktree-tab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage sessions' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Multi-run' })).toBeInTheDocument()
  })

  it('clears the search and selection mode when the project changes', async () => {
    const user = userEvent.setup()
    const { rerenderHub } = renderHub()

    const searchInput = await screen.findByPlaceholderText('Search sessions...')
    await user.type(searchInput, 'needle')
    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    expect(await screen.findByText('0 selected')).toBeInTheDocument()

    mocks.getRepo.mockResolvedValue(secondRepo)
    rerenderHub({ kind: 'repo', repoId: 2 }, 'repo:2')

    const clearedSearch = await screen.findByPlaceholderText('Search sessions...')
    expect(clearedSearch).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Manage sessions' })).toBeInTheDocument()
  })

  it('opens the created session from a pushed menu and returns to the pre-menu route on Back', async () => {
    mocks.useCreateSession.mockReturnValue({
      mutate: (_data: unknown, options: { onSuccess?: (session: { id: string }) => void }) => {
        options.onSuccess?.({ id: 'ses_new' })
      },
      isPending: false,
    })
    const user = userEvent.setup()
    renderPushedHub()

    await user.click(screen.getByRole('button', { name: 'open-menu' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('menu=sessions'))

    await user.click(await screen.findByRole('button', { name: 'New Session' }))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('/repos/1/sessions/ses_new')
    })
    expect(currentParams().has('menu')).toBe(false)
    expect(currentParams().has('menuProject')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('opens a session row from a pushed menu and returns to the pre-menu route on Back', async () => {
    const user = userEvent.setup()
    renderPushedHub()

    await user.click(screen.getByRole('button', { name: 'open-menu' }))
    await user.click(await screen.findByRole('button', { name: 'open-ses_1' }))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('/repos/1/sessions/ses_1')
    })
    expect(currentParams().has('menu')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('opens the session when the destination route has an async loader', async () => {
    mocks.useCreateSession.mockReturnValue({
      mutate: (_data: unknown, options: { onSuccess?: (session: { id: string }) => void }) => {
        options.onSuccess?.({ id: 'ses_new' })
      },
      isPending: false,
    })
    const user = userEvent.setup()
    const originalRequest = globalThis.Request
    globalThis.Request = SignalFreeRequest as typeof Request
    try {
      const router = renderSessionRouter()

      await user.click(await screen.findByRole('button', { name: 'New Session' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/repos/1/sessions/ses_new')
      })
      expect(router.state.location.search).toBe('')

      await act(async () => {
        await router.navigate(-1)
      })
      await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    } finally {
      globalThis.Request = originalRequest
    }
  })

  it('renders the assistant project without worktree tabs or worktree actions', async () => {
    mocks.getRepo.mockResolvedValue(assistantRepo)
    const user = userEvent.setup()
    renderHub({ kind: 'repo', repoId: 0 })

    expect(await screen.findByPlaceholderText('Search sessions...')).toBeInTheDocument()
    expect(screen.queryByTestId('worktree-tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Worktrees tab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New workspace' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Project actions' }))

    expect(await screen.findByRole('menuitem', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Multi-run' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Create worktree' })).not.toBeInTheDocument()
  })

  it('renders the session search, New Session and Project actions for a server target', async () => {
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    expect(await screen.findByPlaceholderText('Search sessions...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project actions' })).toBeInTheDocument()
    expect(screen.queryByTestId('worktree-tab')).not.toBeInTheDocument()
  })

  it('creates a session on the linked server and leaves the menu', async () => {
    mocks.useCreateSession.mockReturnValue({
      mutate: (_data: unknown, options: { onSuccess?: (session: { id: string }) => void }) => {
        options.onSuccess?.({ id: 'ses_new' })
      },
      isPending: false,
    })
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    await user.click(await screen.findByRole('button', { name: 'New Session' }))

    expect(mocks.useCreateSession).toHaveBeenCalledWith(serverDirectory)
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('/servers/srv_kitchen/sessions/ses_new')
    })
    expect(currentParams().has('menu')).toBe(false)
    expect(currentParams().has('menuProject')).toBe(false)
  })

  it('opens a server session row and leaves the menu', async () => {
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    await user.click(await screen.findByRole('button', { name: 'open-ses_1' }))

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('/servers/srv_kitchen/sessions/ses_1')
    })
    expect(currentParams().has('menu')).toBe(false)
  })

  it('offers server settings when the linked server is missing', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      showsInitialLoading: false,
      isPaused: false,
      refetch: mocks.refetchServers,
    })
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_missing', directory: serverDirectory })

    expect(await screen.findByText('Server not found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open server settings' }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('servers')
  })

  it('offers server settings when the linked server is disabled', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...enabledServer, enabled: false }],
      showsInitialLoading: false,
      isPaused: false,
      refetch: mocks.refetchServers,
    })
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    expect(await screen.findByText('This server is disabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open server settings' }))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('servers')
  })

  it('shows the loading state while the server list loads', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      showsInitialLoading: true,
      isPaused: false,
      refetch: mocks.refetchServers,
    })
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    expect(await screen.findByRole('status', { name: 'Loading project' })).toBeInTheDocument()
  })

  it('shows the unavailable state and retries when the server list is paused offline', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      showsInitialLoading: false,
      isPaused: true,
      refetch: mocks.refetchServers,
    })
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    expect(await screen.findByText('Servers unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(mocks.refetchServers).toHaveBeenCalled()
  })

  it('shows the schedules and multi-run entries for a server target', async () => {
    const user = userEvent.setup()
    renderHub({ kind: 'server', serverId: 'srv_kitchen', directory: serverDirectory })

    await user.click(await screen.findByRole('button', { name: 'Project actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Schedules' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Multi-run' })).toBeInTheDocument()
  })
})
