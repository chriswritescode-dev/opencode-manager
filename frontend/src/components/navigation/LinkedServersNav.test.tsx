import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LinkedServersNav } from './LinkedServersNav'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  useServerActivityState: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useServerActivityState: mocks.useServerActivityState,
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

function renderNav(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LinkedServersNav />
    </MemoryRouter>,
  )
}

function renderRail(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LinkedServersNav variant="rail" />
    </MemoryRouter>,
  )
}

describe('LinkedServersNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], isLoading: false })
    mocks.useServerActivityState.mockReturnValue(null)
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: { srv_kitchen: { serverId: 'srv_kitchen', connected: true, version: null, error: null } },
      isLoading: false,
    })
  })

  it('renders nothing when no linked servers exist', () => {
    const { container } = renderNav()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Servers')).not.toBeInTheDocument()
  })

  it('lists enabled servers with a link and connection dot', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen, office], isLoading: false })

    renderNav()

    expect(screen.getByText('Servers')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Kitchen/ })).toHaveAttribute('href', '/servers/srv_kitchen')
    expect(screen.getByRole('link', { name: /Office/ })).toHaveAttribute('href', '/servers/srv_office')
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeInTheDocument()
  })

  it('hides disabled servers', () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen, { ...office, enabled: false }],
      isLoading: false,
    })

    renderNav()

    expect(screen.getByRole('link', { name: /Kitchen/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Office/ })).not.toBeInTheDocument()
  })

  it('renders enabled servers as icon links in the collapsed rail', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })

    renderRail('/servers/srv_kitchen/sessions/abc')

    expect(screen.getByRole('link', { name: 'Kitchen' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByText('Servers')).not.toBeInTheDocument()
  })

  it('renders nothing in the collapsed rail when no linked servers exist', () => {
    const { container } = renderRail()

    expect(container).toBeEmptyDOMElement()
  })

  it('hands navigation to the caller in the sheet variant', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen], isLoading: false })
    const onNavigate = vi.fn()

    render(
      <MemoryRouter>
        <LinkedServersNav variant="sheet" onNavigate={onNavigate} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Servers' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Kitchen/ }))

    expect(onNavigate).toHaveBeenCalledWith('/servers/srv_kitchen')
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
