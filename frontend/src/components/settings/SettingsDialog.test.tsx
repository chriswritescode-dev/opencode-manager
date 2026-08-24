import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsDialog } from './SettingsDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

const {
  mockRestartOpenCodeServer,
  mockGetActiveOpenCodeSessions,
} = vi.hoisted(() => ({
  mockRestartOpenCodeServer: vi.fn(),
  mockGetActiveOpenCodeSessions: vi.fn(),
}))

vi.mock('@/hooks/useServerHealth', () => ({
  useServerHealth: () => ({ data: { opencode: 'healthy', opencodeRestartPending: true } }),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    restartOpenCodeServer: mockRestartOpenCodeServer,
    getActiveOpenCodeSessions: mockGetActiveOpenCodeSessions,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/components/settings/GeneralSettings', () => ({
  GeneralSettings: () => <div data-testid="general-settings">General Settings Content</div>,
}))

vi.mock('@/components/settings/GitSettings', () => ({
  GitSettings: () => <div data-testid="git-settings">Git Settings Content</div>,
}))

vi.mock('@/components/settings/KeyboardShortcuts', () => ({
  KeyboardShortcuts: () => <div data-testid="shortcuts-settings">Keyboard Shortcuts Content</div>,
}))

vi.mock('@/components/settings/OpenCodeConfigManager', () => ({
  OpenCodeConfigManager: () => <div data-testid="opencode-settings">OpenCode Config Content</div>,
}))

vi.mock('@/components/settings/ServerHealthStatus', () => ({
  ServerHealthStatus: () => <div data-testid="server-health-status">Server Health Status</div>,
}))

vi.mock('@/components/settings/OpenCodeServerAuthSettings', () => ({
  OpenCodeServerAuthSettings: () => <div data-testid="opencode-auth-settings">OpenCode Auth Settings</div>,
}))

vi.mock('@/components/settings/ManagerTokenSettings', () => ({
  ManagerTokenSettings: () => <div data-testid="manager-token-settings">Manager Token Settings</div>,
}))

vi.mock('@/components/settings/ServerEnvVarsSettings', () => ({
  ServerEnvVarsSettings: () => <div data-testid="server-env-vars-settings">Server Env Vars Settings</div>,
}))

vi.mock('@/components/settings/ProviderSettings', () => ({
  ProviderSettings: () => <div data-testid="providers-settings">Provider Settings Content</div>,
}))

vi.mock('@/components/settings/AccountSettings', () => ({
  AccountSettings: () => <div data-testid="account-settings">Account Settings Content</div>,
}))

vi.mock('@/components/settings/VoiceSettings', () => ({
  VoiceSettings: () => <div data-testid="voice-settings">Voice Settings Content</div>,
}))

vi.mock('@/components/settings/NotificationSettings', () => ({
  NotificationSettings: () => <div data-testid="notification-settings">Notification Settings Content</div>,
}))

vi.mock('@/components/settings/VersionSelectDialog', () => ({
  VersionSelectDialog: () => <div data-testid="version-select-dialog">Version Select Dialog</div>,
}))

vi.mock('@/hooks/useMobile', () => ({
  useSwipeBack: vi.fn(() => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  })),
}))

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestartOpenCodeServer.mockResolvedValue({ success: true, message: 'ok' })
    mockGetActiveOpenCodeSessions.mockResolvedValue({ count: 2, sessions: [] })
  })

  it('resets to menu state when dialog closes and reopens', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open&settingsTab=general')}>Open Settings</button>
          <button onClick={() => navigate('/')}>Close Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close Settings'))
    expect(screen.queryByTestId('dialog-open')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()
  })

  it('displays menu items in mobile view', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('General').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Git').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Shortcuts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('OpenCode').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Providers').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps Settings open when Escape fires inside a nested dialog', () => {
    function TestWrapper() {
      const location = useLocation()
      const settingsOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {settingsOpen && <span data-testid="settings-open" />}
          <SettingsDialog />
          <Dialog open>
            <DialogContent data-testid="nested-dialog">
              <DialogTitle className="sr-only">Nested</DialogTitle>
              <textarea data-testid="nested-input" />
            </DialogContent>
          </Dialog>
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <TestWrapper />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('settings-open')).toBeInTheDocument()

    const nestedInput = screen.getByTestId('nested-input')
    nestedInput.focus()
    fireEvent.keyDown(nestedInput, { key: 'Escape' })

    expect(screen.getByTestId('settings-open')).toBeInTheDocument()
  })

  it('mounts a single restart-pending notice and dialog on the OpenCode tab', async () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const isOpen = new URLSearchParams(location.search).get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <TestWrapper />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const user = userEvent.setup()
    await user.click(screen.getByText('Open Settings'))
    await user.click(screen.getByRole('tab', { name: 'OpenCode' }))

    await screen.findByText('Restart OpenCode Server?')
    expect(screen.getAllByText('Restart OpenCode Server?')).toHaveLength(1)
    expect(screen.getAllByText('Configuration changes are saved but require a server restart to take effect.')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /later/i }))
    await waitFor(() => {
      expect(screen.queryAllByText('Restart OpenCode Server?')).toHaveLength(0)
    })
    expect(screen.getByText('Configuration changes are saved but require a server restart to take effect.')).toBeInTheDocument()
    expect(mockRestartOpenCodeServer).not.toHaveBeenCalled()
  })
})
