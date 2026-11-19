import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { RemoteProject } from '../RemoteProject'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeOpenCodeServer, makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { OpenCodeProject } from '@/api/opencode'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'

const server = makeOpenCodeServer({
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
})

const project: OpenCodeProject = {
  id: 'prj_1',
  canonical: '/home/me/app',
  name: 'App',
  time: { created: 1, updated: 2, active: 2 },
  sandboxes: [],
}

const remoteSession = makeSession({ id: 'ses_42', title: 'Remote work', location: { directory: '/home/me/app' } })

interface RemoteProjectRenderOptions {
  route?: string
  servers?: OpenCodeServer[]
  projects?: OpenCodeProject[]
  sessions?: Array<ReturnType<typeof makeSession>>
  serversPending?: boolean
  offline?: boolean
  cachedServers?: OpenCodeServer[]
}

function buildRoutes(options: RemoteProjectRenderOptions): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/opencode-servers',
      respond: () => options.serversPending
        ? new Promise<never>(() => undefined)
        : { json: { servers: options.servers ?? [server] } },
    },
    { method: 'GET', path: '/api/opencode-servers/status', respond: () => ({ json: { statuses: [] } }) },
    {
      method: 'GET',
      path: '/api/opencode/servers/:serverId/api/project',
      respond: () => ({ json: options.projects ?? [project] }),
    },
    {
      method: 'GET',
      path: '/api/opencode/servers/:serverId/api/vcs',
      respond: () => ({ json: { data: { branch: { current: 'main', default: 'main' } } } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/servers/:serverId/api/session',
      respond: () => ({ json: { data: options.sessions ?? [remoteSession], cursor: {} } }),
    },
    {
      method: 'POST',
      path: '/api/opencode/servers/:serverId/api/session',
      respond: () => ({ json: { data: makeSession({ id: 'ses_new', title: 'New session', location: { directory: '/home/me/app' } }) } }),
    },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins: [] } }) },
  ]
}

function renderProject(options: RemoteProjectRenderOptions = {}) {
  const queryClient = createTestQueryClient()
  if (options.cachedServers) queryClient.setQueryData(['opencode-servers'], options.cachedServers)
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/" element={<div data-testid="home-route" />} />
        <Route path="/servers/:serverId/projects" element={<RemoteProject />} />
        <Route path="/servers/:serverId/sessions/:sessionId" element={<div data-testid="session-route" />} />
      </Routes>
    </>,
    {
      route: options.route ?? '/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp',
      queryClient,
      events: true,
      serverId: 'srv_kitchen',
      fetchRoutes: buildRoutes(options),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

function setOffline(offline: boolean) {
  onlineManager.setOnline(!offline)
}

describe('RemoteProject', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('renders the project name, server name and branch from the linked server', async () => {
    renderProject()

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.getByText('Kitchen')).toBeInTheDocument()
    expect(await screen.findByText('main')).toBeInTheDocument()
  })

  it('falls back to the directory name when the server does not list the project', async () => {
    renderProject({ projects: [] })

    expect(await screen.findByText('app')).toBeInTheDocument()
  })

  it('renders the sessions of the project directory', async () => {
    const { fetchFake } = renderProject()

    expect(await screen.findByText('Remote work')).toBeInTheDocument()
    expect(fetchFake.lastRequest('GET', '/api/opencode/servers/srv_kitchen/api/session')?.searchParams.get('directory')).toBe('/home/me/app')
  })

  it('opens a session from the session list on the remote session route', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderProject()

    await user.click(await screen.findByText('Remote work'))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_42'))
  })

  it('creates a session in the project directory and navigates to it', async () => {
    const user = userEvent.setup()
    const { fetchFake, capturedPathname } = renderProject()

    await user.click(await screen.findByRole('button', { name: 'New Session' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/servers/srv_kitchen/sessions/ses_new'))
    expect(fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/session')?.body).toMatchObject({
      location: { directory: '/home/me/app' },
    })
  })

  it('exposes the header actions with a single accessible name each', async () => {
    renderProject()

    expect(await screen.findByRole('button', { name: 'Schedules for /home/me/app' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Multi-run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeInTheDocument()
  })

  it('shows a missing-directory state without rendering the session list', async () => {
    const { fetchFake } = renderProject({ route: '/servers/srv_kitchen/projects' })

    expect(await screen.findByText('No project selected')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/session')).toHaveLength(0)
  })

  it('goes back to the projects list from the missing-directory state', async () => {
    const user = userEvent.setup()
    renderProject({ route: '/servers/srv_kitchen/projects' })

    await user.click(await screen.findByRole('button', { name: 'Back to projects' }))

    expect(screen.getByTestId('home-route')).toBeInTheDocument()
  })

  it('shows the disabled state without loading projects', async () => {
    const { fetchFake } = renderProject({ servers: [{ ...server, enabled: false }] })

    expect(await screen.findByText('This server is disabled')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/project')).toHaveLength(0)
    expect(screen.queryByText('Remote work')).not.toBeInTheDocument()
  })

  it('opens server settings from the disabled state', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderProject({ servers: [{ ...server, enabled: false }] })

    await user.click(await screen.findByRole('button', { name: 'Open server settings' }))

    await waitFor(() => expect(capturedSearch.current).toContain('settings=open'))
    expect(capturedSearch.current).toContain('settingsTab=servers')
  })

  it('shows the missing-server state', async () => {
    renderProject({ servers: [] })

    expect(await screen.findByText('Server not found')).toBeInTheDocument()
  })

  it('shows a loading state instead of a blank body while the server list restores', async () => {
    const { fetchFake } = renderProject({ serversPending: true })

    expect(await screen.findByRole('status', { name: 'Loading project' })).toBeInTheDocument()
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(fetchFake.findRequests('GET', '/api/opencode/servers/srv_kitchen/api/project')).toHaveLength(0)
  })

  it('shows an unavailable state instead of a missing server while the server list is paused offline', async () => {
    setOffline(true)

    const { fetchFake } = renderProject({ servers: [] })

    expect(await screen.findByText('Servers unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading project' })).not.toBeInTheDocument()
    const requestsWhileOffline = fetchFake.findRequests('GET', '/api/opencode-servers').length

    onlineManager.setOnline(true)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(fetchFake.findRequests('GET', '/api/opencode-servers').length).toBeGreaterThan(requestsWhileOffline)
    })
  })

  it('keeps the cached project while a server list refetch is paused offline', async () => {
    setOffline(true)

    renderProject({ cachedServers: [server], servers: [server] })

    expect(await screen.findByRole('button', { name: 'New Session' })).toBeInTheDocument()
    expect(screen.queryByText('Servers unavailable')).not.toBeInTheDocument()
  })

  it('goes back to the projects list', async () => {
    const user = userEvent.setup()
    renderProject()

    await user.click(await screen.findByRole('button', { name: 'Go back' }))

    expect(screen.getByTestId('home-route')).toBeInTheDocument()
  })
})
