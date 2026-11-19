import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ManagerLogEntry } from '@opencode-manager/shared/schemas'
import { SettingsDialog } from './SettingsDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeHealthResponse } from '@/test/fixtures/api'
import { installMatchMedia, installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

const logs: ManagerLogEntry[] = [
  {
    seq: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    source: 'manager',
    message: 'Server started on port 5003',
  },
]

const fetchRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/auth/passkey/list-user-passkeys', respond: () => ({ json: [] }) },
  { method: 'GET', path: '/api/auth/device-pairing/devices', respond: () => ({ json: { devices: [] } }) },
  {
    method: 'GET',
    path: '/api/health/version',
    respond: () => ({
      json: { currentVersion: 'v1.2.3', latestVersion: null, updateAvailable: false, releaseUrl: null, releaseName: null },
    }),
  },
  { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse({ opencode: 'healthy' }) }) },
  {
    method: 'GET',
    path: '/api/logs',
    respond: () => ({
      json: { entries: logs, instanceId: 'instance-1', latestSeq: 1, oldestSeq: 1, dropped: 0, capacity: 1000 },
    }),
  },
  { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
  { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
  { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
]

interface DialogRenderOptions {
  desktop?: boolean
  initialEntries?: string[]
}

function renderSettingsDialog({ desktop = false, initialEntries = ['/?settings=open'] }: DialogRenderOptions = {}) {
  installMatchMedia(desktop)
  installPointerCapture()
  return renderWithProviders(<SettingsDialog />, { initialEntries, fetchRoutes })
}

function mobileContainer(): HTMLElement {
  const container = document.querySelector('.sm\\:hidden')
  if (!(container instanceof HTMLElement)) throw new Error('No mobile settings container')
  return container
}

function SettingsNavigation() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => navigate('?settings=open&settingsTab=general')}>Open General</button>
      <button onClick={() => navigate('?settings=open&settingsTab=git')}>Open Git</button>
      <button onClick={() => navigate('?settings=open&settingsTab=logs')}>Open Logs</button>
      <button onClick={() => navigate('?settings=open')}>Open Settings</button>
      <button onClick={() => navigate('/')}>Close Settings</button>
    </>
  )
}

describe('SettingsDialog', () => {
  it('resets to the menu when the dialog closes and reopens', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <SettingsNavigation />
        <SettingsDialog />
      </>,
      { initialEntries: ['/'], fetchRoutes },
    )

    await user.click(screen.getByRole('button', { name: 'Open General' }))
    expect(await screen.findByRole('heading', { name: 'General Preferences' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close Settings' }))
    expect(screen.queryByRole('heading', { name: 'General Preferences' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open Settings' }))

    const mobile = within(mobileContainer())
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('General Settings')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'General Preferences' })).not.toBeInTheDocument()
  })

  it('lists every settings section in the mobile menu', async () => {
    renderSettingsDialog({ initialEntries: ['/?settings=open'] })

    const mobile = within(mobileContainer())
    expect(await mobile.findByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument()
    ;['Account', 'General Settings', 'Notifications', 'Voice', 'Git', 'Keyboard Shortcuts', 'Servers', 'OpenCode Config', 'Logs', 'Providers'].forEach((label) => {
      expect(mobile.getByText(label)).toBeInTheDocument()
    })
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobile.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('opens the menu without a section when opened through the settings action', async () => {
    function SettingsAction() {
      const navigate = useNavigate()
      const location = useLocation()
      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          <span data-testid="location-search">{location.search}</span>
        </>
      )
    }
    renderWithProviders(
      <>
        <SettingsAction />
        <SettingsDialog />
      </>,
      { initialEntries: ['/'], fetchRoutes },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))

    expect(await within(mobileContainer()).findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('settings=open')
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('settingsTab')
  })

  it('navigates to the Logs section and reflects settingsTab=logs in the URL', async () => {
    const user = userEvent.setup()
    const capturedSearch = { current: '' }
    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} />
        <SettingsNavigation />
        <SettingsDialog />
      </>,
      { initialEntries: ['/'], fetchRoutes },
    )

    await user.click(screen.getByRole('button', { name: 'Open Settings' }))
    await user.click(screen.getByRole('button', { name: /Live manager and OpenCode server logs/ }))

    const mobile = within(mobileContainer())
    expect(mobile.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(await mobile.findByText('Server started on port 5003')).toBeInTheDocument()
    await act(async () => {
      expect(capturedSearch.current).toContain('settingsTab=logs')
    })
  })

  it('opens the deep-linked settings tab on mobile and returns to the menu from it', async () => {
    const user = userEvent.setup()
    renderSettingsDialog({ initialEntries: ['/?settings=open&settingsTab=logs'] })

    const mobile = within(mobileContainer())
    expect(await mobile.findByText('Server started on port 5003')).toBeInTheDocument()
    expect(mobile.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()

    await user.click(mobile.getByRole('button', { name: 'Back' }))

    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('switches the mobile section when the settingsTab param changes while open', async () => {
    const user = userEvent.setup()
    const capturedSearch = { current: '' }
    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} />
        <SettingsNavigation />
        <SettingsDialog />
      </>,
      { initialEntries: ['/?settings=open'], fetchRoutes },
    )

    const mobile = within(mobileContainer())
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open Git' }))

    expect(await mobile.findByRole('heading', { name: 'Git Configuration' })).toBeInTheDocument()
    expect(capturedSearch.current).toContain('settingsTab=git')
  })

  it('mounts exactly one Logs viewer on desktop when the Logs tab is selected', async () => {
    renderSettingsDialog({ desktop: true, initialEntries: ['/?settings=open&settingsTab=logs'] })

    expect(await screen.findByText('Server started on port 5003')).toBeInTheDocument()
    expect(screen.getAllByText('Server started on port 5003')).toHaveLength(1)
    expect(document.querySelector('.sm\\:hidden')).toBeNull()
  })

  it('mounts the deep-linked tab content once on desktop', async () => {
    renderSettingsDialog({ desktop: true, initialEntries: ['/?settings=open&settingsTab=general'] })

    expect(await screen.findByRole('heading', { name: 'General Preferences' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'General Preferences' })).toHaveLength(1)
    expect(document.querySelectorAll('#appearance')).toHaveLength(1)
    expect(document.querySelector('.sm\\:hidden')).toBeNull()
  })

  it('falls back to the menu for an unknown settingsTab value on mobile', async () => {
    renderSettingsDialog({ initialEntries: ['/?settings=open&settingsTab=log'] })

    const mobile = within(mobileContainer())
    expect(await mobile.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobile.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('selects the account tab on desktop for an unknown settingsTab value', async () => {
    renderSettingsDialog({ desktop: true, initialEntries: ['/?settings=open&settingsTab=log'] })

    expect(await screen.findByRole('tab', { name: 'Account' })).toHaveAttribute('data-state', 'active')
    expect(await screen.findByText('Profile')).toBeInTheDocument()
    expect(document.querySelector('.sm\\:hidden')).toBeNull()
  })

  it('mounts a deep-linked mobile section once and keeps label associations', async () => {
    renderSettingsDialog({ initialEntries: ['/?settings=open&settingsTab=general'] })

    const mobile = within(mobileContainer())
    const appearance = await mobile.findByRole('combobox', { name: 'Appearance' })
    expect(mobile.getAllByRole('combobox', { name: 'Appearance' })).toHaveLength(1)
    expect(document.querySelectorAll('#appearance')).toHaveLength(1)
    expect(document.getElementById('appearance')).toBe(appearance)
  })

  it('renders a vertical desktop sidebar driven by menu items with URL and keyboard navigation', async () => {
    installMatchMedia(true)
    installPointerCapture()
    const capturedSearch = { current: '' }
    renderWithProviders(
      <>
        <LocationCatcher capturedSearch={capturedSearch} />
        <SettingsDialog />
      </>,
      { initialEntries: ['/?settings=open'], fetchRoutes },
    )

    await screen.findByText('Profile')
    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')

    const triggers = screen.getAllByRole('tab')
    expect(triggers).toHaveLength(10)
    const expected = ['Account', 'General Settings', 'Notifications', 'Voice', 'Git', 'Keyboard Shortcuts', 'Servers', 'OpenCode Config', 'Logs', 'Providers']
    expect(triggers.map((trigger) => trigger.textContent)).toEqual(expected)

    const logsTrigger = screen.getByRole('tab', { name: 'Logs' })
    fireEvent.mouseDown(logsTrigger)
    expect(capturedSearch.current).toContain('settingsTab=logs')

    const gitTrigger = screen.getByRole('tab', { name: 'Git' })
    act(() => {
      gitTrigger.focus()
    })
    fireEvent.keyDown(gitTrigger, { key: 'ArrowDown' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('tab', { name: 'Keyboard Shortcuts' })).toHaveFocus()
  })

  it('keeps Settings open when Escape fires inside a nested dialog', async () => {
    function NestedDialog() {
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
    renderWithProviders(<NestedDialog />, { initialEntries: ['/?settings=open'], fetchRoutes })

    expect(await screen.findByTestId('settings-open')).toBeInTheDocument()

    const nestedInput = screen.getByTestId('nested-input')
    nestedInput.focus()
    fireEvent.keyDown(nestedInput, { key: 'Escape' })

    expect(screen.getByTestId('settings-open')).toBeInTheDocument()
  })

  it('keeps Settings open when Escape closes an open Select', async () => {
    function OpenSelect() {
      const location = useLocation()
      const settingsOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {settingsOpen && <span data-testid="settings-open" />}
          <SettingsDialog />
          <Select defaultOpen>
            <SelectTrigger aria-label="Theme">
              <SelectValue placeholder="Theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </>
      )
    }
    renderWithProviders(<OpenSelect />, { initialEntries: ['/?settings=open&settingsTab=general'], fetchRoutes })

    const listbox = await screen.findByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-open')).toBeInTheDocument()
  })

  it('closes Settings on Escape when no dropdown or nested dialog is open', async () => {
    function EscapeTarget() {
      const location = useLocation()
      const settingsOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {settingsOpen && <span data-testid="settings-open" />}
          <SettingsDialog />
        </>
      )
    }
    renderWithProviders(<EscapeTarget />, { initialEntries: ['/?settings=open'], fetchRoutes })

    expect(await screen.findByTestId('settings-open')).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByTestId('settings-open')).not.toBeInTheDocument()
  })
})
