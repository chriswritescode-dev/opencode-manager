import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useSidebarServerRouteSync, useSidebarServerSelection } from './useSidebarServerSelection'
import { SIDEBAR_SERVER_STORAGE_KEY, useSidebarServerStore } from '@/stores/sidebarServerStore'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: () => ({ statuses: [], statusById: {}, isLoading: false }),
}))

const kitchen = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const office = { ...kitchen, id: 'srv_office', name: 'Office' }

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

function renderHarness(initialEntry = '/', options?: { syncRoute?: boolean }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SelectionHarness syncRoute={options?.syncRoute} />
    </MemoryRouter>,
  )
}

function resetSelection() {
  localStorage.clear()
  useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
  mocks.useOpenCodeServers.mockReturnValue({
    servers: [kitchen, office],
    isLoading: false,
    isSuccess: true,
  })
}

describe('useSidebarServerSelection', () => {
  beforeEach(resetSelection)

  it('defaults to the local server', () => {
    renderHarness('/', { syncRoute: false })

    expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID)
  })

  it('persists the selection', () => {
    renderHarness('/', { syncRoute: false })

    fireEvent.click(screen.getByRole('button', { name: 'Select kitchen' }))

    expect(JSON.parse(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY) ?? 'null')).toBe(
      'srv_kitchen',
    )
  })

  it('does not follow the route without the route sync', () => {
    renderHarness('/servers/srv_kitchen', { syncRoute: false })

    expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID)
  })
})

describe('useSidebarServerRouteSync', () => {
  beforeEach(resetSelection)

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
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen, { ...office, enabled: false }],
      isLoading: false,
      isSuccess: true,
    })

    renderHarness()

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('keeps the persisted server when the server list fails to load', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [],
      isLoading: false,
      isSuccess: false,
      error: new Error('offline'),
    })

    renderHarness()

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen'))
    expect(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY)).toBeNull()
  })

  it('falls back to local when the selected server no longer exists', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_gone' })

    renderHarness()

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
    expect(JSON.parse(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY) ?? 'null')).toBe(
      LOCAL_OPENCODE_SERVER_ID,
    )
  })

  it('follows a linked server route with no sidebar consumer mounted', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteOnlyHarness />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open remote project' }))

    await waitFor(() => expect(useSidebarServerStore.getState().serverId).toBe('srv_kitchen'))

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    expect(useSidebarServerStore.getState().serverId).toBe('srv_kitchen')
  })
})
