import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionAutomationSettings } from './SessionAutomationSettings'
import { useSettings } from '@/hooks/useSettings'
import type { UserPreferences } from '@/api/types/settings'
import type { Provider } from '@/api/providers'
import { createUseSettingsMock } from '@/test/test-utils'

vi.mock('@/hooks/useSettings')

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
}))

vi.mock('@/hooks/useProviders', () => ({ useProviders: mocks.useProviders }))
vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
}))

const providers: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4', key: 'claude-sonnet-4', name: 'Claude Sonnet 4', released: 0, free: false },
    ],
  },
]

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
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] } })
    mocks.useOpenCodeModelState.mockReturnValue({ data: { favorite: [], recent: [], variant: {} } })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: null })
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

  it('saves the goal auditor model chosen from the combobox after the debounce', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, sessionDefaults: { permissionMode: 'ask', goalMaxContinuations: 20 } },
        updateSettings,
      })
      render(<SessionAutomationSettings />)

      fireEvent.focus(screen.getByLabelText('Goal auditor model'))
      fireEvent.click(screen.getByRole('option', { name: /Claude Sonnet 4/ }))
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

  it('clears the goal auditor model', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: {
          ...basePreferences,
          sessionDefaults: {
            permissionMode: 'ask',
            goalMaxContinuations: 20,
            goalAuditorModel: 'anthropic/claude-sonnet-4',
          },
        },
        updateSettings,
      })
      render(<SessionAutomationSettings />)

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({
        sessionDefaults: {
          permissionMode: 'ask',
          goalMaxContinuations: 20,
          goalAuditorModel: undefined,
        },
      })
    } finally {
      vi.useRealTimers()
    }
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

  it('saves the auditor model and max continuations together after the debounce', () => {
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
      fireEvent.change(screen.getByLabelText('Max automatic continuations'), {
        target: { value: '50' },
      })
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({
        sessionDefaults: {
          permissionMode: 'ask',
          goalAuditorModel: 'anthropic/claude-sonnet-4',
          goalMaxContinuations: 50,
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
