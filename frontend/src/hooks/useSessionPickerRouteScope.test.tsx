import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { useSessionPickerRouteScope } from './useSessionPickerRouteScope'
import { createTestQueryClient, renderHookWithProviders } from '@/test/render'
import type { QueryClient } from '@tanstack/react-query'
import { makeOpenCodeServer, makeSession } from '@/test/fixtures/api'
import { createSessionServer } from '@/test/fixtures/sessionServer'
import type { FetchRoute } from '@/test/fetchFake'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
  toaster: false,
} as const

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })
const remoteSessionPath = '/api/opencode/servers/srv_kitchen/api/session/ses_remote'
const remoteProjectsPath = '/api/opencode/servers/srv_kitchen/api/project'

const kitchenProject = {
  id: 'p1',
  name: 'App',
  canonical: '/home/me/app',
  time: { created: 1, updated: 2 },
  sandboxes: [],
}

function renderScope(entry: string, extraRoutes: FetchRoute[] = [], session = makeSession({
  id: 'ses_remote',
  location: { directory: '/home/me/app/packages/web' },
}), seed?: (queryClient: QueryClient) => void) {
  const server = createSessionServer({
    remoteServers: [kitchen],
    projects: [kitchenProject],
    remoteSessions: [session],
  })
  const queryClient = createTestQueryClient()
  seed?.(queryClient)
  return renderHookWithProviders(() => useSessionPickerRouteScope(true), {
    ...hookProviders,
    route: entry,
    queryClient,
    fetchRoutes: [...extraRoutes, ...server.routes],
  })
}

describe('useSessionPickerRouteScope', () => {
  beforeEach(() => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
  })

  it('resolves a session subdirectory to the canonical directory of its project', async () => {
    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote')

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/app'))
    expect(result.current.remote?.isPending).toBe(false)
    expect(result.current.remote?.serverName).toBe('Kitchen')
    expect(result.current.activeSessionID).toBe('ses_remote')
  })

  it('falls back to the session directory when no project owns it', async () => {
    const { result } = renderScope(
      '/servers/srv_kitchen/sessions/ses_remote',
      [],
      makeSession({ id: 'ses_remote', location: { directory: '/home/me/other' } }),
    )

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/other'))
    expect(result.current.remote?.isPending).toBe(false)
  })

  it('reports the scope as pending while the session directory resolves', async () => {
    const { result } = renderScope('/servers/srv_kitchen/sessions/ses_remote', [
      { method: 'GET', path: remoteSessionPath, respond: () => new Promise(() => {}) },
    ])

    await waitFor(() => expect(result.current.remote?.isPending).toBe(true))
    expect(result.current.remote?.projectDirectory).toBeUndefined()
  })

  it('reuses the session the open page already loaded', async () => {
    const { result, fetchFake } = renderScope(
      '/servers/srv_kitchen/sessions/ses_remote',
      [{ method: 'GET', path: remoteSessionPath, respond: () => new Promise(() => {}) }],
      makeSession({ id: 'ses_remote', location: { directory: '/home/me/app/packages/web' } }),
      (queryClient) => {
        queryClient.setQueryData(
          ['opencode', 'session', 'ses_remote', '/home/me/app/packages/web', 'srv_kitchen'],
          makeSession({ id: 'ses_remote', location: { directory: '/home/me/app/packages/web' } }),
        )
      },
    )

    await waitFor(() => expect(result.current.remote?.projectDirectory).toBe('/home/me/app'))
    expect(result.current.remote?.isPending).toBe(false)
    expect(fetchFake.findRequests('GET', remoteSessionPath)).toHaveLength(0)
  })

  it('scopes to the whole server on a route without a session', () => {
    const { result } = renderScope('/')

    expect(result.current.remote?.projectDirectory).toBeUndefined()
    expect(result.current.remote?.isPending).toBe(false)
    expect(result.current.activeSessionID).toBeUndefined()
  })

  it('resolves no linked-server scope for the local server', () => {
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })

    const { result, fetchFake } = renderScope('/repos/5/sessions/ses_local')

    expect(result.current.remote).toBeUndefined()
    expect(fetchFake.findRequests('GET', remoteSessionPath)).toHaveLength(0)
    expect(fetchFake.findRequests('GET', remoteProjectsPath)).toHaveLength(0)
  })
})
