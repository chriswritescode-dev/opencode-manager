import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import {
  useChildSessionReconciliation,
  useCreateSession,
  useDeleteSession,
  useSession,
  useSessionsAcrossDirectories,
} from './useOpenCode'
import { FetchError } from '../api/fetchWrapper'
import { useSessionStatus } from '../stores/sessionStatusStore'
import { renderHookWithProviders } from '@/test/render'
import { makeSession } from '@/test/fixtures/api'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const SESSION_PATH = '/api/opencode/api/session'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

function sessionInfo(id: string, directory: string, updated = 1000): SessionInfo {
  return makeSession({ id, title: `Session ${id}`, location: { directory }, time: { created: 1000, updated } })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function sessionListRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'GET', path: SESSION_PATH, respond }
}

function requestDirectories(fetchFake: ReturnType<typeof import('@/test/fetchFake').createFetchFake>): string[] {
  return fetchFake.findRequests('GET', SESSION_PATH).map((request) => request.searchParams.get('directory') ?? '')
}

describe('useSessionsAcrossDirectories', () => {
  it('pages sessions across two directories through the facade', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useSessionsAcrossDirectories(['/w/a', '/w/b']), {
      ...hookProviders,
      fetchRoutes: [
        sessionListRoute((request) => {
          const directory = request.searchParams.get('directory')
          if (request.searchParams.get('cursor') === 'cursor_a') {
            return { json: { data: [sessionInfo('ses_a2', '/w/a', 2000)], cursor: {} } }
          }
          return directory === '/w/a'
            ? { json: { data: [sessionInfo('ses_a1', '/w/a')], cursor: { next: 'cursor_a' } } }
            : { json: { data: [sessionInfo('ses_b1', '/w/b')], cursor: {} } }
        }),
      ],
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1', 'ses_b1'])
    expect(result.current.hasNextPage).toBe(true)
    expect(requestDirectories(fetchFake).sort()).toEqual(['/w/a', '/w/b'])

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.data).toHaveLength(3))

    const pageRequest = fetchFake.lastRequest('GET', SESSION_PATH)
    expect(pageRequest?.searchParams.get('directory')).toBe('/w/a')
    expect(pageRequest?.searchParams.get('cursor')).toBe('cursor_a')
    expect(pageRequest?.searchParams.get('parentID')).toBe('null')
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1', 'ses_b1', 'ses_a2'])
  })

  it('passes the trimmed search to every directory page', async () => {
    const { fetchFake } = renderHookWithProviders(
      () => useSessionsAcrossDirectories(['/w/a'], { search: '  deploy  ' }),
      {
        ...hookProviders,
        fetchRoutes: [sessionListRoute(() => ({ json: { data: [], cursor: {} } }))],
      },
    )

    await waitFor(() => expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(1))
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('search')).toBe('deploy')
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('parentID')).toBe('null')
  })

  it('issues one call per page across all directories and paginates by cursor', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionsAcrossDirectories(['/w/a', '/w/b'], { allDirectories: true }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute((request) => {
            if (request.searchParams.get('cursor') === 'cursor_all') {
              return { json: { data: [sessionInfo('ses_all2', '/w/b', 2000)], cursor: {} } }
            }
            return { json: { data: [sessionInfo('ses_all1', '/w/a')], cursor: { next: 'cursor_all' } } }
          }),
        ],
      },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(1)
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('directory')).toBeNull()
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_all1'])
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.data).toHaveLength(2))

    expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(2)
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('cursor')).toBe('cursor_all')
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_all1', 'ses_all2'])
  })

  it('queries all directories when allDirectories is set without a directory scope', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionsAcrossDirectories([], { allDirectories: true }),
      {
        ...hookProviders,
        fetchRoutes: [sessionListRoute(() => ({ json: { data: [sessionInfo('ses_all', '/w/a')], cursor: {} } }))],
      },
    )

    expect(result.current.isPending).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isPending).toBe(false)
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('directory')).toBeNull()
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_all'])
  })

  it('requests root-only and include-children lists as distinct cache entries', async () => {
    const { queryClient, fetchFake } = renderHookWithProviders(
      () => ({
        rootOnly: useSessionsAcrossDirectories(['/w/a']),
        withChildren: useSessionsAcrossDirectories(['/w/a'], { includeChildren: true }),
      }),
      {
        ...hookProviders,
        fetchRoutes: [sessionListRoute(() => ({ json: { data: [], cursor: {} } }))],
      },
    )

    await waitFor(() => expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(2))

    const parentIdFilters = fetchFake.findRequests('GET', SESSION_PATH).map(
      (request) => request.searchParams.get('parentID'),
    )
    expect(parentIdFilters.sort()).toEqual(['null', null])
    const optionKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey[3])
    expect(optionKeys).toHaveLength(2)
  })

  it('pages a project scope through one cursor query with project and subpath', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => useSessionsAcrossDirectories(['/w/a'], { project: { id: 'proj_x', subpath: '' } }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute((request) => {
            if (request.searchParams.get('cursor') === 'cursor_project') {
              return { json: { data: [sessionInfo('ses_wt', '/w/worktrees/alpha-feature', 2000)], cursor: {} } }
            }
            return { json: { data: [sessionInfo('ses_root', '/w/a')], cursor: { next: 'cursor_project' } } }
          }),
        ],
      },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(1)
    const projectRequest = fetchFake.lastRequest('GET', SESSION_PATH)
    expect(projectRequest?.searchParams.get('project')).toBe('proj_x')
    expect(projectRequest?.searchParams.get('subpath')).toBe('')
    expect(projectRequest?.searchParams.get('directory')).toBeNull()
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_root'])

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(2)
    expect(fetchFake.lastRequest('GET', SESSION_PATH)?.searchParams.get('cursor')).toBe('cursor_project')
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_root', 'ses_wt'])
  })

  it('deletes a session through the facade and removes it from the rendered list without refetching', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => ({
        list: useSessionsAcrossDirectories(['/w/a']),
        remove: useDeleteSession(['/w/a']),
      }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute(() => ({
            json: { data: [sessionInfo('ses_a1', '/w/a'), sessionInfo('ses_a2', '/w/a')], cursor: {} },
          })),
          { method: 'DELETE', path: `${SESSION_PATH}/ses_a1`, respond: () => ({ status: 204 }) },
        ],
      },
    )

    await waitFor(() => expect(result.current.list.data.map((session) => session.id)).toEqual(['ses_a1', 'ses_a2']))

    await act(async () => {
      await result.current.remove.mutateAsync({ id: 'ses_a1', directory: '/w/a' })
    })

    await waitFor(() => expect(result.current.list.data.map((session) => session.id)).toEqual(['ses_a2']))
    expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(1)
    expect(await screen.findByText('Session deleted')).toBeInTheDocument()
  })

  it('refreshes the session list when a delete fails', async () => {
    const { result, fetchFake } = renderHookWithProviders(
      () => ({
        list: useSessionsAcrossDirectories(['/w/a']),
        remove: useDeleteSession(['/w/a']),
      }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute(() => ({ json: { data: [sessionInfo('ses_a1', '/w/a')], cursor: {} } })),
          { method: 'DELETE', path: `${SESSION_PATH}/ses_a1`, respond: () => ({ status: 500, json: { error: 'nope' } }) },
        ],
      },
    )

    await waitFor(() => expect(result.current.list.data).toHaveLength(1))

    await act(async () => {
      await expect(
        result.current.remove.mutateAsync({ id: 'ses_a1', directory: '/w/a' }),
      ).rejects.toThrow('Failed to delete 1 session(s)')
    })

    await waitFor(() => expect(fetchFake.findRequests('GET', SESSION_PATH)).toHaveLength(2))
  })

  it('does not keep previous results across a search change unless requested', async () => {
    const pendingSearch = deferred<FetchRouteResult>()
    const { result, rerender } = renderHookWithProviders(
      () => useSessionsAcrossDirectories(['/w/a'], { search: 'deploy' }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute((request) => (request.searchParams.get('search') === 'deploy'
            ? pendingSearch.promise
            : { json: { data: [sessionInfo('ses_a1', '/w/a')], cursor: {} } })),
        ],
      },
    )

    expect(result.current.isPlaceholderData).toBe(false)
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toHaveLength(0)

    await act(async () => {
      pendingSearch.resolve({ json: { data: [sessionInfo('ses_b1', '/w/a')], cursor: {} } })
    })

    await waitFor(() => expect(result.current.data.map((session) => session.id)).toEqual(['ses_b1']))
    rerender()
  })

  it('keeps previous results across a search change when requested', async () => {
    const pendingSearch = deferred<FetchRouteResult>()
    let search: string | undefined = undefined
    const { result, rerender } = renderHookWithProviders(
      () => useSessionsAcrossDirectories(['/w/a'], { search, keepPreviousResults: true }),
      {
        ...hookProviders,
        fetchRoutes: [
          sessionListRoute((request) => (request.searchParams.get('search') === 'deploy'
            ? pendingSearch.promise
            : { json: { data: [sessionInfo('ses_a1', '/w/a')], cursor: {} } })),
        ],
      },
    )

    await waitFor(() => expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1']))

    search = 'deploy'
    rerender()

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true))
    expect(result.current.data.map((session) => session.id)).toEqual(['ses_a1'])

    await act(async () => {
      pendingSearch.resolve({ json: { data: [sessionInfo('ses_b1', '/w/a')], cursor: {} } })
    })

    await waitFor(() => expect(result.current.data.map((session) => session.id)).toEqual(['ses_b1']))
    expect(result.current.isPlaceholderData).toBe(false)
  })
})

describe('useSession', () => {
  it('maps a deleted session to a non-retried 404 through the real facade', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useSession('ses_missing', '/w/a'), {
      ...hookProviders,
      fetchRoutes: [
        {
          method: 'GET',
          path: `${SESSION_PATH}/ses_missing`,
          respond: () => ({
            status: 404,
            json: { _tag: 'SessionNotFoundError', sessionID: 'ses_missing', message: 'Session not found' },
          }),
        },
      ],
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(FetchError)
    expect(result.current.error?.statusCode).toBe(404)
    expect(fetchFake.findRequests('GET', `${SESSION_PATH}/ses_missing`)).toHaveLength(1)
  })
})

describe('useCreateSession', () => {
  const createRoute = (path = SESSION_PATH): FetchRoute => ({
    method: 'POST',
    path,
    respond: () => ({ json: { data: sessionInfo('ses_new', '/w/a') } }),
  })

  it('refuses to create a session without a directory and reports the error', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useCreateSession(undefined), {
      ...hookProviders,
      fetchRoutes: [createRoute()],
    })

    await act(async () => {
      await expect(result.current.mutateAsync({ agent: undefined })).rejects.toThrow(
        'A directory is required to create a session',
      )
    })

    expect(fetchFake.findRequests('POST', SESSION_PATH)).toHaveLength(0)
    expect(await screen.findByText('A directory is required to create a session')).toBeInTheDocument()
  })

  it('creates a session in the provided directory', async () => {
    const { result, fetchFake } = renderHookWithProviders(() => useCreateSession('/w/a'), {
      ...hookProviders,
      fetchRoutes: [createRoute()],
    })

    await act(async () => {
      await result.current.mutateAsync({ agent: undefined })
    })

    expect(fetchFake.lastRequest('POST', SESSION_PATH)?.body).toEqual({ location: { directory: '/w/a' } })
  })

  it('creates a session on an explicit server for a caller outside the server scope', async () => {
    const remotePath = '/api/opencode/servers/srv_kitchen/api/session'
    const { result, fetchFake } = renderHookWithProviders(
      () => useCreateSession('/srv/kitchen', undefined, 'srv_kitchen'),
      { ...hookProviders, fetchRoutes: [createRoute(remotePath)] },
    )

    await act(async () => {
      await result.current.mutateAsync({ agent: undefined })
    })

    expect(fetchFake.lastRequest('POST', remotePath)?.body).toEqual({ location: { directory: '/srv/kitchen' } })
  })
})

describe('useChildSessionReconciliation', () => {
  beforeEach(() => {
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      revision: 0,
    })
  })

  const idleSession = (): SessionInfo => ({
    ...sessionInfo('child-1', '/repo', 2000),
    time: { created: 1000, updated: 2000, idle: 2000 },
  })

  const childRoute = (respond: FetchRoute['respond']): FetchRoute => ({
    method: 'GET',
    path: `${SESSION_PATH}/child-1`,
    respond,
  })

  it('applies one guarded snapshot for multiple observers sharing one fetch', async () => {
    const pendingSession = deferred<FetchRouteResult>()
    const { fetchFake } = renderHookWithProviders(
      () => ({
        first: useChildSessionReconciliation('child-1'),
        second: useChildSessionReconciliation('child-1'),
      }),
      { ...hookProviders, fetchRoutes: [childRoute(() => pendingSession.promise)] },
    )

    await waitFor(() => expect(fetchFake.findRequests('GET', `${SESSION_PATH}/child-1`)).toHaveLength(1))

    await act(async () => {
      pendingSession.resolve({ json: { data: idleSession() } })
    })

    await waitFor(() => expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' }))
    expect(fetchFake.findRequests('GET', `${SESSION_PATH}/child-1`)).toHaveLength(1)
    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
  })

  it('releases the snapshot when unmounted while the request is pending', async () => {
    const pendingSession = deferred<FetchRouteResult>()
    const { unmount } = renderHookWithProviders(() => useChildSessionReconciliation('child-1'), {
      ...hookProviders,
      fetchRoutes: [childRoute(() => pendingSession.promise)],
    })

    act(() => {
      useSessionStatus.getState().setStatus('child-1', { type: 'busy' })
    })
    expect(useSessionStatus.getState().statusRevisions.size).toBeGreaterThan(0)

    unmount()

    await act(async () => {
      pendingSession.resolve({ json: { data: idleSession() } })
    })

    await waitFor(() => expect(useSessionStatus.getState().statusRevisions.size).toBe(0))
  })

  it('clears a stale child outcome when the fresh snapshot is busy', async () => {
    useSessionStatus.getState().setStatus('child-1', { type: 'busy' })
    useSessionStatus.getState().setOutcome('child-1', 'failed')
    const { fetchFake } = renderHookWithProviders(() => useChildSessionReconciliation('child-1'), {
      ...hookProviders,
      fetchRoutes: [childRoute(() => ({ json: { data: sessionInfo('child-1', '/repo') } }))],
    })

    await waitFor(() => expect(fetchFake.findRequests('GET', `${SESSION_PATH}/child-1`)).toHaveLength(1))
    await waitFor(() => expect(useSessionStatus.getState().statuses.get('child-1')).toEqual({ type: 'busy' }))
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBeUndefined()
  })

  it('does not reconcile a child whose lifecycle is already terminal', async () => {
    useSessionStatus.getState().setStatus('child-1', { type: 'idle' })
    const { fetchFake } = renderHookWithProviders(() => useChildSessionReconciliation('child-1'), {
      ...hookProviders,
      fetchRoutes: [childRoute(() => ({ json: { data: idleSession() } }))],
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchFake.findRequests('GET', `${SESSION_PATH}/child-1`)).toHaveLength(0)
  })
})
