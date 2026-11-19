import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { useSessionSearch } from './useSessionSearch'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { FetchFake, FetchRoute, RecordedFetchRequest } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const SESSION_ROUTE = '/api/opencode/api/session'
const HELPER_ROUTE = '/api/change-walkthroughs/helper-sessions'

interface SessionServer {
  routes: FetchRoute[]
  setSessions: (sessions: SessionInfo[]) => void
  setNextCursor: (cursor: string | null) => void
  setFailure: (failure: { status: number } | null) => void
  setHelperSessionIds: (ids: string[]) => void
  deferNextPage: () => () => void
}

function sessionServer(initial: SessionInfo[] = []): SessionServer {
  let sessions = initial
  let nextCursor: string | null = null
  let failure: { status: number } | null = null
  let helperSessionIds: string[] = []
  let pendingNextPage: Promise<void> | null = null

  return {
    setSessions: (next) => {
      sessions = next
    },
    setNextCursor: (next) => {
      nextCursor = next
    },
    setFailure: (next) => {
      failure = next
    },
    setHelperSessionIds: (ids) => {
      helperSessionIds = ids
    },
    deferNextPage: () => {
      let release = () => {}
      pendingNextPage = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        pendingNextPage = null
        release()
      }
    },
    routes: [
      {
        method: 'GET',
        path: SESSION_ROUTE,
        respond: async (request) => {
          if (request.searchParams.get('cursor') !== null && pendingNextPage) await pendingNextPage
          if (failure) return { status: failure.status, json: { error: 'failed' } }
          const search = request.searchParams.get('search')?.toLowerCase() ?? ''
          const data = search
            ? sessions.filter((session) => (session.title ?? '').toLowerCase().includes(search))
            : sessions
          return { json: { data, cursor: nextCursor === null ? {} : { next: nextCursor } } }
        },
      },
      {
        method: 'GET',
        path: HELPER_ROUTE,
        respond: () => ({ json: { sessionIds: helperSessionIds } }),
      },
    ],
  }
}

function makeTestSession(id: string, title: string, directory: string, updated: number): SessionInfo {
  return makeSession({ id, title, location: { directory }, time: { created: updated - 10, updated } })
}

function sessionRequests(fetchFake: FetchFake): RecordedFetchRequest[] {
  return fetchFake.findRequests('GET', SESSION_ROUTE)
}

function lastSessionRequest(fetchFake: FetchFake): RecordedFetchRequest | undefined {
  const requests = sessionRequests(fetchFake)
  return requests[requests.length - 1]
}

function renderSearch(
  directories: string[],
  options: Parameters<typeof useSessionSearch>[1],
  server: SessionServer,
) {
  return renderHookWithProviders(() => useSessionSearch(directories, options), {
    ...hookProviders,
    fetchRoutes: server.routes,
  })
}

describe('useSessionSearch', () => {
  let server: SessionServer

  beforeEach(() => {
    server = sessionServer([
      makeTestSession('ses_alpha', 'alpha task', '/w/a', 2),
      makeTestSession('ses_beta', 'beta task', '/w/a', 1),
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters sessions locally by title immediately', async () => {
    const { result, fetchFake } = renderSearch(['/w/a'], {}, server)

    await waitFor(() => expect(result.current.filteredSessions).toHaveLength(2))

    act(() => {
      result.current.setQuery('alpha')
    })

    expect(result.current.filteredSessions.map((session) => session.title)).toEqual(['alpha task'])
    expect(lastSessionRequest(fetchFake)?.searchParams.get('search')).toBeNull()
  })

  it('passes the debounced search to the session list request', async () => {
    vi.useFakeTimers()
    const { result, fetchFake } = renderSearch(['/w/a'], {}, server)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      result.current.setQuery('deploy')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    const request = lastSessionRequest(fetchFake)
    expect(request?.searchParams.get('search')).toBe('deploy')
    expect(request?.searchParams.get('limit')).toBe('25')
  })

  it('reports a pending search before the debounce settles', async () => {
    vi.useFakeTimers()
    const { result } = renderSearch(['/w/a'], {}, server)

    act(() => {
      result.current.setQuery('deploy')
    })

    expect(result.current.isSearchPending).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isSearchPending).toBe(false)
  })

  it('omits the directory filter when reading all directories', async () => {
    const { fetchFake } = renderSearch(['/w/a'], { allDirectories: true }, server)

    await waitFor(() => expect(sessionRequests(fetchFake).length).toBeGreaterThan(0))

    expect(lastSessionRequest(fetchFake)?.searchParams.get('directory')).toBeNull()
  })

  it('forwards a project scope and skips directory filtering', async () => {
    server.setSessions([
      makeTestSession('ses_root', 'root', '/w/a', 2),
      makeTestSession('ses_wt', 'worktree', '/w/other', 1),
    ])
    const { result, fetchFake } = renderSearch(['/w/a'], { project: { id: 'proj_x', subpath: '' } }, server)

    await waitFor(() => expect(result.current.filteredSessions).toHaveLength(2))

    expect(result.current.filteredSessions.map((session) => session.id)).toEqual(['ses_root', 'ses_wt'])
    const request = lastSessionRequest(fetchFake)
    expect(request?.searchParams.get('project')).toBe('proj_x')
    expect(request?.searchParams.get('directory')).toBeNull()
  })

  it('hides walkthrough helper sessions from the session list', async () => {
    server.setSessions([
      makeTestSession('ses_user', 'user task', '/w/a', 2),
      makeTestSession('ses_walk', 'Walkthrough · user task', '/w/a', 1),
    ])
    server.setHelperSessionIds(['ses_walk'])

    const { result } = renderSearch(['/w/a'], {}, server)

    await waitFor(() => expect(result.current.filteredSessions.map((session) => session.id)).toEqual(['ses_user']))
  })

  it('passes a session list failure through', async () => {
    server.setFailure({ status: 500 })

    const { result } = renderSearch(['/w/a'], {}, server)

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('blocks pagination while a search is pending', async () => {
    server.setNextCursor('cursor_1')
    vi.useFakeTimers()
    const { result } = renderSearch(['/w/a'], {}, server)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.canFetchNextPage).toBe(true)

    act(() => {
      result.current.setQuery('deploy')
    })

    expect(result.current.isSearchPending).toBe(true)
    expect(result.current.canFetchNextPage).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isSearchPending).toBe(false)
    expect(result.current.canFetchNextPage).toBe(true)
  })

  it('blocks pagination while the next page is still loading', async () => {
    server.setNextCursor('cursor_1')
    const { result } = renderSearch(['/w/a'], {}, server)

    await waitFor(() => expect(result.current.canFetchNextPage).toBe(true))

    const release = server.deferNextPage()
    act(() => {
      void result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(true))
    expect(result.current.canFetchNextPage).toBe(false)

    await act(async () => {
      release()
      await Promise.resolve()
    })
  })

  it('blocks pagination when the next page fails', async () => {
    server.setNextCursor('cursor_1')
    const { result } = renderSearch(['/w/a'], {}, server)

    await waitFor(() => expect(result.current.canFetchNextPage).toBe(true))

    server.setFailure({ status: 500 })
    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true))
    expect(result.current.canFetchNextPage).toBe(false)
  })
})
