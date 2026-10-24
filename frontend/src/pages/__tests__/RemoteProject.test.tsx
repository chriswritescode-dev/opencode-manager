import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RemoteProject } from '../RemoteProject'

interface SessionListCapture {
  directory?: string
  createDirectory?: string
  onSelectSession?: (sessionId: string) => void
}

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getVcsInfo: vi.fn(),
  useCreateSession: vi.fn(),
  useOpenCodeServers: vi.fn(),
  useSettingsDialog: vi.fn(),
  useSSE: vi.fn(),
  createSession: vi.fn(),
  lastSessionListProps: { current: undefined as SessionListCapture | undefined },
  openTab: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/opencode')>()
  return { ...actual, listProjects: mocks.listProjects, getVcsInfo: mocks.getVcsInfo }
})

vi.mock('@/hooks/useOpenCode', () => ({
  useCreateSession: mocks.useCreateSession,
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
}))

vi.mock('@/hooks/useSettingsDialog', () => ({
  useSettingsDialog: mocks.useSettingsDialog,
}))

vi.mock('@/hooks/useSSE', () => ({
  useSSE: mocks.useSSE,
}))

vi.mock('@/components/session/SessionList', () => ({
  SessionList: (props: SessionListCapture) => {
    mocks.lastSessionListProps.current = props
    return <div data-testid="session-list">{props.directory}</div>
  },
}))

vi.mock('@/components/navigation/ToolSidePanel', () => ({
  ToolSidePanel: () => <div data-testid="tool-panel" />,
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

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderProject(path = '/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div data-testid="home-route" />} />
          <Route path="/servers/:serverId/projects" element={<RemoteProject />} />
          <Route path="/servers/:serverId/sessions/:sessionId" element={<div data-testid="session-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RemoteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lastSessionListProps.current = undefined
    mocks.listProjects.mockResolvedValue([project])
    mocks.getVcsInfo.mockResolvedValue({ branch: { current: 'main', default: 'main' } })
    mocks.useCreateSession.mockReturnValue({ mutate: mocks.createSession, isPending: false })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [server], showsInitialLoading: false })
    mocks.useSettingsDialog.mockReturnValue({ openTab: mocks.openTab })
    mocks.useSSE.mockReturnValue({ isConnected: true, isReconnecting: false })
  })

  it('renders the project name, server name and branch from the linked server', async () => {
    renderProject()

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.getByText('Kitchen')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument()
    })
    expect(mocks.listProjects).toHaveBeenCalledWith('srv_kitchen')
    expect(mocks.getVcsInfo).toHaveBeenCalledWith('/home/me/app', 'srv_kitchen')
  })

  it('falls back to the directory name when the server does not list the project', async () => {
    mocks.listProjects.mockResolvedValue([])
    renderProject()

    expect(await screen.findByText('app')).toBeInTheDocument()
  })

  it('renders the session list for the project directory and subscribes to its events', () => {
    renderProject()

    expect(screen.getByTestId('session-list')).toHaveTextContent('/home/me/app')
    expect(mocks.lastSessionListProps.current?.createDirectory).toBe('/home/me/app')
    expect(mocks.useSSE).toHaveBeenCalledWith('/home/me/app')
  })

  it('opens a session from the session list on the remote session route', () => {
    renderProject()

    act(() => {
      mocks.lastSessionListProps.current?.onSelectSession?.('ses_42')
    })

    expect(screen.getByTestId('session-route')).toBeInTheDocument()
  })

  it('creates a session in the project directory and navigates to it', async () => {
    mocks.useCreateSession.mockReturnValue({
      mutate: (_input: unknown, options?: { onSuccess?: (session: { id: string }) => void }) => {
        options?.onSuccess?.({ id: 'ses_new' })
      },
      isPending: false,
    })
    renderProject()

    fireEvent.click(screen.getAllByRole('button', { name: 'New Session' })[0])

    await waitFor(() => {
      expect(screen.getByTestId('session-route')).toBeInTheDocument()
    })
    expect(mocks.useCreateSession).toHaveBeenCalledWith('/home/me/app')
  })

  it('shows a missing-directory state without rendering the session list', async () => {
    renderProject('/servers/srv_kitchen/projects')

    expect(await screen.findByText('No project selected')).toBeInTheDocument()
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument()
  })

  it('goes back to the projects list from the missing-directory state', async () => {
    renderProject('/servers/srv_kitchen/projects')

    fireEvent.click(await screen.findByRole('button', { name: 'Back to projects' }))

    expect(screen.getByTestId('home-route')).toBeInTheDocument()
  })

  it('shows the disabled state without loading projects', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...server, enabled: false }],
      showsInitialLoading: false,
    })

    renderProject()

    expect(await screen.findByText('This server is disabled')).toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument()
  })

  it('shows the missing-server state', async () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], showsInitialLoading: false })

    renderProject()

    expect(await screen.findByText('Server not found')).toBeInTheDocument()
  })

  it('shows a loading state instead of a blank body while the server list restores', () => {
    mocks.useOpenCodeServers.mockReturnValue({ servers: [], showsInitialLoading: true })

    const { container } = renderProject()

    expect(screen.getByRole('status', { name: 'Loading project' })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0)
    expect(screen.queryByText('Server not found')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument()
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('opens server settings from the disabled state', async () => {
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [{ ...server, enabled: false }],
      showsInitialLoading: false,
    })

    renderProject()

    fireEvent.click(await screen.findByRole('button', { name: 'Open server settings' }))

    expect(mocks.openTab).toHaveBeenCalledWith('servers')
  })

  it('goes back to the projects list', async () => {
    renderProject()

    fireEvent.click(await screen.findByRole('button', { name: 'Go back' }))

    expect(screen.getByTestId('home-route')).toBeInTheDocument()
  })
})
