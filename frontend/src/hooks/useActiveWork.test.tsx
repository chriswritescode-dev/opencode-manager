import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { Repo } from '@/api/types'
import { MS_PER_MINUTE } from '@/lib/activeWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useActiveWork, useActiveWorkCounts } from './useActiveWork'

const REPO_PATH = '/repo'
const WINDOW_MS = 60 * MS_PER_MINUTE

const mocks = vi.hoisted(() => ({
  listSessionPage: vi.fn(),
  listRemoteSessionPage: vi.fn(),
  getSession: vi.fn(),
  getRepoSiblings: vi.fn(),
  useNavigableRepos: vi.fn(),
  pendingSessionIDs: [] as string[],
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    listSessionPage: (input: Parameters<typeof actual.listSessionPage>[0], serverId?: string) =>
      serverId === undefined || serverId === 'local'
        ? mocks.listSessionPage(input, serverId)
        : mocks.listRemoteSessionPage(input, serverId),
    getSession: mocks.getSession,
  }
})

vi.mock('@/api/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/repos')>()
  return {
    ...actual,
    getRepoSiblings: mocks.getRepoSiblings,
  }
})

vi.mock('@/hooks/useSidebarRepoGroups', () => ({
  useNavigableRepos: mocks.useNavigableRepos,
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: () => ({
    servers: [{ id: 'srv_kitchen', name: 'Kitchen', enabled: true }],
    isLoading: false,
  }),
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({ pendingSessionIDs: mocks.pendingSessionIDs }),
  useForms: () => ({ pendingSessionIDs: mocks.pendingSessionIDs }),
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

const session = (
  id: string,
  updated: number,
  parentID?: string | null,
  directory = REPO_PATH,
): SessionInfo => ({
  id,
  projectID: 'proj_1',
  title: `Session ${id}`,
  time: { created: updated, updated },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  ...(parentID === undefined ? {} : { parentID }),
})

const repo: Repo = {
  id: 1,
  fullPath: REPO_PATH,
  localPath: REPO_PATH,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
}

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const createWrapper = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

const recentIDs = (groups: { recent: Array<{ session: SessionInfo }> }): string[] =>
  groups.recent.map((item) => item.session.id)

describe('useActiveWork', () => {
  beforeEach(() => {
    mocks.listSessionPage.mockReset()
    mocks.listRemoteSessionPage.mockReset()
    mocks.listRemoteSessionPage.mockResolvedValue({ items: [] })
    mocks.getSession.mockReset()
    mocks.getRepoSiblings.mockReset()
    mocks.getRepoSiblings.mockResolvedValue([])
    mocks.useNavigableRepos.mockReset()
    mocks.useNavigableRepos.mockReturnValue({ repos: [repo], isLoading: false, refetch: vi.fn() })
    mocks.pendingSessionIDs = []
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      parents: new Map(),
      directories: new Map(),
      sessionServers: new Map(),
      runningShells: new Map(),
      shellRevisions: new Map(),
      shellRevision: 0,
      revision: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests the next page while the oldest loaded session is inside the window', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor === 'page2') {
        return { items: [session('root2', now - 1500)] }
      }
      return {
        items: [session('a', now - 500), session('b', now - 1000)],
        nextCursor: 'page2',
      }
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root2'))

    expect(mocks.listSessionPage).toHaveBeenCalledWith({ cursor: 'page2', includeChildren: true }, 'local')
  })

  it('does not request another page when the oldest loaded session is outside the window', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({
      items: [session('recent', now - 500), session('old', now - 2 * WINDOW_MS)],
      nextCursor: 'page2',
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('recent'))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.listSessionPage).toHaveBeenCalledTimes(1)
  })

  it('resolves an unlisted grandchild to its ancestor root', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [session('G', now - 500, 'C')] })
    mocks.getSession.mockImplementation(async (id: string) => {
      if (id === 'C') return session('C', now - 1000, 'R')
      if (id === 'R') return session('R', now - 1500, null)
      throw new Error(`unexpected session ${id}`)
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('R'))

    expect(recentIDs(result.current.groups)).not.toContain('C')
  })

  it('keeps groups referentially stable across a rerender', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [session('root', now - 500)] })

    const { result, rerender } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root'))

    const before = result.current.groups
    rerender()

    expect(result.current.groups).toBe(before)
  })

  it('drops a recent root once the clock advances past the window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [session('root', now - 1000)] })

    const { result } = renderHook(() => useActiveWork(MS_PER_MINUTE), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root'))

    await act(async () => {
      vi.setSystemTime(now + 5 * MS_PER_MINUTE)
      vi.advanceTimersByTime(MS_PER_MINUTE)
    })

    expect(recentIDs(result.current.groups)).not.toContain('root')
  })

  it('resolves a session in a worktree to its owning repo and opens the workspaces tab', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({
      items: [session('wt', now - 500, undefined, '/repo/.worktrees/feature')],
    })
    mocks.getRepoSiblings.mockResolvedValue([
      {
        ...repo,
        id: -1,
        fullPath: '/repo/.worktrees/feature',
        localPath: 'feature',
        sourcePath: '/repo/.worktrees/feature',
        currentBranch: 'feature',
        worktreeSource: 'opencode',
      },
    ])

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('wt'))

    expect(result.current.groups.recent[0].repo.id).toBe(1)
    expect(result.current.groups.recent[0].path).toBe('/repos/1/sessions/wt?repoTab=workspaces')
  })

  it('reports an error when the worktree siblings lookup fails with no cached data', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({
      items: [session('wt', now - 500, undefined, '/repo/.worktrees/feature')],
    })
    mocks.getRepoSiblings.mockRejectedValue(new Error('siblings failed'))

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('never fetches siblings for an orphan session updated outside the window', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({
      items: [session('orphan', now - 2 * WINDOW_MS, undefined, '/outside/repo')],
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getRepoSiblings).not.toHaveBeenCalled()
  })

  it('counts a remote pending permission and shows one labelled remote row', async () => {
    const now = Date.now()
    mocks.pendingSessionIDs = ['ses_remote']
    mocks.listSessionPage.mockResolvedValue({ items: [] })
    mocks.getSession.mockResolvedValue(session('ses_remote', now - 500, null, '/home/me/app'))
    useSessionStatus.setState({
      sessionServers: new Map([['ses_remote', 'srv_kitchen']]),
      directories: new Map([['ses_remote', 'srv_kitchen|/home/me/app']]),
    })

    const { result } = renderHook(
      () => ({ work: useActiveWork(WINDOW_MS), counts: useActiveWorkCounts() }),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => expect(result.current.work.groups.needsInput).toHaveLength(1))

    const row = result.current.work.groups.needsInput[0]
    expect(result.current.counts).toEqual({ needsInput: 1, running: 0 })
    expect(row.serverId).toBe('srv_kitchen')
    expect(row.serverName).toBe('Kitchen')
    expect(row.repo).toBeNull()
    expect(row.path).toBe('/servers/srv_kitchen/sessions/ses_remote')
  })

  it('includes recent sessions from an enabled linked server with its server label and path', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [] })
    mocks.listRemoteSessionPage.mockResolvedValue({
      items: [session('ses_remote_recent', now - 500, null, '/home/me/app')],
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('ses_remote_recent'))

    const row = result.current.groups.recent[0]
    expect(row.serverId).toBe('srv_kitchen')
    expect(row.serverName).toBe('Kitchen')
    expect(row.repo).toBeNull()
    expect(row.path).toBe('/servers/srv_kitchen/sessions/ses_remote_recent')
    expect(mocks.listRemoteSessionPage).toHaveBeenCalledWith(
      { limit: 50, order: 'desc', includeChildren: true },
      'srv_kitchen',
    )
    expect(result.current.isError).toBe(false)
  })

  it('rolls a listed remote child up to a root fetched from the same server', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [] })
    mocks.listRemoteSessionPage.mockResolvedValue({
      items: [session('ses_remote_child', now - 500, 'ses_remote_root', '/home/me/app')],
    })
    mocks.getSession.mockImplementation(async (id: string, serverId?: string) => {
      if (serverId !== 'srv_kitchen') throw new Error('local lookup for a remote session')
      if (id === 'ses_remote_root') return session('ses_remote_root', now - 1500, null, '/home/me/app')
      throw new Error(`unexpected session ${id}`)
    })

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.groups.recent.map((item) => item.session.id)).toEqual(['ses_remote_root']))

    expect(result.current.groups.recent[0].serverId).toBe('srv_kitchen')
    expect(mocks.getSession).toHaveBeenCalledWith('ses_remote_root', 'srv_kitchen')
    expect(mocks.getSession).not.toHaveBeenCalledWith('ses_remote_root', 'local')
  })

  it('keeps the local list when a linked server fails to load', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [session('local_recent', now - 500)] })
    mocks.listRemoteSessionPage.mockRejectedValue(new Error('server unreachable'))

    const { result } = renderHook(() => useActiveWork(WINDOW_MS), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('local_recent'))

    expect(result.current.isError).toBe(false)
    expect(recentIDs(result.current.groups)).not.toContain('ses_remote_recent')
  })

  it('renders a running remote session row and resolves its ancestry on the owning server', async () => {
    const now = Date.now()
    mocks.listSessionPage.mockResolvedValue({ items: [] })
    mocks.getSession.mockImplementation(async (id: string, serverId?: string) => {
      if (serverId !== 'srv_kitchen') throw new Error('local lookup for a remote session')
      if (id === 'ses_child') return session('ses_child', now - 1000, 'ses_remote', '/home/me/app')
      if (id === 'ses_remote') return session('ses_remote', now - 4000, null, '/home/me/app')
      throw new Error(`unexpected session ${id}`)
    })
    useSessionStatus.setState({
      statuses: new Map([['ses_child', { type: 'busy' }]]),
      sessionServers: new Map([['ses_child', 'srv_kitchen']]),
      directories: new Map([['ses_child', 'srv_kitchen|/home/me/app']]),
    })

    const { result } = renderHook(
      () => ({ work: useActiveWork(WINDOW_MS), counts: useActiveWorkCounts() }),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => expect(result.current.work.groups.running).toHaveLength(1))

    expect(result.current.counts).toEqual({ needsInput: 0, running: 1 })
    expect(result.current.work.groups.running[0].session.id).toBe('ses_remote')
    expect(result.current.work.groups.running[0].serverName).toBe('Kitchen')
    expect(mocks.getSession).toHaveBeenCalledWith('ses_child', 'srv_kitchen')
    expect(mocks.getSession).not.toHaveBeenCalledWith('ses_child', 'local')
  })
})
