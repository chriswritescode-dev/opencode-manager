import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { MS_PER_MINUTE } from '@/lib/activeWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useActiveWork, useActiveWorkCounts } from './useActiveWork'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { makeOpenCodeServer, makeRepo, makeSession } from '@/test/fixtures/api'
import { connectTestEventStream, renderHookWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const REPO_PATH = '/repo'
const WINDOW_MS = 60 * MS_PER_MINUTE
const LOCAL_SESSION_PATH = '/api/opencode/api/session'
const REMOTE_SESSION_PATH = '/api/opencode/servers/srv_kitchen/api/session'

const repo = makeRepo({ id: 1, localPath: REPO_PATH, fullPath: REPO_PATH })
const kitchenServer = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen', enabled: true })

function session(id: string, updated: number, parentID?: string | null, directory = REPO_PATH): SessionInfo {
  const created = makeSession({
    id,
    title: `Session ${id}`,
    location: { directory },
    time: { created: updated, updated },
  })
  if (parentID === undefined) return created
  return { ...created, parentID }
}

function recentIDs(groups: { recent: Array<{ session: SessionInfo }> }): string[] {
  return groups.recent.map((item) => item.session.id)
}

function localListRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'GET', path: LOCAL_SESSION_PATH, respond }
}

function remoteListRoute(respond: FetchRoute['respond']): FetchRoute {
  return { method: 'GET', path: REMOTE_SESSION_PATH, respond }
}

function sessionByIdRoute(
  prefix: string,
  respond: (params: Record<string, string>) => FetchRouteResult,
): FetchRoute {
  return {
    method: 'GET',
    path: `${prefix}/session/:sessionId`,
    respond: (_request, params) => (
      params.sessionId === 'active' ? { json: { data: {} } } : respond(params)
    ),
  }
}

function renderActiveWork(routes: FetchRoute[], windowMs = WINDOW_MS) {
  return renderHookWithProviders(() => useActiveWork(windowMs), {
    events: true,
    fetchRoutes: [
      ...routes,
      ...appRoutes({ repos: [repo], servers: [kitchenServer] }),
    ],
  })
}

describe('useActiveWork', () => {
  beforeEach(() => {
    useSessionStatus.setState({
      statuses: new Map(),
      statusCache: new Map(),
      statusRevisions: new Map(),
      knownSessions: new Set(),
      outcomes: new Map(),
      parents: new Map(),
      directories: new Map(),
      sessionServers: new Map(),
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
    const { result, fetchFake } = renderActiveWork([
      localListRoute((request) => (request.searchParams.get('cursor') === 'page2'
        ? { json: { data: [session('root2', now - 1500)], cursor: {} } }
        : { json: { data: [session('a', now - 500), session('b', now - 1000)], cursor: { next: 'page2' } } })),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root2'))

    expect(fetchFake.lastRequest('GET', LOCAL_SESSION_PATH)?.searchParams.get('cursor')).toBe('page2')
  })

  it('does not request another page when the oldest loaded session is outside the window', async () => {
    const now = Date.now()
    const { result, fetchFake } = renderActiveWork([
      localListRoute(() => ({
        json: { data: [session('recent', now - 500), session('old', now - 2 * WINDOW_MS)], cursor: { next: 'page2' } },
      })),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('recent'))

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      fetchFake.findRequests('GET', LOCAL_SESSION_PATH).filter((request) => request.searchParams.get('cursor')),
    ).toHaveLength(0)
  })

  it('resolves an unlisted grandchild to its ancestor root', async () => {
    const now = Date.now()
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [session('G', now - 500, 'C')], cursor: {} } })),
      sessionByIdRoute('/api/opencode/api', (params) => {
        if (params.sessionId === 'C') return { json: { data: session('C', now - 1000, 'R') } }
        if (params.sessionId === 'R') return { json: { data: session('R', now - 1500, null) } }
        return { status: 404, json: { _tag: 'SessionNotFoundError', sessionID: params.sessionId, message: 'missing' } }
      }),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('R'))

    expect(recentIDs(result.current.groups)).not.toContain('C')
  })

  it('keeps groups referentially stable across a rerender', async () => {
    const now = Date.now()
    const { result, rerender } = renderActiveWork([
      localListRoute(() => ({ json: { data: [session('root', now - 500)], cursor: {} } })),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root'))

    const before = result.current.groups
    rerender()

    expect(result.current.groups).toBe(before)
  })

  it('drops a recent root once the clock advances past the window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const now = Date.now()
    const { result } = renderActiveWork(
      [localListRoute(() => ({ json: { data: [session('root', now - 1000)], cursor: {} } }))],
      MS_PER_MINUTE,
    )

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('root'))

    await act(async () => {
      vi.setSystemTime(now + 5 * MS_PER_MINUTE)
      vi.advanceTimersByTime(MS_PER_MINUTE)
    })

    expect(recentIDs(result.current.groups)).not.toContain('root')
  })

  it('resolves a session in a worktree to its owning repo and opens the workspaces tab', async () => {
    const now = Date.now()
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [session('wt', now - 500, undefined, '/repo/.worktrees/feature')], cursor: {} } })),
      {
        method: 'GET',
        path: '/api/repos/1/siblings',
        respond: () => ({
          json: [
            {
              ...repo,
              id: -1,
              localPath: 'feature',
              fullPath: '/repo/.worktrees/feature',
              sourcePath: '/repo/.worktrees/feature',
              currentBranch: 'feature',
              worktreeSource: 'opencode',
            },
          ],
        }),
      },
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('wt'))

    expect(result.current.groups.recent[0].repo.id).toBe(1)
    expect(result.current.groups.recent[0].path).toBe('/repos/1/sessions/wt?repoTab=workspaces')
  })

  it('reports an error when the worktree siblings lookup fails with no cached data', async () => {
    const now = Date.now()
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [session('wt', now - 500, undefined, '/repo/.worktrees/feature')], cursor: {} } })),
      {
        method: 'GET',
        path: '/api/repos/1/siblings',
        respond: () => ({ status: 500, json: { error: 'siblings failed' } }),
      },
    ])

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('never fetches siblings for an orphan session updated outside the window', async () => {
    const now = Date.now()
    const { result, fetchFake } = renderActiveWork([
      localListRoute(() => ({
        json: { data: [session('orphan', now - 2 * WINDOW_MS, undefined, '/outside/repo')], cursor: {} },
      })),
    ])

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchFake.findRequests('GET', '/api/repos/1/siblings')).toHaveLength(0)
  })

  it('counts a remote pending permission and shows one labelled remote row', async () => {
    const now = Date.now()
    const { result, eventStream } = renderHookWithProviders(
      () => ({ work: useActiveWork(WINDOW_MS), counts: useActiveWorkCounts() }),
      {
        events: true,
        fetchRoutes: [
          localListRoute(() => ({ json: { data: [], cursor: {} } })),
          remoteListRoute(() => ({ json: { data: [], cursor: {} } })),
          sessionByIdRoute('/api/opencode/servers/srv_kitchen/api', () => ({
            json: { data: session('ses_remote', now - 500, null, '/home/me/app') },
          })),
          ...appRoutes({ repos: [repo], servers: [kitchenServer] }),
        ],
      },
    )
    useSessionStatus.setState({
      sessionServers: new Map([['ses_remote', 'srv_kitchen']]),
      directories: new Map([['ses_remote', 'srv_kitchen|/home/me/app']]),
    })

    await connectTestEventStream(eventStream)
    act(() => {
      eventStream?.message({
        id: 'evt_permission',
        created: 1,
        type: 'permission.asked',
        data: {
          id: 'permission-1',
          sessionID: 'ses_remote',
          action: 'bash',
          resources: ['echo'],
          metadata: { directory: '/home/me/app' },
        },
        directory: '/home/me/app',
        serverId: 'srv_kitchen',
      })
    })

    await waitFor(() => expect(result.current.work.groups.needsInput).toHaveLength(1))

    const row = result.current.work.groups.needsInput[0]
    expect(result.current.counts).toEqual({ needsInput: 1, running: 0 })
    expect(row.serverId).toBe('srv_kitchen')
    expect(row.serverName).toBe('Kitchen')
    expect(row.repo).toBeNull()
    expect(row.path).toBe('/servers/srv_kitchen/sessions/ses_remote')
  })

  it('includes recent sessions from an enabled linked server with its server label and path', async () => {
    const now = Date.now()
    const { result, fetchFake } = renderActiveWork([
      localListRoute(() => ({ json: { data: [], cursor: {} } })),
      remoteListRoute(() => ({
        json: { data: [session('ses_remote_recent', now - 500, null, '/home/me/app')], cursor: {} },
      })),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('ses_remote_recent'))

    const row = result.current.groups.recent[0]
    expect(row.serverId).toBe('srv_kitchen')
    expect(row.serverName).toBe('Kitchen')
    expect(row.repo).toBeNull()
    expect(row.path).toBe('/servers/srv_kitchen/sessions/ses_remote_recent')
    const remoteRequest = fetchFake.lastRequest('GET', REMOTE_SESSION_PATH)
    expect(remoteRequest?.searchParams.get('limit')).toBe('50')
    expect(remoteRequest?.searchParams.get('order')).toBe('desc')
    expect(result.current.isError).toBe(false)
  })

  it('rolls a listed remote child up to a root fetched from the same server', async () => {
    const now = Date.now()
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [], cursor: {} } })),
      remoteListRoute(() => ({
        json: { data: [session('ses_remote_child', now - 500, 'ses_remote_root', '/home/me/app')], cursor: {} },
      })),
      {
        method: 'GET',
        path: '/api/opencode/servers/srv_kitchen/api/session/ses_remote_root',
        respond: () => ({ json: { data: session('ses_remote_root', now - 1500, null, '/home/me/app') } }),
      },
    ])

    await waitFor(() =>
      expect(result.current.groups.recent.map((item) => item.session.id)).toEqual(['ses_remote_root']),
    )

    expect(result.current.groups.recent[0].serverId).toBe('srv_kitchen')
  })

  it('keeps the local list when a linked server fails to load', async () => {
    const now = Date.now()
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [session('local_recent', now - 500)], cursor: {} } })),
      remoteListRoute(() => ({ status: 500, json: { error: 'server unreachable' } })),
    ])

    await waitFor(() => expect(recentIDs(result.current.groups)).toContain('local_recent'))

    expect(result.current.isError).toBe(false)
    expect(recentIDs(result.current.groups)).not.toContain('ses_remote_recent')
  })

  it('renders a running remote session row and resolves its ancestry on the owning server', async () => {
    const now = Date.now()
    useSessionStatus.setState({
      statuses: new Map([['ses_child', { type: 'busy' }]]),
      sessionServers: new Map([['ses_child', 'srv_kitchen']]),
      directories: new Map([['ses_child', 'srv_kitchen|/home/me/app']]),
    })
    const { result } = renderActiveWork([
      localListRoute(() => ({ json: { data: [], cursor: {} } })),
      remoteListRoute(() => ({ json: { data: [], cursor: {} } })),
      sessionByIdRoute('/api/opencode/servers/srv_kitchen/api', (params) => {
        if (params.sessionId === 'ses_child') return { json: { data: session('ses_child', now - 1000, 'ses_remote', '/home/me/app') } }
        if (params.sessionId === 'ses_remote') return { json: { data: session('ses_remote', now - 4000, null, '/home/me/app') } }
        return { status: 404, json: { _tag: 'SessionNotFoundError', sessionID: params.sessionId, message: 'missing' } }
      }),
    ])

    await waitFor(() => expect(result.current.groups.running).toHaveLength(1))

    expect(result.current.groups.running[0].session.id).toBe('ses_remote')
    expect(result.current.groups.running[0].serverName).toBe('Kitchen')
  })
})
