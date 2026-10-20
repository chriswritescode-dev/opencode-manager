import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: /Manage servers/ })).toHaveClass('hidden', 'sm:flex')
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

  it('shows the connection status of the selected linked server', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderRepos()

    expect(screen.getByText(/Connected/)).toBeInTheDocument()
    expect(screen.getByText(/v2\.0\.15/)).toBeInTheDocument()
  })

  it('shows an unreachable linked server with its error', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    mocks.useOpenCodeServerStatuses.mockReturnValue({
      statuses: [],
      statusById: {
        srv_kitchen: {
          serverId: 'srv_kitchen',
          connected: false,
          version: null,
          error: 'connection refused',
        },
      },
      isLoading: false,
    })

    renderRepos()

    expect(screen.getByText(/Unreachable/)).toBeInTheDocument()
    expect(screen.getByText(/connection refused/)).toBeInTheDocument()
  })

  it('opens the servers settings tab from the header', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderRepos()

    fireEvent.click(screen.getByRole('button', { name: /Manage servers/ }))

    expect(mocks.openTab).toHaveBeenCalledWith('servers')
  })
})
