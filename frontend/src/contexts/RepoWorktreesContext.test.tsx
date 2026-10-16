import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '@/api/types'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { RepoWorktreesProvider, useRepoWorktreeList } from './RepoWorktreesContext'

const mocks = vi.hoisted(() => ({
  getRepoSiblings: vi.fn(),
  useNavigableRepos: vi.fn(),
}))

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
  usePermissions: () => ({ pendingSessionIDs: [] }),
  useForms: () => ({ pendingSessionIDs: [] }),
}))

const REPO_PATH = '/repo'
const WORKTREE_PATH = '/repo/.worktrees/feature'

const repo: Repo = {
  id: 1,
  fullPath: REPO_PATH,
  localPath: REPO_PATH,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
}

const worktreeSibling = {
  ...repo,
  id: -1,
  fullPath: WORKTREE_PATH,
  localPath: 'feature',
  sourcePath: WORKTREE_PATH,
  currentBranch: 'feature',
  worktreeSource: 'opencode' as const,
}

function WorktreeConsumer() {
  const worktrees = useRepoWorktreeList()
  return <div data-testid="worktrees">{worktrees.map((worktree) => worktree.directory).join(',')}</div>
}

const renderProvider = (queryClient: QueryClient) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <RepoWorktreesProvider>
      <WorktreeConsumer />
    </RepoWorktreesProvider>,
    { wrapper },
  )
}

const setActiveSession = (directory: string) => {
  useSessionStatus.setState({
    statuses: new Map([['session', { type: 'busy' as const }]]),
    directories: new Map([['session', directory]]),
  })
}

describe('RepoWorktreesProvider', () => {
  beforeEach(() => {
    mocks.getRepoSiblings.mockReset()
    mocks.getRepoSiblings.mockResolvedValue([worktreeSibling])
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

  it('never fetches siblings when every active directory belongs to a repo', async () => {
    setActiveSession(REPO_PATH)

    renderProvider(new QueryClient({ defaultOptions: { queries: { retry: false } } }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getRepoSiblings).not.toHaveBeenCalled()
    expect(screen.getByTestId('worktrees')).toHaveTextContent('')
  })

  it('fetches siblings and exposes the worktree when a busy session directory is unmatched', async () => {
    setActiveSession(WORKTREE_PATH)

    renderProvider(new QueryClient({ defaultOptions: { queries: { retry: false } } }))

    await waitFor(() => expect(screen.getByTestId('worktrees')).toHaveTextContent(WORKTREE_PATH))
    expect(mocks.getRepoSiblings).toHaveBeenCalledWith(1)
  })
})
