import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTheme } from './useTheme'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { useSettings } from './useSettings'
import { APPEARANCE_STORAGE_KEY } from '@/lib/theme/colorTheme'
import type { UserPreferences } from '@/api/types/settings'
import { createUseSettingsMock, stubMatchMedia } from '@/test/test-utils'

vi.mock('@/hooks/useSettings')

function mockPreferences(preferences: Partial<UserPreferences> | undefined) {
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({ preferences: preferences as UserPreferences | undefined }),
  )
}

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ThemeProvider>{children}</ThemeProvider>
  }
}

function Consumer() {
  useTheme()
  return null
}

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    window.localStorage.clear()
  })

  afterEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    Reflect.deleteProperty(window, 'matchMedia')
    vi.clearAllMocks()
  })

  it('applies the dark Dracula palette and reports dark', () => {
    mockPreferences({ theme: 'dark', colorTheme: 'dracula' })

    const { result } = renderHook(() => useTheme(), { wrapper: createWrapper() })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
    expect(result.current).toBe('dark')
  })

  it('applies the light Dracula palette and reports light', () => {
    mockPreferences({ theme: 'light', colorTheme: 'dracula' })

    const { result } = renderHook(() => useTheme(), { wrapper: createWrapper() })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#f8f8f2')
    expect(result.current).toBe('light')
  })

  it('clears palette overrides when the manager theme is selected', () => {
    mockPreferences({ theme: 'dark', colorTheme: 'dracula' })

    const { rerender } = renderHook(() => useTheme(), { wrapper: createWrapper() })
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')

    mockPreferences({ theme: 'dark', colorTheme: 'manager' })
    rerender()

    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('')
  })

  it('follows the system color scheme and updates when it changes', () => {
    const { mediaQueryList, listeners } = stubMatchMedia(false)
    mockPreferences({ theme: 'system', colorTheme: 'dracula' })

    renderHook(() => useTheme(), { wrapper: createWrapper() })
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#f8f8f2')

    act(() => {
      mediaQueryList.matches = true
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent))
    })

    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
  })

  it('registers a single matchMedia listener for multiple consumers under one provider', () => {
    const { listeners } = stubMatchMedia(false)
    mockPreferences({ theme: 'system', colorTheme: 'dracula' })

    render(
      <ThemeProvider>
        <Consumer />
        <Consumer />
      </ThemeProvider>,
    )

    expect(listeners.size).toBe(1)
  })

  it('falls back to the document mode outside a provider', () => {
    document.documentElement.classList.add('dark')
    const dark = renderHook(() => useTheme())
    expect(dark.result.current).toBe('dark')

    document.documentElement.classList.remove('dark')
    const light = renderHook(() => useTheme())
    expect(light.result.current).toBe('light')
  })

  it('keeps the boot-replayed appearance while preferences are loading', () => {
    document.documentElement.style.setProperty('--color-background', '#1d1e28')
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'replayed')
    mockPreferences(undefined)

    const { result } = renderHook(() => useTheme(), { wrapper: createWrapper() })

    expect(result.current).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('replayed')
  })

  it('persists the appearance snapshot through the provider', () => {
    mockPreferences({ theme: 'dark', colorTheme: 'dracula' })

    renderHook(() => useTheme(), { wrapper: createWrapper() })

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).not.toBeNull()
  })
})
