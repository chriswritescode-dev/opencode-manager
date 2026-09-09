import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralSettings } from './GeneralSettings'
import { useSettings } from '@/hooks/useSettings'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import type { UserPreferences } from '@/api/types/settings'
import type { VersionInfo } from '@/api/settings'

vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useVersionCheck')

const basePreferences: UserPreferences = {
  theme: 'dark',
  mode: 'build',
  autoScroll: true,
  expandDiffs: true,
  expandToolCalls: false,
  showReasoning: false,
  simpleChatMode: false,
  keyboardShortcuts: {},
  customCommands: [],
}

const baseVersionInfo: VersionInfo = {
  currentVersion: 'v1.2.3',
  latestVersion: null,
  updateAvailable: false,
  releaseUrl: null,
  releaseName: null,
}

function mockUseSettings(overrides: Partial<ReturnType<typeof useSettings>> = {}) {
  vi.mocked(useSettings).mockReturnValue({
    settings: undefined,
    preferences: basePreferences,
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
    updateSettingsAsync: vi.fn(),
    resetSettings: vi.fn(),
    isUpdating: false,
    isResetting: false,
    ...overrides,
  })
}

function mockVersionInfo(overrides: Partial<VersionInfo> = {}) {
  vi.mocked(useVersionCheck).mockReturnValue({
    data: { ...baseVersionInfo, ...overrides },
    isLoading: false,
  } as ReturnType<typeof useVersionCheck>)
}

describe('GeneralSettings', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the compact heading row with version info and associated preference rows', () => {
    mockUseSettings()
    mockVersionInfo({ latestVersion: '1.3.0', updateAvailable: true, releaseUrl: 'https://example.com/release' })
    render(<GeneralSettings />)

    expect(screen.getByRole('heading', { name: 'General Preferences' })).toBeInTheDocument()
    expect(screen.getByText('OpenCode Manager')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'v1.3.0 available' })).toHaveAttribute('href', 'https://example.com/release')

    expect(screen.getByLabelText('Theme')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Simple chat mode' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Auto-scroll' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Show reasoning' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Expand tool calls' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Expand diffs' })).toBeChecked()
  })

  it('writes the theme and toggle preferences', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn()
    mockUseSettings({ updateSettings })
    mockVersionInfo()
    render(<GeneralSettings />)

    await user.click(screen.getByRole('combobox', { name: 'Theme' }))
    await user.click(screen.getByRole('option', { name: 'Light' }))

    expect(updateSettings).toHaveBeenCalledWith({ theme: 'light' })

    await user.click(screen.getByRole('switch', { name: 'Auto-scroll' }))
    expect(updateSettings).toHaveBeenCalledWith({ autoScroll: false })
  })

  it('hides the reasoning, tool call, and diff rows while simple chat mode is on', () => {
    mockUseSettings({ preferences: { ...basePreferences, simpleChatMode: true } })
    mockVersionInfo()
    render(<GeneralSettings />)

    expect(screen.queryByRole('switch', { name: 'Show reasoning' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Expand tool calls' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Expand diffs' })).not.toBeInTheDocument()
  })

  it('shows the saving state while preferences are updating', () => {
    mockUseSettings({ isUpdating: true })
    mockVersionInfo()
    render(<GeneralSettings />)

    expect(screen.getByText('Saving...')).toBeInTheDocument()
  })
})
