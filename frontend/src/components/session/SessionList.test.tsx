import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@/api/types'
import type { ReactNode } from 'react'
import { installElementScrollMetrics } from '@/test/browserFakes'
import { makeSession } from '@/test/fixtures/api'
import { createSessionServer, type SessionServer } from '@/test/fixtures/sessionServer'
import type { FetchRouteResult } from '@/test/fetchFake'
import { renderWithProviders } from '@/test/render'
import { SessionList, type SessionListRenderArgs } from './SessionList'

function session(id: string, title: string, directory: string, updated = Date.now(), parentID?: string) {
  const info = makeSession({
    id,
    title,
    location: { directory },
    time: { created: updated, updated },
  })
  if (parentID) info.parentID = parentID
  return info
}

function deferred() {
  let resolve: (result: FetchRouteResult) => void = () => undefined
  const promise = new Promise<FetchRouteResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

interface RenderSessionListOptions {
  server: SessionServer
  directories?: string[]
  createDirectory?: string
  renderSessions?: (args: SessionListRenderArgs) => ReactNode
  onSelectSession?: (sessionID: string) => void
}

function renderSessionList(options: RenderSessionListOptions) {
  return renderWithProviders(
    <SessionList
      directories={options.directories ?? ['/w/a']}
      createDirectory={options.createDirectory}
      onSelectSession={options.onSelectSession ?? vi.fn()}
      renderSessions={options.renderSessions}
    />,
    { auth: false, theme: false, tts: false, fetchRoutes: options.server.routes },
  )
}

function cursorRequests(server: SessionServer) {
  return server.sessionRequests().filter((request) => request.searchParams.has('cursor'))
}

function firstPage(limit: number) {
  return ({ sessions }: { sessions: Session[] }) => ({
    json: { data: sessions.slice(0, limit), cursor: { next: String(limit) } },
  })
}

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number) {
  const metrics = installElementScrollMetrics({ scrollHeight, clientHeight })
  metrics.setScrollTop(element, scrollTop)
  fireEvent.scroll(element)
}

describe('SessionList', () => {
  it('selects duplicate session IDs independently by directory', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({
      sessions: ['/w/a', '/w/b', '/w/c'].map((directory) => session('ses_same', 'duplicate', directory)),
    })
    const { fetchFake } = renderSessionList({ server, directories: ['/w/a', '/w/b', '/w/c'] })

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('3 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Sessions' })
    expect(screen.getByText('3')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(fetchFake.findRequests('DELETE', '/api/opencode/api/session/ses_same')).toHaveLength(3),
    )
  })

  it('deduplicates repeated session records from the same workspace directory', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({
      sessions: [
        session('ses_same', 'duplicate', '/w/a'),
        session('ses_same', 'duplicate', '/w/a'),
        session('ses_same', 'duplicate', '/w/a'),
      ],
    })
    const { fetchFake } = renderSessionList({ server, directories: ['/w/a', '/w/a', '/w/a'] })

    expect(await screen.findAllByText('duplicate')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Session' })).getByRole('button', { name: 'Delete' }),
    )

    await waitFor(() =>
      expect(fetchFake.findRequests('DELETE', '/api/opencode/api/session/ses_same')).toHaveLength(1),
    )
  })

  it('creates sessions in the explicit create directory and opens the new session', async () => {
    const user = userEvent.setup()
    const server = createSessionServer()
    const onSelectSession = vi.fn()
    renderSessionList({ server, directories: ['/w/a', '/w/b'], createDirectory: '/w/b', onSelectSession })

    await user.click(await screen.findByText('No sessions yet'))

    await waitFor(() => expect(onSelectSession).toHaveBeenCalledWith('ses_new'))
    expect(server.createdDirectories()).toEqual(['/w/b'])
  })

  it('passes the search query and page limit to the sessions request', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({ sessions: [session('ses_a', 'alpha', '/w/a')] })
    renderSessionList({ server })

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'deploy')

    await waitFor(() => {
      const request = server.sessionRequests().at(-1)
      expect(request?.searchParams.get('search')).toBe('deploy')
      expect(request?.searchParams.get('limit')).toBe('25')
    })
  })

  it('loads the next page when the list is near the bottom and more pages exist', async () => {
    const server = createSessionServer({
      sessions: Array.from({ length: 30 }, (_, index) =>
        session(`ses_${index}`, `session ${index}`, '/w/a', 1000 - index),
      ),
    })
    renderSessionList({ server })

    await waitFor(() => expect(cursorRequests(server)).toHaveLength(1))

    setScrollMetrics(screen.getByRole('region', { name: 'Sessions' }), 1000, 500, 300)

    expect(await screen.findByText('session 29')).toBeInTheDocument()
  })

  it('shows the loading-more state while a next page is in flight and does not request it twice', async () => {
    const nextPage = deferred()
    const server = createSessionServer({
      sessions: Array.from({ length: 30 }, (_, index) =>
        session(`ses_${index}`, `session ${index}`, '/w/a', 1000 - index),
      ),
      sessionPage: ({ page, sessions, limit }) => {
        if (page === 0) return firstPage(limit)({ sessions })
        return nextPage.promise
      },
    })
    renderSessionList({ server })

    expect(await screen.findByText('Loading more sessions...')).toBeInTheDocument()

    setScrollMetrics(screen.getByRole('region', { name: 'Sessions' }), 1000, 500, 300)

    expect(cursorRequests(server)).toHaveLength(1)
  })

  it('shows search-results empty state instead of the create-session card when search returns no results', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({ sessions: [session('ses_a', 'alpha', '/w/a')] })
    renderSessionList({ server })

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'nonexistent')

    expect(await screen.findByText('No sessions found')).toBeInTheDocument()
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Click here to start a new session')).not.toBeInTheDocument()
  })

  it('shows the create-session card when there are no sessions and no active search', async () => {
    renderSessionList({ server: createSessionServer() })

    await waitFor(() => expect(screen.getByText('No sessions yet')).toBeInTheDocument())
    expect(screen.getByText('Click here to start a new session')).toBeInTheDocument()
  })

  it('hands an empty list to a custom session renderer instead of the create-session card', async () => {
    const renderSessions = vi.fn(() => <p>Custom layout</p>)
    renderSessionList({ server: createSessionServer(), renderSessions })

    expect(await screen.findByText('Custom layout')).toBeInTheDocument()
    expect(screen.queryByText('No sessions yet')).toBeNull()
    expect(renderSessions).toHaveBeenCalledWith(
      expect.objectContaining({ sessions: [], searchQuery: '' }),
    )
  })

  it('shows the loading state instead of the create-session card while the first page is empty but more pages are pending', async () => {
    const server = createSessionServer({
      sessionPage: ({ page }) =>
        page === 0
          ? { json: { data: [], cursor: { next: '25' } } }
          : { json: { data: [], cursor: {} } },
    })
    renderSessionList({ server })

    expect(await screen.findByText('Loading sessions...')).toBeInTheDocument()
    expect(screen.queryByText('No sessions yet')).toBeNull()
  })

  it('shows the retry action instead of the loading state when the first page is empty and the next page failed', async () => {
    const server = createSessionServer({
      sessionPage: ({ page }) =>
        page === 0
          ? { json: { data: [], cursor: { next: '25' } } }
          : { status: 500, json: { error: 'boom' } },
    })
    renderSessionList({ server })

    expect(await screen.findByText('Failed to load sessions.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('Loading sessions...')).toBeNull()
  })

  it('auto-fetches the next page when all visible sessions are filtered out as child sessions', async () => {    const server = createSessionServer({
      sessionPage: ({ page }) =>
        page === 0
          ? {
              json: {
                data: [
                  session('child1', 'child session', '/w/a', 2, 'parent1'),
                  session('child2', 'child session 2', '/w/a', 1, 'parent2'),
                ],
                cursor: { next: '25' },
              },
            }
          : { json: { data: [], cursor: {} } },
    })
    renderSessionList({ server })

    await waitFor(() => expect(cursorRequests(server)).toHaveLength(1))
  })

  it('auto-fetches the next page when filtered sessions underfill the scroll viewport', async () => {
    const server = createSessionServer({
      sessions: [
        session('root1', 'root session 1', '/w/a', 5),
        session('root2', 'root session 2', '/w/a', 4),
        session('root3', 'root session 3', '/w/a', 3),
        session('root4', 'root session 4', '/w/a', 2),
        session('root5', 'root session 5', '/w/a', 1),
        ...Array.from({ length: 21 }, (_, index) =>
          session(`child${index}`, `child session ${index}`, '/w/a', index, `root${index}`),
        ),
      ],
    })
    installElementScrollMetrics({ scrollHeight: 300, clientHeight: 500 })
    renderSessionList({ server })

    await waitFor(() => expect(screen.getByText('root session 1')).toBeInTheDocument())
    setScrollMetrics(screen.getByRole('region', { name: 'Sessions' }), 300, 500, 0)
    await waitFor(() => expect(cursorRequests(server)).toHaveLength(1))
  })

  it('renders a pinned session under a Pinned heading and excludes it from Today', async () => {
    const pinnedAt = Date.now()
    const server = createSessionServer({
      sessions: [session('ses_a', 'pinned session', '/w/a', pinnedAt)],
      pins: [{ sessionId: 'ses_a', directory: '/w/a', pinnedAt }],
    })
    renderSessionList({ server })

    expect(await screen.findByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('pinned session')).toBeInTheDocument()
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('pins a session from the row action', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({ sessions: [session('ses_x', 'test session', '/w/a')] })
    const { fetchFake } = renderSessionList({ server })

    await user.click(await screen.findByRole('button', { name: 'Session actions' }))
    await user.click(screen.getByText('Pin to top'))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', '/api/session-pins')?.body).toEqual({
        sessionId: 'ses_x',
        directory: '/w/a',
        pinned: true,
      }),
    )
  })

  it('stops automatic pagination after a next-page failure and appends older roots on explicit retry', async () => {
    const user = userEvent.setup()
    const retry = deferred()
    let cursorAttempts = 0
    const server = createSessionServer({
      sessions: [
        ...Array.from({ length: 4 }, (_, index) =>
          session(`root${index}`, `root session ${index}`, '/w/a', 100 - index),
        ),
        ...Array.from({ length: 21 }, (_, index) =>
          session(`child${index}`, `child session ${index}`, '/w/a', 50 - index, `root${index}`),
        ),
      ],
      sessionPage: ({ page, sessions, limit }) => {
        if (page === 0) return firstPage(limit)({ sessions })
        cursorAttempts += 1
        return cursorAttempts === 1
          ? { status: 500, json: { error: 'persistent failure' } }
          : retry.promise
      },
    })
    renderSessionList({ server })

    await waitFor(() => expect(screen.getByText('Failed to load more sessions.')).toBeInTheDocument())
    expect(cursorRequests(server)).toHaveLength(1)
    expect(screen.queryByText('child session 0')).toBeNull()

    const scrollContainer = screen.getByRole('region', { name: 'Sessions' })
    setScrollMetrics(scrollContainer, 1000, 500, 300)
    setScrollMetrics(scrollContainer, 1000, 500, 300)

    expect(cursorRequests(server)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(cursorRequests(server)).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(screen.getByText('Loading more sessions...')).toBeInTheDocument()
    expect(screen.getByText('root session 0')).toBeInTheDocument()

    retry.resolve({
      json: { data: [session('older_root', 'older root session', '/w/a', 1)], cursor: {} },
    })

    expect(await screen.findByText('older root session')).toBeInTheDocument()
    expect(screen.getByText('root session 0')).toBeInTheDocument()
    expect(screen.queryByText('Failed to load more sessions.')).toBeNull()
  })

  it('filters rows by title immediately and keeps the search input focused', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({
      sessions: [session('ses_alpha', 'alpha task', '/w/a', 2), session('ses_beta', 'beta task', '/w/a', 1)],
    })
    renderSessionList({ server })

    const searchInput = screen.getByPlaceholderText('Search sessions...')
    await user.click(searchInput)
    await user.type(searchInput, 'alpha')

    expect(screen.getByText('alpha task')).toBeInTheDocument()
    expect(screen.queryByText('beta task')).toBeNull()
    expect(searchInput).toHaveFocus()
  })

  it('keeps the search input rendered while the first page is loading', async () => {
    const firstPageRequest = deferred()
    const server = createSessionServer({
      sessionPage: () => firstPageRequest.promise,
    })
    renderSessionList({ server })

    expect(screen.getByPlaceholderText('Search sessions...')).toBeInTheDocument()
    expect(await screen.findByText('Loading sessions...')).toBeInTheDocument()
  })

  it('keeps previous rows and the search input mounted while a new search query is fetching', async () => {
    const user = userEvent.setup()
    const searchPage = deferred()
    const server = createSessionServer({
      sessions: [session('ses_a', 'alpha session', '/w/a', 2), session('ses_b', 'beta session', '/w/a', 1)],
      sessionPage: ({ request }) =>
        request.searchParams.get('search') === 'beta' ? searchPage.promise : undefined,
    })
    renderSessionList({ server })

    expect(await screen.findByText('beta session')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'beta')

    expect(screen.getByText('beta session')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search sessions...')).toBeInTheDocument()
    expect(screen.queryByText('Loading sessions...')).toBeNull()

    searchPage.resolve({ json: { data: [session('ses_b', 'beta session', '/w/a', 1)], cursor: {} } })

    await waitFor(() => expect(screen.queryByText('alpha session')).toBeNull())
    expect(screen.getByText('beta session')).toBeInTheDocument()
  })

  it('shows the searching state while a search is pending and the empty state once it settles', async () => {
    const user = userEvent.setup()
    const server = createSessionServer({ sessions: [session('ses_a', 'alpha task', '/w/a', 1)] })
    renderSessionList({ server })

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'zzz')

    expect(screen.getByText('Searching sessions...')).toBeInTheDocument()
    expect(screen.queryByText('No sessions found')).toBeNull()

    expect(await screen.findByText('No sessions found')).toBeInTheDocument()
    expect(screen.queryByText('Searching sessions...')).toBeNull()
  })

  it('does not paginate while placeholder data is shown for a pending search', async () => {
    const user = userEvent.setup()
    const searchPage = deferred()
    const server = createSessionServer({
      sessions: Array.from({ length: 30 }, (_, index) =>
        session(`ses_${index}`, `session ${index}`, '/w/a', 1000 - index),
      ),
      sessionPage: ({ request }) =>
        request.searchParams.get('search') === 'zzz' ? searchPage.promise : undefined,
    })
    renderSessionList({ server })

    await waitFor(() => expect(screen.getByText('session 0')).toBeInTheDocument())
    await waitFor(() => expect(cursorRequests(server)).toHaveLength(1))

    await user.type(screen.getByPlaceholderText('Search sessions...'), 'zzz')
    fireEvent.scroll(screen.getByRole('region', { name: 'Sessions' }))

    await waitFor(() => expect(screen.getByText('Searching sessions...')).toBeInTheDocument())
    expect(cursorRequests(server)).toHaveLength(1)
  })
})
