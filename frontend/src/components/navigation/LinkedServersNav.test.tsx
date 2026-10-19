import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderNav(pathname = '/', variant?: 'sidebar' | 'rail' | 'sheet') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LinkedServersNav variant={variant} />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

function setServers(servers: Array<typeof kitchen>) {
  mocks.useOpenCodeServers.mockReturnValue({ servers, isLoading: false, isSuccess: true })
}

function triggerName(name: string) {
  return `Switch server, current: ${name}`
}

describe('LinkedServersNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    setServers([])
    mocks.useServerActivityState.mockReturnValue(null)
    mocks.useLocalActivityState.mockReturnValue(null)
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: {
        srv_kitchen: { serverId: 'srv_kitchen', connected: true, version: null, error: null },
        srv_office: { serverId: 'srv_office', connected: false, version: null, error: null },
      },
      isLoading: false,
    })
  })

  it('renders nothing when no linked servers exist', () => {
    renderNav()

    expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument()
  })

  it('renders nothing for disabled linked servers', () => {
    setServers([{ ...kitchen, enabled: false }])

    renderNav()

    expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument()
  })

  it('shows the local machine on the trigger by default', () => {
    setServers([kitchen])

    renderNav()

    expect(screen.getByRole('button', { name: triggerName('Local') })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Servers' })).not.toBeInTheDocument()
  })

  it('shows the selected server name and connection dot on the trigger', async () => {
    setServers([kitchen])
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderNav()

    expect(await screen.findByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('lists the local machine and enabled servers in the menu', async () => {
    const user = userEvent.setup()
    setServers([kitchen, { ...office, enabled: false }])

    renderNav()
    await user.click(screen.getByRole('button', { name: triggerName('Local') }))

    expect(await screen.findByRole('menuitem', { name: /Local/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('menuitem', { name: /Kitchen/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Office/ })).not.toBeInTheDocument()
  })

  it('selects a server without navigating', async () => {
    const user = userEvent.setup()
    setServers([kitchen, office])

    renderNav()
    await user.click(screen.getByRole('button', { name: triggerName('Local') }))
    await user.click(await screen.findByRole('menuitem', { name: /Office/ }))

    expect(await screen.findByRole('button', { name: triggerName('Office') })).toBeInTheDocument()
    expect(useSidebarServerStore.getState().serverId).toBe('srv_office')
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('selects the local machine without navigating', async () => {
    const user = userEvent.setup()
    setServers([kitchen])
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderNav()
    await user.click(screen.getByRole('button', { name: triggerName('Kitchen') }))
    await user.click(await screen.findByRole('menuitem', { name: /Local/ }))

    expect(await screen.findByRole('button', { name: triggerName('Local') })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('follows a linked server route', async () => {
    setServers([kitchen])

    renderNav('/servers/srv_kitchen/sessions/abc')

    expect(await screen.findByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument()
  })

  it('falls back to local when the persisted server is disabled', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_office' })
    setServers([kitchen, { ...office, enabled: false }])

    renderNav()

    expect(await screen.findByRole('button', { name: triggerName('Local') })).toBeInTheDocument()
  })

  it('shows an attention dot for another server that needs input', async () => {
    setServers([kitchen, office])
    mocks.useServerActivityState.mockImplementation((serverId: string) =>
      serverId === 'srv_office' ? 'needs-input' : null,
    )

    renderNav()

    expect(screen.getByRole('img', { name: 'Office needs input' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Office is running' })).not.toBeInTheDocument()
  })

  it('shows a running attention dot for another running server', () => {
    setServers([kitchen])
    mocks.useServerActivityState.mockReturnValue('running')

    renderNav()

    expect(screen.getByRole('img', { name: 'Kitchen is running' })).toBeInTheDocument()
  })

  it('shows local attention while a remote server is selected', () => {
    setServers([kitchen])
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.useLocalActivityState.mockReturnValue('needs-input')

    renderNav()

    expect(screen.getByRole('img', { name: 'Local needs input' })).toBeInTheDocument()
  })

  it('does not show an attention dot for the selected server', async () => {
    setServers([kitchen])
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.useServerActivityState.mockReturnValue('needs-input')

    renderNav()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('img', { name: 'Kitchen needs input' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Session needs input' })).toBeInTheDocument()
  })

  it('opens settings on the servers tab from the menu', async () => {
    const user = userEvent.setup()
    setServers([kitchen])

    renderNav()
    await user.click(screen.getByRole('button', { name: triggerName('Local') }))
    await user.click(await screen.findByRole('menuitem', { name: /Manage servers/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/?settings=open&settingsTab=servers')
  })

  it('renders a single icon trigger in the collapsed rail', async () => {
    const user = userEvent.setup()
    setServers([kitchen])

    renderNav('/', 'rail')

    const trigger = screen.getByRole('button', { name: triggerName('Local') })
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByText('Local')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Kitchen/ })).toBeInTheDocument()
  })

  it('renders nothing in the collapsed rail when no linked servers exist', () => {
    renderNav('/', 'rail')

    expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument()
  })

  it('renders a thin trigger row in the sheet variant', async () => {
    const user = userEvent.setup()
    setServers([kitchen])

    renderNav('/', 'sheet')

    expect(screen.queryByRole('heading', { name: 'Servers' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: triggerName('Local') }))
    await user.click(await screen.findByRole('menuitem', { name: /Kitchen/ }))

    expect(await screen.findByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })
})
