import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { Repos } from '../Repos'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  openTab: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: () => ({
    isOpen: false,
    open: vi.fn(),
    openTab: mocks.openTab,
    close: vi.fn(),
    toggle: vi.fn(),
    activeTab: 'account',
    selectedTab: null,
    setActiveTab: vi.fn(),
  }),
}))

vi.mock('@/hooks/useActiveWork', () => ({
  useServerActivityState: () => null,
  useLocalActivityState: () => null,
}))

vi.mock('@/hooks/useMobile', () => ({
  isMobileViewport: () => false,
  useMobile: () => false,
}))

vi.mock('@/components/repo/RepoList', () => ({
  RepoList: () => <div>local-repos</div>,
}))

vi.mock('@/components/repo/AddRepoDialog', () => ({
  AddRepoDialog: () => null,
}))

vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: () => null,
}))

vi.mock('@/components/navigation/ToolSidePanel', () => ({
  ToolSidePanel: () => null,
}))

vi.mock('@/components/notifications/PendingActionsGroup', () => ({
  PendingActionsGroup: () => null,
}))

vi.mock('@/components/servers/RemoteProjectList', () => ({
  RemoteProjectList: ({ serverId }: { serverId: string }) => (
    <div>remote-projects:{serverId}</div>
  ),
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

function LocationDisplay() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderRepos() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocationDisplay />
      <Routes>
        <Route path="/" element={<Repos />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Repos', () => {
  beforeEach(() => {
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen],
      isLoading: false,
      isSuccess: true,
    })
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: {
        srv_kitchen: {
          serverId: 'srv_kitchen',
          connected: true,
          version: '2.0.15',
          error: null,
        },
      },
      isLoading: false,
    })
  })

  it('shows the local repositories and local-only actions', () => {
    renderRepos()

    expect(screen.getByText('local-repos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open files' })).toBeInTheDocument()
    expect(screen.queryByText(/remote-projects/)).not.toBeInTheDocument()
  })

  it('shows the selected linked server projects and hides local-only actions', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderRepos()

    expect(screen.getByText('remote-projects:srv_kitchen')).toBeInTheDocument()
    expect(screen.queryByText('local-repos')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Repo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open files' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Schedules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('swaps the center section without navigating when the selection changes', () => {
    renderRepos()

    act(() => useSidebarServerStore.getState().selectServer('srv_kitchen'))

    expect(screen.getByText('remote-projects:srv_kitchen')).toBeInTheDocument()
    expect(screen.queryByText('local-repos')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')

    act(() => useSidebarServerStore.getState().selectServer(LOCAL_OPENCODE_SERVER_ID))

    expect(screen.getByText('local-repos')).toBeInTheDocument()
    expect(screen.queryByText(/remote-projects/)).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('names the selected linked server in the header with its connection state', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderRepos()

    const switcher = screen.getByRole('button', { name: 'Switch server, current: Kitchen' })
    expect(switcher).toHaveTextContent('Kitchen')
    expect(within(switcher).getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('does not show the server switcher in the header for the local server', () => {
    renderRepos()

    expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument()
  })

  it('switches servers and opens server settings from the header dropdown', async () => {
    const user = userEvent.setup()
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderRepos()

    await user.click(screen.getByRole('button', { name: 'Switch server, current: Kitchen' }))
    await user.click(await screen.findByRole('menuitem', { name: /OC Manager/ }))

    expect(screen.getByText('local-repos')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')

    act(() => useSidebarServerStore.getState().selectServer('srv_kitchen'))
    await user.click(screen.getByRole('button', { name: 'Switch server, current: Kitchen' }))
    await user.click(await screen.findByRole('menuitem', { name: /Manage servers/ }))

    expect(mocks.openTab).toHaveBeenCalledWith('servers')
  })
})
