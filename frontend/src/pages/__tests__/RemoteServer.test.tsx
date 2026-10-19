import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RemoteServer } from '../RemoteServer'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  useSessionsAcrossDirectories: vi.fn(),
  useCreateSession: vi.fn(),
  useOpenCodeServers: vi.fn(),
  useOpenCodeServerStatuses: vi.fn(),
  useSettingsDialog: vi.fn(),
  useSSE: vi.fn(),
  setActiveTab: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('@/api/opencode', () => ({
  listProjects: mocks.listProjects,
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSessionsAcrossDirectories: mocks.useSessionsAcrossDirectories,
  useCreateSession: mocks.useCreateSession,
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: mocks.useOpenCodeServerStatuses,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: mocks.useSettingsDialog,
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: mocks.useSSE,
}))

const server = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const project = {
  id: 'prj_1',
  canonical: '/home/me/app',
  name: 'App',
  time: { created: 1, updated: 2, active: 2 },
  sandboxes: [],
}

const session = {
  id: 'ses_1',
  projectID: 'prj_1',
  title: 'Fix the bug',
  time: { created: 1, updated: Date.now() - 60000 },
  location: { directory: '/home/me/app' },
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderServer(serverId = 'srv_kitchen') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[`/servers/${serverId}`]}>
        <Routes>
          <Route path="/servers/:serverId" element={<RemoteServer />} />
          <Route path="/servers/:serverId/sessions/:sessionId" element={<div data-testid="session-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RemoteServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProjects.mockResolvedValue([project])
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [session], isLoading: false })
    mocks.useCreateSession.mockReturnValue({ mutateAsync: mocks.createSession, isPending: false })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [server], isLoading: false })
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
    mocks.useSettingsDialog.mockReturnValue({ setActiveTab: mocks.setActiveTab })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
  })

  it('renders the server identity and connection status', async () => {
    renderServer()

    expect(screen.getByText('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('https://kitchen.example.com')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument()
    })
    expect(screen.getByText(/v2\.0\.15/)).toBeInTheDocument()
  })

  it('lists projects from the remote server', async () => {
    renderServer()

    await waitFor(() => {
      expect(screen.getByText('App')).toBeInTheDocument()
    })
    expect(screen.getByText('/home/me/app')).toBeInTheDocument()
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
  })

  it('links the project name to the remote project page', async () => {
    renderServer()

    const link = await screen.findByRole('link', { name: /App/ })
    expect(link).toHaveAttribute(
      'href',
      '/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp',
    )
  })

  it('links each expanded project session to the remote session route', async () => {
    renderServer()

    fireEvent.click(await screen.findByRole('button', { name: 'Expand App' }))

    const link = await screen.findByRole('link', { name: /Fix the bug/ })
    expect(link).toHaveAttribute('href', '/servers/srv_kitchen/sessions/ses_1')
    expect(mocks.useSessionsAcrossDirectories).toHaveBeenCalledWith(['/home/me/app'])
  })

  it('creates a session in a project directory and navigates to it', async () => {
    mocks.createSession.mockResolvedValue({ id: 'ses_new' })
    renderServer()

    await screen.findByText('App')
    fireEvent.click(screen.getByRole('button', { name: /New session/ }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ agent: undefined })
    })
    await waitFor(() => {
      expect(screen.getByTestId('session-route')).toBeInTheDocument()
    })
  })

  it('opens a session in an arbitrary directory', async () => {
    mocks.createSession.mockResolvedValue({ id: 'ses_other' })
    renderServer()

    fireEvent.change(screen.getByLabelText('Directory path'), { target: { value: '/srv/other' } })
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }))

    await waitFor(() => {
      expect(mocks.createSession).toHaveBeenCalledWith({ directory: '/srv/other' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('session-route')).toBeInTheDocument()
    })
  })

  it('shows the disabled state without loading projects', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...server, enabled: false }],
      isLoading: false,
    })

    renderServer()

    expect(screen.getByText('This server is disabled')).toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('shows an empty state when the server has no projects', async () => {
    mocks.listProjects.mockResolvedValue([])

    renderServer()

    await waitFor(() => {
      expect(screen.getByText('No projects on this server yet')).toBeInTheDocument()
    })
  })

  it('shows the unreachable state from the status hook', async () => {
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

    renderServer()

    expect(screen.getByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByText(/connection refused/)).toBeInTheDocument()
  })

  it('opens the servers settings tab from the header', () => {
    renderServer()

    fireEvent.click(screen.getByRole('button', { name: /Manage servers/ }))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('servers')
  })
})
