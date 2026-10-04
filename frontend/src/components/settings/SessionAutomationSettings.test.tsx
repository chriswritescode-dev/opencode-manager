import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
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

  it('saves the goal auditor model once on blur with the final value', () => {
    const updateSettings = vi.fn()
    mockUseSettings({
      preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
      updateSettings,
    })
    render(<SessionAutomationSettings />)

    const input = screen.getByLabelText('Goal auditor model')
    fireEvent.change(input, { target: { value: 'anthropic/claude-sonnet-4' } })
    fireEvent.blur(input)

    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({
      sessionDefaults: {
        permissionMode: 'ask',
        goalMaxContinuations: 20,
        goalAuditorModel: 'anthropic/claude-sonnet-4',
      },
    })
  })

  it('saves the goal auditor model after the debounce without blurring', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
        updateSettings,
      })
      render(<SessionAutomationSettings />)

      fireEvent.change(screen.getByLabelText('Goal auditor model'), {
        target: { value: 'anthropic/claude-sonnet-4' },
      })
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({
        sessionDefaults: {
          permissionMode: 'ask',
          goalMaxContinuations: 20,
          goalAuditorModel: 'anthropic/claude-sonnet-4',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves an in-range max automatic continuations on blur', () => {
    const updateSettings = vi.fn()
    mockUseSettings({
      preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
      updateSettings,
    })
    render(<SessionAutomationSettings />)

    const input = screen.getByLabelText('Max automatic continuations')
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.blur(input)

    expect(updateSettings).toHaveBeenCalledWith({
      sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 50 },
    })
  })

  it('does not save out-of-range max automatic continuations', () => {
    const updateSettings = vi.fn()
    mockUseSettings({
      preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
      updateSettings,
    })
    render(<SessionAutomationSettings />)

    const input = screen.getByLabelText('Max automatic continuations')
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.blur(input)

    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('saves the token budget per goal on blur', () => {
    const updateSettings = vi.fn()
    mockUseSettings({
      preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
      updateSettings,
    })
    render(<SessionAutomationSettings />)

    const input = screen.getByLabelText('Token budget per goal')
    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.blur(input)

    expect(updateSettings).toHaveBeenCalledWith({
      sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20, goalTokenBudget: 5000 },
    })
  })
})
