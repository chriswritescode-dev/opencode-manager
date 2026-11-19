import { beforeEach, describe, expect, it } from 'vitest'
import { authClient } from '@/lib/auth-client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { useSidebarServerRouteSync, useSidebarServerSelection } from './useSidebarServerSelection'
import { SIDEBAR_SERVER_STORAGE_KEY, useSidebarServerStore } from '@/stores/sidebarServerStore'
import { renderWithProviders } from '@/test/render'
import type { TestAuthMode } from '@/test/render'
import { makeAuthSession, makeOpenCodeServer } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const SERVERS_ROUTE = '/api/opencode-servers'

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen', baseUrl: 'https://kitchen.example.com' })
const office = makeOpenCodeServer({ id: 'srv_office', name: 'Office', baseUrl: 'https://kitchen.example.com' })

function serversRoute(servers: OpenCodeServer[]): FetchRoute {
  return { method: 'GET', path: SERVERS_ROUTE, respond: () => ({ json: { servers } }) }
}

const failingServersRoute: FetchRoute = {
  method: 'GET',
  path: SERVERS_ROUTE,
  respond: () => ({ status: 500, json: { error: 'offline' } }),
}

function RouteSync() {
  useSidebarServerRouteSync()
  return null
}

function SelectionHarness({ syncRoute = true }: { syncRoute?: boolean }) {
  const [serverId, selectServer] = useSidebarServerSelection()
  const navigate = useNavigate()

  return (
    <>
      {syncRoute ? <RouteSync /> : null}
      <div data-testid="selected">{serverId}</div>
      <button type="button" onClick={() => selectServer('srv_kitchen')}>
        Select kitchen
      </button>
      <button type="button" onClick={() => navigate('/repos/2')}>
        Go to repo
      </button>
      <button type="button" onClick={() => navigate('/servers/srv_office')}>
        Go to office
      </button>
    </>
  )
}

function RouteOnlyHarness() {
  useSidebarServerRouteSync()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <>
      <div data-testid="location">{pathname}</div>
      <button
        type="button"
        onClick={() => navigate('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha')}
      >
        Open remote project
      </button>
      <button type="button" onClick={() => navigate('/')}>
        Go home
      </button>
    </>
  )
}

interface RenderOptions {
  syncRoute?: boolean
  servers?: OpenCodeServer[]
  serversRouteOverride?: FetchRoute
  auth?: TestAuthMode
}

function renderHarness(initialEntry = '/', options: RenderOptions = {}) {
  return renderWithProviders(<SelectionHarness syncRoute={options.syncRoute} />, {
    route: initialEntry,
    auth: options.auth ?? 'authenticated',
    fetchRoutes: [options.serversRouteOverride ?? serversRoute(options.servers ?? [kitchen, office])],
  })
}

function signedInSession() {
  return { data: makeAuthSession(), error: null, isPending: false, isRefetching: false }
}

function signedOutSession() {
  return { data: null, error: null, isPending: false, isRefetching: false }
}

function storedSelection(): string | null {
  return JSON.parse(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY) ?? 'null')
}

describe('useSidebarServerSelection', () => {
  beforeEach(() => {
    authClient.$store.atoms.session.set(signedInSession())
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('defaults to the local server', () => {
    renderHarness('/', { syncRoute: false })

    expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID)
  })

  it('persists the selection', () => {
    renderHarness('/', { syncRoute: false })

    fireEvent.click(screen.getByRole('button', { name: 'Select kitchen' }))

    expect(storedSelection()).toBe('srv_kitchen')
  })

  it('does not follow the route without the route sync', () => {
    renderHarness('/servers/srv_kitchen', { syncRoute: false })

    expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID)
  })
})

describe('useSidebarServerRouteSync', () => {
  beforeEach(() => {
    authClient.$store.atoms.session.set(signedInSession())
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  })

  it('selects the server named by a linked server route', async () => {
    renderHarness('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha')

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen'))
  })

  it('selects local on a local repo route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderHarness('/repos/1')

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('keeps a persisted linked selection on the home route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderHarness('/')

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen'))
  })

  it('keeps a manual selection while the local route stays unchanged', async () => {
    renderHarness('/repos/1')

    fireEvent.click(screen.getByRole('button', { name: 'Select kitchen' }))

    expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen')
  })

  it('follows a navigation to another linked server', async () => {
    renderHarness('/servers/srv_kitchen')

    fireEvent.click(screen.getByRole('button', { name: 'Go to office' }))

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_office'))
  })

  it('follows a navigation back to a local route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    renderHarness('/servers/srv_kitchen')

    fireEvent.click(screen.getByRole('button', { name: 'Go to repo' }))

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('falls back to local when the selected server is disabled', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_office' })

    renderHarness('/', { servers: [kitchen, makeOpenCodeServer({ ...office, enabled: false })] })

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('keeps the persisted server when the server list fails to load', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderHarness('/', { serversRouteOverride: failingServersRoute })

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen'))
    expect(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY)).toBeNull()
  })

  it('falls back to local when the selected server no longer exists', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_gone' })

    renderHarness()

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
    expect(storedSelection()).toBe(LOCAL_OPENCODE_SERVER_ID)
  })

  it('does not load the server list while unauthenticated', async () => {
    authClient.$store.atoms.session.set(signedOutSession())
    const { fetchFake } = renderHarness('/', { auth: 'anonymous' })

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID))
    expect(fetchFake.findRequests('GET', SERVERS_ROUTE)).toHaveLength(0)
  })

  it('follows a linked server route with no sidebar consumer mounted', async () => {
    renderWithProviders(<RouteOnlyHarness />, { route: '/', fetchRoutes: [serversRoute([kitchen, office])] })

    fireEvent.click(screen.getByRole('button', { name: 'Open remote project' }))

    await waitFor(() => expect(useSidebarServerStore.getState().serverId).toBe('srv_kitchen'))

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(useSidebarServerStore.getState().serverId).toBe('srv_kitchen')
  })
})
