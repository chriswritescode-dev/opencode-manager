import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { Repo } from '@/api/types'
import { MS_PER_MINUTE } from '@/lib/activeWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useActiveWork } from './useActiveWork'

const REPO_PATH = '/repo'
const WINDOW_MS = 60 * MS_PER_MINUTE

const mocks = vi.hoisted(() => ({
  listSessionPage: vi.fn(),
  getSession: vi.fn(),
  getRepoSiblings: vi.fn(),
  useNavigableRepos: vi.fn(),
  pendingSessionIDs: [] as string[],
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return {
    ...actual,
    listSessionPage: mocks.listSessionPage,
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
    mocks.getSession.mockReset()
    mocks.getRepoSiblings.mockReset()
    mocks.getRepoSiblings.mockResolvedValue([])
    mocks.useNavigableRepos.mockReset()
    mocks.useNavigableRepos.mockReturnValue({ repos: [repo], isLoading: false, refetch: vi.fn() })
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      parents: new Map(),
      directories: new Map(),
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

    expect(mocks.listSessionPage).toHaveBeenCalledWith({ cursor: 'page2', includeChildren: true })
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
})
