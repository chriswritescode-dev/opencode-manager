/* eslint-disable react-refresh/only-export-components */

import { useEffect, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import type { useSettings } from '@/hooks/useSettings'

export function createUseSettingsMock(
  overrides: Partial<ReturnType<typeof useSettings>> = {},
): ReturnType<typeof useSettings> {
  return {
    settings: undefined,
    preferences: undefined,
    isLoading: false,
    error: null,
    updateSettings: vi.fn(),
    updateSettingsAsync: vi.fn(),
    resetSettings: vi.fn(),
    isUpdating: false,
    isResetting: false,
    ...overrides,
  }
}

export function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQueryList = {
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  })
  return { mediaQueryList, listeners }
}

export function createRouterWrapper(initialEntries?: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

export function renderHookWithRouter<T>(renderFn: () => T, initialEntries?: string[]) {
  return renderHook(renderFn, { wrapper: createRouterWrapper(initialEntries) })
}

export function LocationCatcher({ capturedSearch }: { capturedSearch: { current: string } }) {
  const location = useLocation()
  useEffect(() => {
    capturedSearch.current = location.search
  })
  return null
}

export function renderHookWithRouterAndLocation<T>(renderFn: () => T, initialEntries?: string[]) {
  const capturedSearch: { current: string } = { current: '' }
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <LocationCatcher capturedSearch={capturedSearch} />
        {children}
      </MemoryRouter>
    )
  }
  const rendered = renderHook(renderFn, { wrapper })
  return { ...rendered, capturedSearch }
}
