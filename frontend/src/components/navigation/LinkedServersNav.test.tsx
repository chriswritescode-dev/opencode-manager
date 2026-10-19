import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { LinkedServersNav } from './LinkedServersNav'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  useServerActivityState: vi.fn(),
  useLocalActivityState: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useServerActivityState: mocks.useServerActivityState,
  useLocalActivityState: mocks.useLocalActivityState,
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

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderNav(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LinkedServersNav />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

function renderRail(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LinkedServersNav variant="rail" />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

describe('LinkedServersNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], isLoading: false })
    mocks.useServerActivityState.mockReturnValue(null)
    mocks.useLocalActivityState.mockReturnValue(null)
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: { srv_kitchen: { serverId: 'srv_kitchen', connected: true, version: null, error: null } },
      isLoading: false,
    })
  })

  it('renders nothing when no linked servers exist', () => {
    renderNav()

    expect(screen.queryByText('Servers')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Local/ })).not.toBeInTheDocument()
  })

  it('lists the local machine and enabled servers as toggle buttons with connection dots', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen, office], isLoading: false })

    renderNav()

    expect(screen.getByText('Servers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Local/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Office/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeInTheDocument()
  })

  it('hides disabled servers', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen, { ...office, enabled: false }],
      isLoading: false,
    })

    renderNav()

    expect(screen.getByRole('button', { name: /Kitchen/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Office/ })).not.toBeInTheDocument()
  })

  it('selects a server without navigating', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen, office], isLoading: false })

    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /Office/ }))

    expect(screen.getByRole('button', { name: /Office/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Office/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Local/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('selects the local machine without navigating', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })

    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /Local/ }))

    expect(screen.getByRole('button', { name: /Local/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('follows a linked server route', async () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })

    renderNav('/servers/srv_kitchen/sessions/abc')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByRole('button', { name: /Local/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('falls back to local when the persisted server is disabled', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_office' })
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen, { ...office, enabled: false }],
      isLoading: false,
    })

    renderNav()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Local/ })).toHaveAttribute('aria-pressed', 'true'),
    )
  })

  it('renders the local machine and enabled servers as icon toggles in the collapsed rail', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })

    renderRail('/servers/srv_kitchen/sessions/abc')

    expect(screen.getByRole('button', { name: 'Local' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kitchen' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Servers')).not.toBeInTheDocument()
  })

  it('renders nothing in the collapsed rail when no linked servers exist', () => {
    renderRail()

    expect(screen.queryByRole('button', { name: 'Local' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kitchen' })).not.toBeInTheDocument()
  })

  it('switches the selected server in the sheet variant without navigating', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })

    render(
      <MemoryRouter initialEntries={['/']}>
        <LinkedServersNav variant="sheet" />
        <LocationDisplay />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Servers' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Kitchen/ }))

    expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('shows the activity indicator only for the server with an active session', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen, office], isLoading: false })
    mocks.useServerActivityState.mockImplementation((serverId: string) =>
      serverId === 'srv_kitchen' ? 'needs-input' : null,
    )

    renderNav()

    expect(mocks.useServerActivityState).toHaveBeenCalledWith('srv_kitchen')
    expect(mocks.useServerActivityState).toHaveBeenCalledWith('srv_office')
    expect(screen.getByRole('img', { name: 'Session needs input' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Sessions running' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('shows local activity on the local row', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    mocks.useLocalActivityState.mockReturnValue('running')

    renderNav()

    expect(screen.getByRole('img', { name: 'Sessions running' })).toBeInTheDocument()
  })

  it('shows the running indicator in the sheet variant', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    mocks.useServerActivityState.mockReturnValue('running')

    render(
      <MemoryRouter>
        <LinkedServersNav variant="sheet" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('img', { name: 'Sessions running' })).toBeInTheDocument()
  })
})
