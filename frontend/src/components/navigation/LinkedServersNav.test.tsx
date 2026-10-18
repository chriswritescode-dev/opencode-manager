import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LinkedServersNav } from './LinkedServersNav'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
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

describe('LinkedServersNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], isLoading: false })
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
})
