import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Repo, RepoSibling } from '@/api/repos'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { makeRepo } from '@/test/fixtures/api'
import { renderWithProviders } from '@/test/render'
import { RepoWorktreesProvider } from './RepoWorktreesContext'
import { useRepoWorktreeList } from './repo-worktrees-context'

const REPO_PATH = '/repo'
const WORKTREE_PATH = '/repo/.worktrees/feature'

const repo: Repo = makeRepo({
  id: 1,
  fullPath: REPO_PATH,
  localPath: REPO_PATH,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
})

const worktreeSibling: RepoSibling = {
  ...repo,
  id: -1,
  fullPath: WORKTREE_PATH,
  localPath: 'feature',
  sourcePath: WORKTREE_PATH,
  currentBranch: 'feature',
  worktreeSource: 'opencode',
}

function WorktreeConsumer() {
  const worktrees = useRepoWorktreeList()
  return <div data-testid="worktrees">{worktrees.map((worktree) => worktree.directory).join(',')}</div>
}

function renderProvider() {
  return renderWithProviders(
    <RepoWorktreesProvider>
      <WorktreeConsumer />
    </RepoWorktreesProvider>,
    {
      events: true,
      fetchRoutes: [
        { method: 'GET', path: '/api/repos', respond: () => ({ json: [repo] }) },
        { method: 'GET', path: '/api/repos/1/siblings', respond: () => ({ json: [worktreeSibling] }) },
        { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [] } }) },
        { method: 'GET', path: '/api/opencode/api/session/active', respond: () => ({ json: { data: {} } }) },
        { method: 'GET', path: '/api/opencode/api/permission/request', respond: () => ({ json: { data: [] } }) },
        { method: 'GET', path: '/api/opencode/api/form', respond: () => ({ json: { data: [] } }) },
        { method: 'GET', path: '/api/opencode/api/shell', respond: () => ({ json: { data: [] } }) },
      ],
    },
  )
}

const setActiveSession = (directory: string) => {
  useSessionStatus.setState({
    statuses: new Map([['session', { type: 'busy' }]]),
    directories: new Map([['session', directory]]),
  })
}

describe('RepoWorktreesProvider', () => {
  beforeEach(() => {
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

    const { fetchFake } = renderProvider()

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchFake.findRequests('GET', '/api/repos/1/siblings')).toHaveLength(0)
    expect(screen.getByTestId('worktrees')).toHaveTextContent('')
  })

  it('fetches siblings and exposes the worktree when a busy session directory is unmatched', async () => {
    setActiveSession(WORKTREE_PATH)

    const { fetchFake } = renderProvider()

    await waitFor(() => expect(screen.getByTestId('worktrees')).toHaveTextContent(WORKTREE_PATH))
    expect(fetchFake.findRequests('GET', '/api/repos/1/siblings')).toHaveLength(1)
  })
})
