import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import type { RepoSibling } from '@opencode-manager/shared/utils'
import type { SessionPin } from '@opencode-manager/shared/schemas'
import { DesktopSessionTree } from './DesktopSessionTree'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { formCreated, permissionAsked } from '@/test/fixtures/events'
import { makeRepo, makeSession } from '@/test/fixtures/api'
import type { Repo } from '@/api/types'
import type { FetchRoute } from '@/test/fetchFake'

const repoA = makeRepo({ id: 1, name: 'Alpha', fullPath: '/repos/a', localPath: 'repos/a', lastAccessedAt: 20, branch: undefined, currentBranch: undefined })
const repoB = makeRepo({ id: 2, name: 'Beta', fullPath: '/repos/b', localPath: 'repos/b', lastAccessedAt: 10, branch: undefined, currentBranch: undefined })
const repoC = makeRepo({ id: 3, name: 'Gamma', fullPath: '/repos/c', localPath: 'repos/c', lastAccessedAt: 30, branch: undefined, currentBranch: undefined })

function createSession(id: string, directory: string, updated = Date.now()): SessionInfo {
  return makeSession({ id, title: `Session ${id}`, location: { directory }, time: { created: updated - 10000, updated } })
}

const defaultSessions = [
  createSession('a1', '/repos/a'),
  createSession('b1', '/repos/b'),
  createSession('c1', '/repos/c'),
]

interface RenderOptions {
  route?: string
  repos?: Repo[]
  siblings?: RepoSibling[]
  sessions?: SessionInfo[]
  pins?: SessionPin[]
  sessionDetails?: SessionInfo[]
  sessionNextCursor?: string
  sessionSearchError?: boolean
  siblingsError?: boolean
  permissionSessionID?: string
  formSessionID?: string
}

function renderTree(options: RenderOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const sessions = options.sessions ?? defaultSessions
  const searchErrorRoute: FetchRoute[] = options.sessionSearchError
    ? [
        {
          method: 'GET',
          path: '/api/opencode/api/session',
          respond: (request) => {
            if (request.searchParams.get('search') !== null) {
              return { status: 500, json: { error: 'search failed' } }
            }
            const directory = request.searchParams.get('location[directory]')
            return {
              json: {
                data: sessions.filter((session) => directory === null || session.location.directory === directory),
                cursor: {},
              },
            }
          },
        },
      ]
    : []
  const siblingsErrorRoute: FetchRoute[] = options.siblingsError
    ? [{ method: 'GET', path: '/api/repos/:id/siblings', respond: () => ({ status: 500, json: { error: 'siblings failed' } }) }]
    : []
  const result = renderWithProviders(
    <>
      <DesktopSessionTree />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: options.route ?? '/repos/1',
      events: true,
      fetchRoutes: [
        ...searchErrorRoute,
        ...siblingsErrorRoute,
        ...appRoutes({
          repos: options.repos ?? [repoA, repoB, repoC],
          siblings: options.siblings ?? [],
          sessions,
          sessionDetails: options.sessionDetails,
          pins: options.pins ?? [],
          sessionNextCursor: options.sessionNextCursor,
        }),
      ],
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

async function pushPendingActions(
  eventStream: ReturnType<typeof renderTree>['eventStream'],
  options: RenderOptions,
): Promise<void> {
  await act(async () => {
    if (options.permissionSessionID) {
      eventStream?.message(
        permissionAsked(
          { id: 'perm-1', sessionID: options.permissionSessionID, action: 'shell', resources: ['ls'], metadata: {} },
          { directory: '/repos/a' },
        ),
      )
    }
    if (options.formSessionID) {
      eventStream?.message(
        formCreated(
          {
            id: 'form-1',
            sessionID: options.formSessionID,
            title: 'Continue',
            fields: [{ key: 'q0', title: 'Confirm', type: 'string', options: [] }],
          },
          { directory: '/repos/a' },
        ),
      )
    }
    await Promise.resolve()
  })
}

function sessionListRequests(fetchFake: ReturnType<typeof renderTree>['fetchFake']) {
  return fetchFake.findRequests('GET', '/api/opencode/api/session')
}

function fetchedDirectories(fetchFake: ReturnType<typeof renderTree>['fetchFake']): Set<string> {
  const directories = sessionListRequests(fetchFake)
    .map((request) => request.searchParams.get('directory'))
    .filter((directory): directory is string => directory !== null)
  return new Set(directories)
}

const toggleFor = (name: string) => screen.getByRole('button', { name: `Show sessions in ${name}` })

describe('DesktopSessionTree', () => {
  it('lists every repo by last access, even inside a repo, with no Recent section', async () => {
    renderTree({ route: '/repos/1' })

    await screen.findByText('Alpha')
    const names = screen
      .getAllByRole('button', { name: /^Show sessions in / })
      .map((button) => button.getAttribute('aria-label'))

    expect(names).toEqual(['Show sessions in Gamma', 'Show sessions in Alpha', 'Show sessions in Beta'])
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('opens the active repo by default and lazily fetches only its sessions', async () => {
    const { fetchFake } = renderTree({ route: '/repos/1' })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toBeTruthy()
    expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'true')
    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Session b1/ })).toBeNull()
    expect(fetchedDirectories(fetchFake)).toEqual(new Set(['/repos/a']))
  })

  it('shows a worktree session under its repo with the worktree branch tag', async () => {
    renderTree({
      route: '/repos/1',
      sessions: [...defaultSessions, createSession('w1', '/repos/a/.worktrees/feat', Date.now() - 1000)],
      siblings: [
        {
          ...makeRepo({
            id: 1,
            name: 'Alpha',
            fullPath: '/repos/a/.worktrees/feat',
            localPath: 'repos/a/.worktrees/feat',
            currentBranch: 'feat/x',
            branch: 'feat/x',
            isWorktree: true,
          }),
          worktreeSource: 'git',
        },
      ],
    })

    const row = await screen.findByRole('button', { name: /^Session w1/ })
    expect(row).toHaveTextContent('feat/x')
  })

  it('opens nothing outside a repo', async () => {
    const { fetchFake } = renderTree({ route: '/' })

    await screen.findByText('Alpha')

    expect(screen.queryByRole('button', { name: /^Session / })).toBeNull()
    expect(sessionListRequests(fetchFake)).toHaveLength(0)
  })

  it('keeps only one repo open at a time', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/repos/1' })

    await screen.findByRole('button', { name: /^Session a1/ })
    await user.click(toggleFor('Beta'))

    expect(toggleFor('Alpha')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('button', { name: /^Session b1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()

    await user.click(toggleFor('Beta'))

    expect(toggleFor('Beta')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Session / })).toBeNull()
  })

  it('opens the repo page when the repo name is clicked', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderTree({ route: '/' })

    await user.click(await screen.findByRole('button', { name: 'Beta' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/2'))
  })

  it('navigates to a session and marks it current', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderTree({
      route: '/repos/1/sessions/a1',
      sessions: [...defaultSessions, createSession('a2', '/repos/a', Date.now() - 1000)],
    })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: /^Session a2/ }))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1/sessions/a2'))
    expect(screen.getByRole('button', { name: /^Session a2/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /^Session a1/ })).not.toHaveAttribute('aria-current')
  })

  it('offers All sessions when there is a next page', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderTree({ route: '/repos/1/sessions/a1', sessionNextCursor: 'cursor_2' })

    await user.click(await screen.findByText('All sessions'))

    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1'))
  })

  it('hides All sessions when there is no next page', async () => {
    renderTree({ route: '/repos/1' })

    await screen.findByRole('button', { name: /^Session a1/ })

    expect(screen.queryByText('All sessions')).toBeNull()
  })

  it('shows a pinned session that is outside the first page', async () => {
    const { fetchFake } = renderTree({
      route: '/repos/1',
      sessions: [createSession('a1', '/repos/a'), createSession('a2', '/repos/a', Date.now() - 1000)],
      sessionDetails: [createSession('old', '/repos/a', Date.now() - 100000)],
      pins: [{ sessionId: 'old', directory: '/repos/a', pinnedAt: 1 }],
    })

    await screen.findByRole('button', { name: /Session old/ })
    const rows = screen.getAllByRole('button', { name: /Session / })
    expect(rows[0]).toHaveTextContent('Session old')
    expect(rows[0].querySelector('[aria-label="Pinned"]')).not.toBeNull()
    expect(fetchFake.lastRequest('GET', '/api/opencode/api/session/old')).toBeDefined()
  })

  it('keeps a non-ready repo navigable without actions or session requests', async () => {
    const user = userEvent.setup()
    const notReady = makeRepo({
      id: 4,
      name: 'Delta',
      fullPath: '/repos/d',
      localPath: 'repos/d',
      cloneStatus: 'cloning',
      branch: undefined,
      currentBranch: undefined,
    })
    const { fetchFake, capturedPathname } = renderTree({
      route: '/repos/4',
      repos: [repoA, notReady],
      sessions: [createSession('a1', '/repos/a')],
    })

    await screen.findByText('Delta')

    expect(toggleFor('Delta')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'New session in Delta' })).toBeNull()
    expect(await screen.findByText('Repository not ready')).toBeTruthy()
    expect(fetchedDirectories(fetchFake)).not.toContain('/repos/d')

    await user.click(screen.getByRole('button', { name: 'Delta' }))
    await waitFor(() => expect(capturedPathname.current).toBe('/repos/4'))
  })

  it('searches as you type across ready repos and clears with Escape', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTree({
      route: '/',
      repos: [
        repoA,
        repoB,
        makeRepo({
          id: 4,
          name: 'Delta',
          fullPath: '/repos/d',
          localPath: 'repos/d',
          cloneStatus: 'cloning',
          branch: undefined,
          currentBranch: undefined,
        }),
      ],
    })

    const input = await screen.findByLabelText('Search sessions')
    await screen.findByText('Alpha')
    await user.type(input, 'Session')

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toBeTruthy()
    await waitFor(() =>
      expect(
        sessionListRequests(fetchFake).some((request) => request.searchParams.get('search') === 'Session'),
      ).toBe(true),
    )
    const searchCall = sessionListRequests(fetchFake).find(
      (request) => request.searchParams.get('search') === 'Session',
    )
    const directories = sessionListRequests(fetchFake)
      .filter((request) => request.searchParams.get('search') === 'Session')
      .map((request) => request.searchParams.get('directory'))
    expect(directories.sort()).toEqual(['/repos/a', '/repos/b'])
    expect(searchCall?.searchParams.get('limit')).toBe('10')
    expect(
      sessionListRequests(fetchFake).some((request) => request.searchParams.get('search') === 'Sess'),
    ).toBe(false)
    expect(screen.getByRole('button', { name: /^Session b1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Show sessions in / })).toBeNull()

    await user.type(input, '{Escape}')

    expect(input).toHaveValue('')
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Session / })).toBeNull())
    expect(toggleFor('Alpha')).toBeTruthy()
  })

  it('filters loaded sessions by title immediately', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/' })

    const input = await screen.findByLabelText('Search sessions')
    await screen.findByText('Alpha')
    await user.type(input, 'a1')

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Session b1/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Session c1/ })).toBeNull()
  })

  it('clears an active search with the clear button', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/' })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'Session')
    await screen.findByRole('button', { name: /^Session a1/ })

    await user.click(screen.getByLabelText('Clear search'))

    expect(input).toHaveValue('')
    expect(screen.queryByLabelText('Clear search')).toBeNull()
    expect(toggleFor('Alpha')).toBeTruthy()
  })

  it('matches repo names and shows their recent sessions', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderTree({ route: '/' })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'bet')

    expect(await screen.findByRole('button', { name: /^Session b1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()
    await waitFor(() =>
      expect(
        sessionListRequests(fetchFake).some((request) => request.searchParams.get('search') === 'bet'),
      ).toBe(true),
    )
    const directories = sessionListRequests(fetchFake)
      .filter((request) => request.searchParams.get('search') === 'bet')
      .map((request) => request.searchParams.get('directory'))
    expect(directories.sort()).toEqual(['/repos/a', '/repos/c'])
  })

  it('restores the full list when the input is emptied', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/' })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'Session')
    await screen.findByRole('button', { name: /^Session a1/ })

    await user.clear(input)

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Session / })).toBeNull())
    expect(toggleFor('Alpha')).toBeTruthy()
  })

  it('shows the empty search state when a search returns nothing', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/', sessions: [createSession('a1', '/repos/a', Date.now())] })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'nothing')

    expect(await screen.findByText('No sessions found')).toBeTruthy()
  })

  it('shows the error state when the session search fails', async () => {
    const user = userEvent.setup()
    renderTree({ route: '/', sessionSearchError: true })

    const input = await screen.findByLabelText('Search sessions')
    await user.type(input, 'Session')

    expect(await screen.findByText('Failed to load sessions')).toBeTruthy()
  })

  it('shows the error state when the worktree siblings lookup fails', async () => {
    renderTree({ route: '/repos/1', siblingsError: true })

    expect(await screen.findByText('Failed to load sessions')).toBeTruthy()
  })

  it('creates a session in the repo full path', async () => {
    const { capturedPathname, fetchFake } = renderTree({ route: '/' })

    fireEvent.click(await screen.findByRole('button', { name: 'New session in Beta' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', '/api/opencode/api/session')?.body).toMatchObject({
        location: { directory: '/repos/b' },
      }),
    )
    await waitFor(() => expect(capturedPathname.current).toBe('/repos/2/sessions/new-session'))
  })

  it('renders permission and form badges for sessions with pending requests', async () => {
    const { eventStream } = renderTree({
      route: '/repos/1',
      sessions: [...defaultSessions, createSession('a2', '/repos/a', Date.now() - 1000)],
    })
    await connectTestEventStream(eventStream)
    await pushPendingActions(eventStream, { permissionSessionID: 'a1', formSessionID: 'a2' })

    await screen.findByRole('button', { name: /^Session a1/ })

    expect(await screen.findByLabelText('Pending permission')).toBeTruthy()
    expect(await screen.findByLabelText('Pending form')).toBeTruthy()
  })
})
