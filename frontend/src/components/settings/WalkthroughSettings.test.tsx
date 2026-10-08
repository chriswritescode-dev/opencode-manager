import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { WalkthroughSettings } from './WalkthroughSettings'
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

describe('WalkthroughSettings', () => {
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

  it('saves a chosen model after the debounce', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({ updateSettings })
      render(<WalkthroughSettings />)

      fireEvent.focus(screen.getByLabelText('Walkthrough model'))
      fireEvent.click(screen.getByRole('option', { name: /Claude Sonnet 4/ }))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({ walkthroughModel: 'anthropic/claude-sonnet-4' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the walkthrough model to an empty string', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, walkthroughModel: 'anthropic/claude-sonnet-4' },
        updateSettings,
      })
      render(<WalkthroughSettings />)

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).toHaveBeenCalledTimes(1)
      expect(updateSettings).toHaveBeenCalledWith({ walkthroughModel: '' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not save an unchanged value', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({
        preferences: { ...basePreferences, walkthroughModel: 'anthropic/claude-sonnet-4' },
        updateSettings,
      })
      render(<WalkthroughSettings />)

      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not save when no model is stored and the field is empty', () => {
    vi.useFakeTimers()
    try {
      const updateSettings = vi.fn()
      mockUseSettings({ updateSettings })
      render(<WalkthroughSettings />)

      act(() => {
        vi.advanceTimersByTime(800)
      })

      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
