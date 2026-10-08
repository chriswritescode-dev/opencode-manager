import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MoreDrawer } from './MoreDrawer'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { getRepo } from '@/api/repos'

vi.mock('@/hooks/useAuth')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/api/repos', () => ({
  getRepo: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(),
  }
})

const mockAuth = (logout = vi.fn()) => {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    config: null,
    signInWithEmail: vi.fn(),
    signInWithProvider: vi.fn(),
    signInWithPasskey: vi.fn(),
    signUpWithEmail: vi.fn(),
    addPasskey: vi.fn(),
    logout,
    refreshSession: vi.fn(),
  })
}

const mockServerHealth = (health?: Partial<ReturnType<typeof useServerHealth>['data']>) => {
  const baseHealth = {
    status: 'healthy' as const,
    timestamp: new Date().toISOString(),
    database: 'connected' as const,
    opencode: 'healthy' as const,
    opencodePort: 5551,
    opencodeVersion: null,
    opencodeMinVersion: '1.0.0',
    opencodeManagerVersion: null,
    error: undefined,
  }

  vi.mocked(useServerHealth).mockReturnValue({
    data: {
      ...baseHealth,
      ...health,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
}

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderMoreDrawer = ({
  initialEntry = '/',
  routePath = '*',
  onClose = vi.fn(),
}: {
  initialEntry?: string
  routePath?: string
  onClose?: () => void
} = {}) => render(
  <QueryClientProvider client={createQueryClient()}>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={routePath} element={<MoreDrawer isOpen onClose={onClose} />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

describe('MoreDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(getRepo).mockResolvedValue({
      id: 1,
      localPath: 'wrong-repo',
      fullPath: '/workspace/repos/wrong-repo',
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 0,
    })
  })

  it('renders Settings and Logout menu items', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('does not render theme controls', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByText('Light')).not.toBeInTheDocument()
    expect(screen.queryByText('Dark')).not.toBeInTheDocument()
    expect(screen.queryByText('System')).not.toBeInTheDocument()
  })

  it('navigates to settings URL when Settings is clicked', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Settings'))
    expect(navigateMock).toHaveBeenCalledWith(
      { search: 'settings=open&settingsTab=account' },
      { replace: true },
    )
  })

  it('calls logout when Logout is clicked', () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined)
    mockAuth(logoutMock)
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    fireEvent.click(screen.getByText('Logout'))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('displays OpenCode and Manager versions when available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: '1.4.11', opencodeManagerVersion: '0.9.16' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11 · Manager v0.9.16')).toBeInTheDocument()
  })

  it('shows unhealthy server status when server is unhealthy', () => {
    mockAuth()
    mockServerHealth({ opencode: 'unhealthy' as const, opencodeVersion: '1.4.11' })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.getByText('v1.4.11')).toBeInTheDocument()
  })

  it('shows fallback text when version is not available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: null, opencodeManagerVersion: null })
    const handleClose = vi.fn()
    renderMoreDrawer({ onClose: handleClose })
    expect(screen.queryByText('OpenCode')).not.toBeInTheDocument()
  })

  it('leaves commands and file mentions to the prompt input', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.queryByText('Commands')).not.toBeInTheDocument()
    expect(screen.queryByText('Mention File')).not.toBeInTheDocument()
  })

  it('groups session items into workspace and project sections', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    const sectionLabels = (name: string) =>
      within(screen.getByRole('region', { name })).getAllByRole('button').map((button) => button.textContent)

    expect(sectionLabels('Workspace')).toEqual(['Files', 'Source Control', 'Terminal', 'Walkthrough', 'Preview'])
    expect(sectionLabels('Project')).toEqual(['MCP', 'Skills', 'Reset Permissions', 'Schedules', 'Actions'])
    expect(screen.getAllByText('Settings')).toHaveLength(1)
    expect(screen.getAllByText('Logout')).toHaveLength(1)
  })

  it('shows Assistant instead of the source repo on assistant routes', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/repos/1/assistant', routePath: '/repos/:id/assistant', onClose: handleClose })

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('shows Assistant instead of the source repo on canonical /assistant route', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    renderMoreDrawer({ initialEntry: '/assistant', routePath: '/assistant', onClose: handleClose })

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('wrong-repo')).not.toBeInTheDocument()
  })

  it('preserves session route as return target when opening schedules', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?assistant=1', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByText('Schedules'))

    expect(navigateMock).toHaveBeenCalledWith('/repos/1/schedules?returnTo=%2Frepos%2F1%2Fsessions%2Fsession-1%3Fassistant%3D1')
  })

  it('swaps the menu for the Repos sheet from a session', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?mobileTab=more', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByText('Repos'))

    expect(navigateMock).toHaveBeenCalledWith({ search: 'mobileTab=repos' }, { replace: false })
  })

  it('keeps Home and hides the Repos row outside a session', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1', routePath: '/repos/:id' })

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.queryByText('Repos')).not.toBeInTheDocument()
  })

  it('offers the Assistant from a repo session', () => {
    const navigateMock = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(navigateMock)
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1', routePath: '/repos/:id/sessions/:sessionId' })

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))

    expect(navigateMock).toHaveBeenCalledWith('/assistant')
  })

  it('does not offer the Assistant from an assistant session', () => {
    mockAuth()
    mockServerHealth()
    renderMoreDrawer({ initialEntry: '/repos/1/sessions/session-1?assistant=1', routePath: '/repos/:id/sessions/:sessionId' })

    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument()
  })
})
