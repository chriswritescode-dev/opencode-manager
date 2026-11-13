import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRemoteProjects, useRemoteProjectsByActivity } from './useRemoteProjects'
import { renderHookWithProviders } from '@/test/render'
import { makeSession, makeOpenCodeServer } from '@/test/fixtures/api'
import { createSessionServer } from '@/test/fixtures/sessionServer'
import type { OpenCodeProject } from '@/api/opencode'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })
const projectsPath = '/api/opencode/servers/srv_kitchen/api/project'

function createProject(
  id: string,
  time: { created: number; updated: number; active?: number },
): OpenCodeProject {
  return { id, name: id, canonical: `/work/${id}`, time, sandboxes: [] }
}

function projectServer(projects: OpenCodeProject[], servers = [kitchen]) {
  return createSessionServer({ projects, remoteServers: servers })
}

describe('useRemoteProjects', () => {
  it('lists the projects of the linked server, most recently updated first', async () => {
    const server = projectServer([
      createProject('stale', { created: 1, updated: 900, active: 100 }),
      createProject('recent', { created: 1, updated: 100, active: 900 }),
    ])

    const { result } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(2))
    expect(result.current.projects.map((project) => project.id)).toEqual(['stale', 'recent'])
  })

  it('does not fetch sessions for the canonical project lookup', async () => {
    const server = projectServer([createProject('app', { created: 1, updated: 2 })])

    const { result } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(1))
    expect(server.sessionRequests()).toHaveLength(0)
  })

  it('stays idle while the linked server is disabled', () => {
    const server = projectServer(
      [createProject('app', { created: 1, updated: 2 })],
      [{ ...kitchen, enabled: false }],
    )

    const { result, fetchFake } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    expect(result.current.showsInitialLoading).toBe(false)
    expect(result.current.projects).toEqual([])
    expect(fetchFake.findRequests('GET', projectsPath)).toHaveLength(0)
  })

  it('stays idle when the caller disables it', () => {
    const server = projectServer([createProject('app', { created: 1, updated: 2 })])

    const { fetchFake } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen', { enabled: false }), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    expect(fetchFake.findRequests('GET', projectsPath)).toHaveLength(0)
    expect(fetchFake.findRequests('GET', '/api/opencode-servers')).toHaveLength(0)
  })

  it('reports the initial loading state while nothing is cached, including a restored pending query', async () => {
    const pendingProjectsRoute: FetchRoute = {
      method: 'GET',
      path: projectsPath,
      respond: () => new Promise(() => {}),
    }

    const { result, fetchFake } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: [pendingProjectsRoute, ...createSessionServer({ remoteServers: [kitchen] }).routes],
    })

    await waitFor(() => expect(fetchFake.findRequests('GET', projectsPath)).toHaveLength(1))
    expect(result.current.showsInitialLoading).toBe(true)
    expect(result.current.showsError).toBe(false)
    expect(result.current.projects).toEqual([])
  })

  it('reports the error state only when the load failed with nothing cached', async () => {
    const route: FetchRoute = {
      method: 'GET',
      path: projectsPath,
      respond: () => ({ status: 400, json: { message: 'offline' } }),
    }

    const { result } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: [route, ...createSessionServer({ remoteServers: [kitchen] }).routes],
    })

    await waitFor(() => expect(result.current.showsError).toBe(true))
    expect(result.current.showsInitialLoading).toBe(false)
    expect(result.current.error?.message).toBe('offline')
  })

  it('keeps the cached projects and reports the failure when a refetch fails', async () => {
    let requests = 0
    const route: FetchRoute = {
      method: 'GET',
      path: projectsPath,
      respond: () => {
        requests += 1
        if (requests === 1) return { json: [createProject('app', { created: 1, updated: 2 })] }
        return { status: 400, json: { message: 'offline' } }
      },
    }

    const { result } = renderHookWithProviders(() => useRemoteProjects('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: [route, ...createSessionServer({ remoteServers: [kitchen] }).routes],
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(1))

    result.current.refetch()

    await waitFor(() => expect(result.current.error?.message).toBe('offline'))
    expect(result.current.showsError).toBe(false)
    expect(result.current.showsInitialLoading).toBe(false)
    expect(result.current.projects.map((project) => project.id)).toEqual(['app'])
  })
})

describe('useRemoteProjectsByActivity', () => {
  it('orders and dates projects by their newest session', async () => {
    const server = createSessionServer({
      remoteServers: [kitchen],
      projects: [
        createProject('idle', { created: 1, updated: 900, active: 999 }),
        createProject('worked', { created: 1, updated: 100, active: 999 }),
      ],
      remoteSessions: [makeSession({ id: 'ses_1', location: { directory: '/work/worked' }, time: { created: 1, updated: 500 } })],
    })

    const { result } = renderHookWithProviders(() => useRemoteProjectsByActivity('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.activityById.get('worked')).toBe(500))
    expect(result.current.projects.map((project) => project.id)).toEqual(['worked', 'idle'])
    expect(result.current.activityById.get('idle')).toBe(900)
  })

  it('sorts a project without a session after the session-backed ones', async () => {
    const server = createSessionServer({
      remoteServers: [kitchen],
      projects: [
        createProject('quiet', { created: 1, updated: 950 }),
        createProject('worked', { created: 1, updated: 100 }),
      ],
      remoteSessions: [makeSession({ id: 'ses_1', location: { directory: '/work/worked' }, time: { created: 1, updated: 300 } })],
    })

    const { result } = renderHookWithProviders(() => useRemoteProjectsByActivity('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.activityById.get('worked')).toBe(300))
    expect(result.current.projects.map((project) => project.id)).toEqual(['worked', 'quiet'])
  })

  it('fetches one session page per server, newest first and across every directory', async () => {
    const server = createSessionServer({
      remoteServers: [kitchen],
      projects: [
        createProject('alpha', { created: 1, updated: 10 }),
        createProject('beta', { created: 1, updated: 20 }),
        createProject('gamma', { created: 1, updated: 30 }),
      ],
    })

    const { result } = renderHookWithProviders(() => useRemoteProjectsByActivity('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    await waitFor(() => expect(result.current.projects).toHaveLength(3))
    await waitFor(() => expect(server.sessionRequests()).toHaveLength(1))

    const request = server.sessionRequests()[0]
    expect(request.searchParams.get('limit')).toBe('100')
    expect(request.searchParams.get('order')).toBe('desc')
    expect(request.searchParams.get('parentID')).toBe('null')
    expect(request.searchParams.get('directory')).toBeNull()
  })

  it('stays idle while the linked server is disabled', () => {
    const server = createSessionServer({
      remoteServers: [{ ...kitchen, enabled: false }],
      projects: [createProject('alpha', { created: 1, updated: 10 })],
    })

    const { result, fetchFake } = renderHookWithProviders(() => useRemoteProjectsByActivity('srv_kitchen'), {
      ...hookProviders,
      fetchRoutes: server.routes,
    })

    expect(result.current.projects).toEqual([])
    expect(fetchFake.findRequests('GET', projectsPath)).toHaveLength(0)
    expect(server.sessionRequests()).toHaveLength(0)
  })
})
