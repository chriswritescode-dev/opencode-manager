import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DesktopSessionTree } from './DesktopSessionTree'
import { SIDEBAR_SESSIONS_PER_REPO } from './sidebar-session-tree'
import type { Repo } from '@/api/types'

type SessionFixture = {
  id: string
  projectID: string
  title: string
  time: { created: number; updated: number; archived?: number }
  location: { directory: string }
  parentID?: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type SessionsHookCall = { directories: string[]; options?: { search?: string; limit?: number } }

const {
  listReposMock,
  sessionsData,
  sessionsHookCalls,
  createSessionCalls,
  permissionSessions,
  formSessions,
  emptyOnSearch,
} = vi.hoisted(() => ({
  listReposMock: vi.fn(),
  sessionsData: [] as SessionFixture[],
  sessionsHookCalls: [] as SessionsHookCall[],
  createSessionCalls: [] as Array<{ directory?: string; vars?: unknown }>,
  permissionSessions: { current: new Set<string>() },
  formSessions: { current: new Set<string>() },
  emptyOnSearch: { current: false },
}))

vi.mock('@/api/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/repos')>()
  return { ...actual, listRepos: listReposMock }
})

vi.mock('@/hooks/useOpenCode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOpenCode')>()
  return {
    ...actual,
    useSessionsAcrossDirectories: (directories: string[], options?: { search?: string; limit?: number }) => {
      sessionsHookCalls.push({ directories, options })
      const data =
        options?.search && emptyOnSearch.current
          ? []
          : sessionsData.filter((session) => directories.includes(session.location.directory))
      return { data, isLoading: false, isError: false }
    },
    useCreateSession: (directory?: string) => ({
      mutate: (vars?: unknown) => {
        createSessionCalls.push({ directory, vars })
      },
    }),
  }
})

vi.mock('@/hooks/useSessionPins', () => ({
  useSessionPins: () => ({ data: [] }),
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: () => ({
    hasForSession: (sessionID: string) => permissionSessions.current.has(sessionID),
  }),
  useForms: () => ({
    hasForSession: (sessionID: string) => formSessions.current.has(sessionID),
  }),
}))

function createRepo(overrides: Partial<Repo> & { id: number; fullPath: string }): Repo {
  return {
    localPath: `repos/${overrides.id}`,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
    ...overrides,
  }
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

const repoA = createRepo({ id: 1, fullPath: '/repos/a', name: 'Alpha', lastAccessedAt: 20 })
const repoB = createRepo({ id: 2, fullPath: '/repos/b', name: 'Beta', lastAccessedAt: 10 })
const repoC = createRepo({ id: 3, fullPath: '/repos/c', name: 'Gamma', lastAccessedAt: 30 })

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function createWrapper(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={initialEntries}>
          {children}
          <LocationDisplay />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

const toggleFor = (name: string) => screen.getByRole('button', { name: `Show sessions in ${name}` })

const fetchedDirectories = () => new Set(sessionsHookCalls.flatMap((call) => call.directories))

describe('DesktopSessionTree', () => {
  beforeEach(() => {
    listReposMock.mockReset()
    listReposMock.mockResolvedValue([repoA, repoB, repoC])
    sessionsData.splice(
      0,
      sessionsData.length,
      createSession('a1', '/repos/a'),
      createSession('b1', '/repos/b'),
      createSession('c1', '/repos/c'),
    )
    sessionsHookCalls.splice(0, sessionsHookCalls.length)
    createSessionCalls.splice(0, createSessionCalls.length)
    permissionSessions.current = new Set()
    formSessions.current = new Set()
    emptyOnSearch.current = false
  })

  it('lists every repo by last access, even inside a repo, with no Recent section', async () => {
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1']) })

    await screen.findByText('Alpha')
    const names = screen
      .getAllByRole('button', { name: /^Show sessions in / })
      .map((button) => button.getAttribute('aria-label'))

    expect(names).toEqual(['Show sessions in Gamma', 'Show sessions in Alpha', 'Show sessions in Beta'])
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('opens the active repo by default and lazily fetches only its sessions', async () => {
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1']) })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toBeTruthy()
    expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'true')
    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Session b1/ })).toBeNull()
    expect(fetchedDirectories()).toEqual(new Set(['/repos/a']))
  })

  it('opens nothing outside a repo', async () => {
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    await screen.findByText('Alpha')

    expect(screen.queryByRole('button', { name: /^Session / })).toBeNull()
    expect(sessionsHookCalls).toHaveLength(0)
  })

  it('keeps only one repo open at a time', async () => {
    const user = userEvent.setup()
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1']) })

    await screen.findByRole('button', { name: /^Session a1/ })
    await user.click(toggleFor('Beta'))

    expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Session b1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()

    await user.click(toggleFor('Beta'))

    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Session / })).toBeNull()
  })

  it('opens the repo page when the repo name is clicked', async () => {
    const user = userEvent.setup()
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    await user.click(await screen.findByRole('button', { name: 'Beta' }))

    expect(screen.getByTestId('location').textContent).toBe('/repos/2')
  })

  it('navigates to a session and marks it current', async () => {
    const user = userEvent.setup()
    sessionsData.push(createSession('a2', '/repos/a', Date.now() - 1000))
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1/sessions/a1']) })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: /^Session a2/ }))

    expect(screen.getByTestId('location').textContent).toBe('/repos/1/sessions/a2')
    expect(screen.getByRole('button', { name: /^Session a2/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /^Session a1/ })).not.toHaveAttribute('aria-current')
  })

  it('offers All sessions once the open repo reaches the page size', async () => {
    const user = userEvent.setup()
    sessionsData.push(
      ...Array.from({ length: SIDEBAR_SESSIONS_PER_REPO }, (_, index) =>
        createSession(`s${index + 1}`, '/repos/a', Date.now() - index - 1),
      ),
    )
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1/sessions/a1']) })

    await user.click(await screen.findByText('All sessions'))

    expect(screen.getByTestId('location').textContent).toBe('/repos/1')
  })

  it('hides All sessions below the page size', async () => {
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1']) })

    await screen.findByRole('button', { name: /^Session a1/ })

    expect(screen.queryByText('All sessions')).toBeNull()
  })

  it('commits the search on Enter across ready repos and clears with Escape', async () => {
    const user = userEvent.setup()
    listReposMock.mockResolvedValue([repoA, repoB, createRepo({ id: 4, fullPath: '/repos/d', name: 'Delta', cloneStatus: 'cloning' })])
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    const input = await screen.findByLabelText('Search sessions')
    await screen.findByText('Alpha')
    await user.type(input, 'Session{Enter}')

    const searchCall = sessionsHookCalls.find((call) => call.options?.search === 'Session')
    expect(searchCall?.directories).toEqual(['/repos/a', '/repos/b'])
    expect(await screen.findByRole('button', { name: /^Session a1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Session b1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Show sessions in / })).toBeNull()

    await user.type(input, '{Escape}')

    expect(input).toHaveValue('')
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Session / })).toBeNull())
    expect(toggleFor('Alpha')).toBeTruthy()
  })

  it('clears a committed search with the clear button', async () => {
    const user = userEvent.setup()
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'Session{Enter}')
    await screen.findByRole('button', { name: /^Session a1/ })

    await user.click(screen.getByLabelText('Clear search'))

    expect(input).toHaveValue('')
    expect(screen.queryByLabelText('Clear search')).toBeNull()
    expect(toggleFor('Alpha')).toBeTruthy()
  })

  it('shows the empty search state when a committed search returns nothing', async () => {
    const user = userEvent.setup()
    emptyOnSearch.current = true
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'nothing{Enter}')

    expect(await screen.findByText('No sessions found')).toBeTruthy()
  })

  it('creates a session in the repo full path', async () => {
    const user = userEvent.setup()
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/']) })

    await user.click(await screen.findByRole('button', { name: 'New session in Beta' }))

    expect(createSessionCalls).toContainEqual({ directory: '/repos/b', vars: { agent: undefined } })
  })

  it('renders permission and form badges for sessions with pending requests', async () => {
    sessionsData.push(createSession('a2', '/repos/a', Date.now() - 1000))
    permissionSessions.current = new Set(['a1'])
    formSessions.current = new Set(['a2'])
    render(<DesktopSessionTree />, { wrapper: createWrapper(['/repos/1']) })

    await screen.findByRole('button', { name: /^Session a1/ })

    expect(screen.getByLabelText('Pending permission')).toBeTruthy()
    expect(screen.getByLabelText('Pending form')).toBeTruthy()
  })
})
