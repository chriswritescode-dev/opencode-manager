import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { SettingsDialog } from './SettingsDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DESKTOP_MEDIA_QUERY } from '@/hooks/useMediaQuery'

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

vi.mock('@/components/settings/LogsViewer', () => ({
  LogsViewer: () => <div data-testid="logs-settings">Logs Content</div>,
}))

vi.mock('@/hooks/useMobile', () => ({
  useSwipeBack: vi.fn(() => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  })),
}))

function stubMatchMedia(matches: boolean): () => void {
  const listeners = new Set<() => void>()
  const mediaQueryList = {
    media: DESKTOP_MEDIA_QUERY,
    matches,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }
  const original = window.matchMedia
  void original
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  })
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
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

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()
    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
  })

  it('navigates to the Logs section and reflects settingsTab=logs in the URL', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          {isOpen && <span data-testid="location-search">{location.search}</span>}
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

    const logsMenuButton = screen.getByText('Live manager and OpenCode server logs').closest('button')
    expect(logsMenuButton).not.toBeNull()
    fireEvent.click(logsMenuButton!)

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    expect(within(mobileContainer).getByTestId('logs-settings')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('settingsTab=logs')
  })

  it('opens directly on the Logs mobile view from ?settings=open&settingsTab=logs and returns to the menu on back', () => {
    stubMatchMedia(false)
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('/')}>Close Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open&settingsTab=logs']}>
        <TestWrapper />
      </MemoryRouter>
    )

    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)

    expect(mobile.getByTestId('logs-settings')).toBeInTheDocument()
    expect(mobile.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getAllByTestId('logs-settings')).toHaveLength(1)

    const backButton = mobileContainer.querySelector('svg.lucide-chevron-left')?.closest('button')
    expect(backButton).not.toBeNull()
    fireEvent.click(backButton!)

    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()
    expect(screen.queryByTestId('logs-settings')).not.toBeInTheDocument()
  })

  it('mounts exactly one LogsViewer on desktop when the Logs tab is selected', () => {
    stubMatchMedia(true)
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open&settingsTab=logs')}>Open Logs</button>
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

    fireEvent.click(screen.getByText('Open Logs'))

    expect(screen.getAllByTestId('logs-settings')).toHaveLength(1)
    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    expect(within(mobileContainer).queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(within(mobileContainer).getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
  })

  it('falls back to the menu and account tab for an unknown settingsTab value', () => {
    function TestWrapper() {
      const location = useLocation()
      const isOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open&settingsTab=log']}>
        <TestWrapper />
      </MemoryRouter>
    )

    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()

    const desktopTrigger = screen.getByRole('tab', { name: 'Account' })
    expect(desktopTrigger).toHaveAttribute('data-state', 'active')
  })

  it('applies compact responsive sizing to all nine desktop tab triggers', () => {
    function TestWrapper() {
      return <SettingsDialog />
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <TestWrapper />
      </MemoryRouter>
    )

    const triggers = screen.getAllByRole('tab')
    expect(triggers).toHaveLength(9)
    const expected = ['Account', 'General', 'Notify', 'Voice', 'Git', 'Shortcuts', 'OpenCode', 'Logs', 'Providers']
    expect(triggers.map((trigger) => trigger.textContent)).toEqual(expected)
    for (const trigger of triggers) {
      expect(trigger.className).toContain('sm:px-2')
      expect(trigger.className).toContain('sm:text-xs')
      expect(trigger.className).toContain('md:px-3')
      expect(trigger.className).toContain('md:text-sm')
    }
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
})
