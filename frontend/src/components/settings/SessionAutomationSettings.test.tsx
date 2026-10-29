import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionAutomationSettings } from './SessionAutomationSettings'
import { useSettings } from '@/hooks/useSettings'
import type { UserPreferences } from '@/api/types/settings'
import { createUseSettingsMock } from '@/test/test-utils'

vi.mock('@/hooks/useSettings')

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

function mockUseSettings(overrides: Partial<ReturnType<typeof useSettings>> = {}) {
  vi.mocked(useSettings).mockReturnValue(createUseSettingsMock({ preferences: basePreferences, ...overrides }))
}

describe('SessionAutomationSettings', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults the select to ask every time', () => {
    mockUseSettings()
    render(<SessionAutomationSettings />)

    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Default permission mode for new sessions' })).toHaveTextContent('Ask every time')
  })

  it('persists the chosen default permission mode immediately', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn()
    mockUseSettings({
      preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask' } },
      updateSettings,
    })
    render(<SessionAutomationSettings />)

    await user.click(screen.getByRole('combobox', { name: 'Default permission mode for new sessions' }))
    await user.click(screen.getByRole('option', { name: 'Accept everything' }))

    expect(updateSettings).toHaveBeenCalledWith({ sessionDefaults: { permissionMode: 'auto' } })
  })

  it('renders no goal controls', () => {
    mockUseSettings({ preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask' } } })
    render(<SessionAutomationSettings />)

    expect(screen.getByRole('combobox', { name: 'Default permission mode for new sessions' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Goal auditor model')).toBeNull()
    expect(screen.queryByLabelText('Max automatic continuations')).toBeNull()
    expect(screen.queryByLabelText('Token budget per goal')).toBeNull()
  })
})
