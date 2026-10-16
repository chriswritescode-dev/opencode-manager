import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivitySettings } from './ActivitySettings'
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

describe('ActivitySettings', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the default window when the preference is unset', () => {
    mockUseSettings()
    render(<ActivitySettings />)

    expect(screen.getByRole('combobox', { name: 'Recent activity window' })).toHaveTextContent('30 minutes')
  })

  it('shows the stored window', () => {
    mockUseSettings({ preferences: { ...basePreferences, activityWindowMinutes: 120 } })
    render(<ActivitySettings />)

    expect(screen.getByRole('combobox', { name: 'Recent activity window' })).toHaveTextContent('2 hours')
  })

  it('shows a stored window that is not a preset option', () => {
    mockUseSettings({ preferences: { ...basePreferences, activityWindowMinutes: 45 } })
    render(<ActivitySettings />)

    expect(screen.getByRole('combobox', { name: 'Recent activity window' })).toHaveTextContent('45 minutes')
  })

  it('saves the chosen window in minutes', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn()
    mockUseSettings({ updateSettings })
    render(<ActivitySettings />)

    await user.click(screen.getByRole('combobox', { name: 'Recent activity window' }))
    await user.click(screen.getByRole('option', { name: '4 hours' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ activityWindowMinutes: 240 })
  })
})
