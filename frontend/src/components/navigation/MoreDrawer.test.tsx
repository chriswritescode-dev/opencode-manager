import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { MoreDrawer } from './MoreDrawer'
import { useAuth } from '@/hooks/useAuth'
import { useServerHealth } from '@/hooks/useServerHealth'
import { useCommands } from '@/hooks/useCommands'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useUIState } from '@/stores/uiStateStore'

vi.mock('@/hooks/useAuth')
vi.mock('@/hooks/useServerHealth')
vi.mock('@/hooks/useCommands')
vi.mock('@/hooks/useFileSearch')
vi.mock('@/hooks/useMemoryPluginStatus', () => ({
  useMemoryPluginStatus: () => ({ memoryPluginEnabled: false }),
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
    restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  })
}

describe('MoreDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(useCommands).mockReturnValue({
      commands: [],
      loading: false,
      error: null,
      filterCommands: vi.fn().mockReturnValue([
        {
          name: 'help',
          description: 'Show help',
          template: '',
          agent: '',
          model: '',
          hints: [],
        },
      ]),
    })
    vi.mocked(useFileSearch).mockReturnValue({
      files: ['src/App.tsx'],
      isLoading: false,
      error: null,
    })
    useUIState.getState().clearPendingPromptCommand()
    useUIState.getState().clearPendingPromptFile()
  })

  it('renders Settings and Logout menu items', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('OpenCode')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('does not render theme controls', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
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
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Settings'))
    expect(navigateMock).toHaveBeenCalledWith(
      { search: 'settings=open&tab=account' },
      { replace: true },
    )
  })

  it('calls logout when Logout is clicked', () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined)
    mockAuth(logoutMock)
    mockServerHealth()
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Logout'))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('displays OpenCode and Manager versions when available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: '1.4.11', opencodeManagerVersion: '0.9.16' })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('OpenCode v1.4.11')).toBeInTheDocument()
    expect(screen.getByText('Manager v0.9.16')).toBeInTheDocument()
  })

  it('shows unhealthy server status when server is unhealthy', () => {
    mockAuth()
    mockServerHealth({ opencode: 'unhealthy' as const, opencodeVersion: '1.4.11' })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('OpenCode v1.4.11')).toBeInTheDocument()
  })

  it('shows fallback text when version is not available', () => {
    mockAuth()
    mockServerHealth({ opencodeVersion: null, opencodeManagerVersion: null })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('OpenCode')).toBeInTheDocument()
  })

  it('shows session commands and selects a command', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>{children}</MemoryRouter> },
    )

    fireEvent.click(screen.getByText('Commands'))
    fireEvent.click(screen.getByText('/help'))

    expect(useUIState.getState().pendingPromptCommand?.command.name).toBe('help')
    expect(handleClose).toHaveBeenCalled()
  })

  it('shows session files and selects a file mention', () => {
    mockAuth()
    mockServerHealth()
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter initialEntries={['/repos/1/sessions/session-1']}>{children}</MemoryRouter> },
    )

    fireEvent.click(screen.getByText('Mention File'))
    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'app' } })
    fireEvent.click(screen.getByText('App.tsx'))

    expect(useUIState.getState().pendingPromptFile?.path).toBe('src/App.tsx')
    expect(handleClose).toHaveBeenCalled()
  })

})
