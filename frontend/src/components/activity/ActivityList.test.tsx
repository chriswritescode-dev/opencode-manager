import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkItem } from '@/lib/activeWork'
import { ActivityList } from './ActivityList'

const mocks = vi.hoisted(() => ({
  useActiveWork: vi.fn(),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: mocks.useActiveWork,
}))

const WINDOW_MINUTES = 30
const NOW = Date.now()

function createSession(id: string, title: string, updated = NOW - 60_000): Session {
  return {
    id,
    projectID: 'proj-1',
    title,
    time: { created: updated - 10000, updated },
    location: { directory: `/repos/${id}` },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function createRepo(id: number, name: string): Repo {
  return {
    id,
    name,
    fullPath: `/repos/${id}`,
    localPath: `/repos/${id}`,
    defaultBranch: 'main',
    currentBranch: 'feature/x',
    cloneStatus: 'ready',
    clonedAt: 0,
  }
}

function createItem(
  overrides: Partial<ActiveWorkItem> & Pick<ActiveWorkItem, 'state' | 'session' | 'repo'>,
): ActiveWorkItem {
  const repoId = overrides.repo?.id ?? 0
  return {
    key: `${repoId}:${overrides.session.id}`,
    serverId: null,
    serverName: null,
    path: `/repos/${repoId}/sessions/${overrides.session.id}`,
    updatedAt: overrides.session.time.updated,
    ...overrides,
  }
}

function setGroups(groups: {
  needsInput?: ActiveWorkItem[]
  running?: ActiveWorkItem[]
  recent?: ActiveWorkItem[]
}) {
  mocks.useActiveWork.mockReturnValue({
    groups: {
      needsInput: groups.needsInput ?? [],
      running: groups.running ?? [],
      recent: groups.recent ?? [],
    },
    isLoading: false,
    isError: false,
  })
}

const renderList = (onNavigate = vi.fn(), path = '/', minutes = WINDOW_MINUTES) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityList minutes={minutes} onNavigate={onNavigate} />
    </MemoryRouter>,
  )

describe('ActivityList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders non-empty groups in needs-input, running, recent order', () => {
    setGroups({
      needsInput: [createItem({ state: 'needs-input', session: createSession('n1', 'Needs'), repo: createRepo(1, 'Alpha') })],
      running: [createItem({ state: 'running', session: createSession('r1', 'Running'), repo: createRepo(2, 'Beta') })],
      recent: [createItem({ state: 'recent', session: createSession('c1', 'Recent'), repo: createRepo(3, 'Gamma') })],
    })

    renderList()

    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings).toEqual(['Needs input', 'Running', 'Recent'])
  })

  it('hides empty groups', () => {
    setGroups({
      running: [createItem({ state: 'running', session: createSession('r1', 'Running'), repo: createRepo(2, 'Beta') })],
    })

    renderList()

    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings).toEqual(['Running'])
    expect(screen.queryByText('Needs input')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('renders the empty state with the window minutes', () => {
    setGroups({})

    renderList()

    expect(screen.getByText('No active or recent sessions in the last 30 minutes')).toBeInTheDocument()
  })

  it('renders the empty state with an hour-scale window', () => {
    setGroups({})

    renderList(vi.fn(), '/', 1440)

    expect(screen.getByText('No active or recent sessions in the last 24 hours')).toBeInTheDocument()
  })

  it('calls onNavigate with the item when a row is clicked', () => {
    const onNavigate = vi.fn()
    const item = createItem({ state: 'recent', session: createSession('c1', 'Recent'), repo: createRepo(3, 'Gamma') })
    setGroups({ recent: [item] })

    renderList(onNavigate)

    fireEvent.click(screen.getByRole('button', { name: /Recent/ }))

    expect(onNavigate).toHaveBeenCalledWith(item)
  })

  it('labels a worktree session with its worktree branch', () => {
    setGroups({
      recent: [
        createItem({
          state: 'recent',
          session: createSession('c1', 'Worktree'),
          repo: createRepo(3, 'Gamma'),
          worktreeBranch: 'feature/wt',
        }),
      ],
    })

    renderList()

    expect(screen.getByRole('button', { name: /Worktree/ })).toHaveTextContent('Gamma · feature/wt')
  })

  it('marks the currently open session with aria-current', () => {
    setGroups({
      recent: [
        createItem({ state: 'recent', session: createSession('open', 'Open session'), repo: createRepo(7, 'Gamma') }),
        createItem({ state: 'recent', session: createSession('other', 'Other session'), repo: createRepo(7, 'Gamma') }),
      ],
    })

    renderList(vi.fn(), '/repos/7/sessions/open')

    expect(screen.getByRole('button', { name: /Open session/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Other session/ })).not.toHaveAttribute('aria-current')
  })

  it('labels a remote row with its server name and marks it current on its server route', () => {
    const item = createItem({
      state: 'needs-input',
      session: createSession('s1', 'Remote session'),
      repo: null,
      serverId: 'srv_kitchen',
      serverName: 'Kitchen',
      path: '/servers/srv_kitchen/sessions/s1',
    })
    setGroups({ needsInput: [item] })

    renderList(vi.fn(), '/servers/srv_kitchen/sessions/s1')

    const row = screen.getByRole('button', { name: /Remote session/ })
    expect(row).toHaveTextContent('Kitchen')
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('shows a loading state', () => {
    mocks.useActiveWork.mockReturnValue({
      groups: { needsInput: [], running: [], recent: [] },
      isLoading: true,
      isError: false,
    })

    renderList()

    expect(screen.getByText('Loading activity...')).toBeInTheDocument()
  })

  it('shows an error state', () => {
    mocks.useActiveWork.mockReturnValue({
      groups: { needsInput: [], running: [], recent: [] },
      isLoading: false,
      isError: true,
    })

    renderList()

    expect(screen.getByText("Couldn't load activity.")).toBeInTheDocument()
  })
})
