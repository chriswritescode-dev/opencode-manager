import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useTheme } from './useTheme'
import { APPEARANCE_STORAGE_KEY } from '@/lib/theme/colorTheme'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { renderHookWithProviders } from '@/test/render'
import { installMatchMedia } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

type ThemePreference = { theme: 'dark' | 'light' | 'system'; colorTheme: 'dracula' | 'manager' | 'oc-2' | 'catppuccin-frappe' }

const settingsRoute = (preferences: ThemePreference | undefined): FetchRoute => ({
  method: 'GET',
  path: '/api/settings',
  respond: () => ({ json: makeSettingsResponse({ preferences: makeUserPreferences(preferences) }) }),
})

const failingSettingsRoute: FetchRoute = {
  method: 'GET',
  path: '/api/settings',
  respond: () => ({ status: 500, json: { error: 'unavailable' } }),
}

function renderTheme(
  preferences: ThemePreference | undefined,
  routes: FetchRoute[] = [settingsRoute(preferences)],
) {
  return renderHookWithProviders(() => useTheme(), {
    tts: false,
    fetchRoutes: routes,
  })
}

function settingsQueryKey() {
  return ['settings', 'default']
}

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    localStorage.clear()
  })

  afterEach(() => {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
  })

  it('applies the dark Dracula palette and reports dark', async () => {
    const { result } = renderTheme({ theme: 'dark', colorTheme: 'dracula' })

    await waitFor(() => expect(result.current).toBe('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
  })

  it('applies the light Dracula palette and reports light', async () => {
    const { result } = renderTheme({ theme: 'light', colorTheme: 'dracula' })

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#f8f8f2'),
    )
    expect(result.current).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('clears palette overrides when the manager theme is selected', async () => {
    const r = renderTheme({ theme: 'dark', colorTheme: 'dracula' })

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28'),
    )

    r.queryClient.setQueryData(
      settingsQueryKey(),
      makeSettingsResponse({ preferences: makeUserPreferences({ theme: 'dark', colorTheme: 'manager' }) }),
    )

    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--color-background')).toBe(''))
  })

  it('follows the system color scheme and updates when it changes', async () => {
    const media = installMatchMedia(false)
    const { result } = renderTheme({ theme: 'system', colorTheme: 'dracula' })

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#f8f8f2'),
    )

    act(() => {
      media.setMatches(true)
    })

    await waitFor(() => expect(result.current).toBe('dark'))
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
  })

  it('registers a single matchMedia listener for multiple consumers under one provider', async () => {
    const media = installMatchMedia(false)
    const { result } = renderHookWithProviders(
      () => ({ first: useTheme(), second: useTheme() }),
      { tts: false, fetchRoutes: [settingsRoute({ theme: 'system', colorTheme: 'dracula' })] },
    )

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#f8f8f2'),
    )
    expect(result.current.first).toBe('light')
    expect(media.listeners.size).toBe(1)
  })

  it('falls back to the document mode outside a provider', () => {
    document.documentElement.classList.add('dark')
    const dark = renderHook(() => useTheme())
    expect(dark.result.current).toBe('dark')

    document.documentElement.classList.remove('dark')
    const light = renderHook(() => useTheme())
    expect(light.result.current).toBe('light')
  })

  it('keeps the boot-replayed appearance while preferences are unavailable', async () => {
    document.documentElement.style.setProperty('--color-background', '#1d1e28')
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'replayed')

    const { result, queryClient } = renderTheme(undefined, [failingSettingsRoute])

    await waitFor(() => expect(queryClient.getQueryState(settingsQueryKey())?.status).toBe('error'))
    expect(result.current).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#1d1e28')
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('replayed')
  })

  it('persists the appearance snapshot through the provider', async () => {
    const { queryClient } = renderTheme({ theme: 'dark', colorTheme: 'dracula' })

    await waitFor(() => expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).not.toBeNull())
    expect(queryClient.getQueryData<{ preferences?: unknown }>(settingsQueryKey())?.preferences).toBeDefined()
  })
})
