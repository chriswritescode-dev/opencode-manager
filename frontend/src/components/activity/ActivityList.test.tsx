import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Repo, Session } from '@/api/types'
import type { ActiveWorkItem } from '@/lib/activeWork'
import { formatShortRelativeTime } from '@/lib/utils'
import { ActivityList } from './ActivityList'

const mocks = vi.hoisted(() => ({
  useActiveWork: vi.fn(),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useActiveWork: mocks.useActiveWork,
}))

const WINDOW_MS = 30 * 60_000
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
  return {
    key: `${overrides.repo.id}:${overrides.session.id}`,
    path: `/repos/${overrides.repo.id}/sessions/${overrides.session.id}`,
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

const renderList = (
  onNavigate = vi.fn(),
  path = '/',
  props: { hideWhenEmpty?: boolean; title?: string; variant?: 'full' | 'compact' } = {},
) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityList windowMs={WINDOW_MS} onNavigate={onNavigate} {...props} />
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

  it('calls onNavigate with the item when a row is clicked', () => {
    const onNavigate = vi.fn()
    const item = createItem({ state: 'recent', session: createSession('c1', 'Recent'), repo: createRepo(3, 'Gamma') })
    setGroups({ recent: [item] })

    renderList(onNavigate)

    fireEvent.click(screen.getByRole('button', { name: /Recent/ }))

    expect(onNavigate).toHaveBeenCalledWith(item)
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

  it('renders nothing when hideWhenEmpty and there are no items', () => {
    setGroups({})

    const { container } = renderList(vi.fn(), '/', { hideWhenEmpty: true })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while loading when hideWhenEmpty', () => {
    mocks.useActiveWork.mockReturnValue({
      groups: { needsInput: [], running: [], recent: [] },
      isLoading: true,
      isError: false,
    })

    const { container } = renderList(vi.fn(), '/', { hideWhenEmpty: true })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the title only when there are items', () => {
    setGroups({
      recent: [createItem({ state: 'recent', session: createSession('c1', 'Recent'), repo: createRepo(3, 'Gamma') })],
    })

    renderList(vi.fn(), '/', { title: 'Activity' })

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })

  it('does not render the title when there are no items', () => {
    setGroups({})

    renderList(vi.fn(), '/', { title: 'Activity' })

    expect(screen.queryByRole('heading', { name: 'Activity' })).toBeNull()
  })
})

describe('ActivityList compact variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders only the section title, without group headings', () => {
    setGroups({
      needsInput: [
        createItem({ state: 'needs-input', session: createSession('n1', 'Needs work'), repo: createRepo(1, 'Alpha') }),
      ],
      running: [
        createItem({ state: 'running', session: createSession('r1', 'Running task'), repo: createRepo(2, 'Beta') }),
      ],
      recent: [
        createItem({ state: 'recent', session: createSession('c1', 'Recent task'), repo: createRepo(3, 'Gamma') }),
      ],
    })

    renderList(vi.fn(), '/', { variant: 'compact', title: 'Activity' })

    expect(screen.getAllByRole('heading').map((node) => node.textContent)).toEqual(['Activity'])
    expect(screen.queryByText('Needs input')).toBeNull()
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('renders one single-line row per item in needs-input, running, recent order', () => {
    const needs = createItem({
      state: 'needs-input',
      session: createSession('n1', 'Needs work'),
      repo: createRepo(1, 'Alpha'),
    })
    const running = createItem({
      state: 'running',
      session: createSession('r1', 'Running task'),
      repo: createRepo(2, 'Beta'),
    })
    const recent = createItem({
      state: 'recent',
      session: createSession('c1', 'Recent task'),
      repo: createRepo(3, 'Gamma'),
    })
    setGroups({ needsInput: [needs], running: [running], recent: [recent] })

    renderList(vi.fn(), '/', { variant: 'compact' })

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Needs work')
    expect(rows[1]).toHaveTextContent('Running task')
    expect(rows[2]).toHaveTextContent('Recent task')

    expect(rows[0]).toHaveAccessibleName(/Needs work/)
    expect(rows[0]).toHaveAccessibleName(/Alpha/)
    expect(rows[0]).toHaveTextContent(formatShortRelativeTime(new Date(needs.session.time.updated)))
    expect(rows[0]).not.toHaveTextContent('feature/x')
  })

  it('caps the compact list at five items, keeping needs-input and running over recent', () => {
    setGroups({
      needsInput: [1, 2].map((n): ActiveWorkItem =>
        createItem({
          state: 'needs-input',
          session: createSession(`n${n}`, `Needs work ${n}`),
          repo: createRepo(n, `Repo ${n}`),
        }),
      ),
      running: [1, 2, 3].map((n): ActiveWorkItem =>
        createItem({
          state: 'running',
          session: createSession(`r${n}`, `Running task ${n}`),
          repo: createRepo(10 + n, `Repo ${10 + n}`),
        }),
      ),
      recent: [1, 2, 3].map((n): ActiveWorkItem =>
        createItem({
          state: 'recent',
          session: createSession(`c${n}`, `Recent task ${n}`),
          repo: createRepo(20 + n, `Repo ${20 + n}`),
        }),
      ),
    })

    renderList(vi.fn(), '/', { variant: 'compact' })

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('Needs work 1')
    expect(rows[4]).toHaveTextContent('Running task 3')
    expect(screen.queryByText('Recent task 1')).toBeNull()
  })

  it('fills the remaining compact slots with recent items', () => {
    setGroups({
      running: [
        createItem({ state: 'running', session: createSession('r1', 'Running task'), repo: createRepo(1, 'Alpha') }),
      ],
      recent: [1, 2, 3, 4, 5].map((n): ActiveWorkItem =>
        createItem({
          state: 'recent',
          session: createSession(`c${n}`, `Recent task ${n}`),
          repo: createRepo(10 + n, `Repo ${10 + n}`),
        }),
      ),
    })

    renderList(vi.fn(), '/', { variant: 'compact' })

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('Running task')
    expect(rows[4]).toHaveTextContent('Recent task 4')
    expect(screen.queryByText('Recent task 5')).toBeNull()
  })

  it('marks the currently open session with aria-current', () => {
    setGroups({
      recent: [
        createItem({ state: 'recent', session: createSession('open', 'Open session'), repo: createRepo(7, 'Gamma') }),
        createItem({ state: 'recent', session: createSession('other', 'Other session'), repo: createRepo(7, 'Gamma') }),
      ],
    })

    renderList(vi.fn(), '/repos/7/sessions/open', { variant: 'compact' })

    expect(screen.getByRole('button', { name: /Open session/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Other session/ })).not.toHaveAttribute('aria-current')
  })

  it('renders nothing when hideWhenEmpty and there are no items', () => {
    setGroups({})

    const { container } = renderList(vi.fn(), '/', { hideWhenEmpty: true, variant: 'compact' })

    expect(container).toBeEmptyDOMElement()
  })
})
