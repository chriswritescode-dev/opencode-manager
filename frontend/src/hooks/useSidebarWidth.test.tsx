import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  clampSidebarWidth,
  useSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './useSidebarWidth'

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

describe('useSidebarWidth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(global, 'localStorage', {
      value: window.localStorage,
      writable: true,
    })
    vi.restoreAllMocks()
  })

  it('falls back to the default width when nothing is stored', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useSidebarWidth())

    expect(localStorageMock.getItem).toHaveBeenCalledWith('oc:sidebar:width')
    expect(result.current[0]).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('reads a stored width', () => {
    localStorageMock.getItem.mockReturnValue('320')

    const { result } = renderHook(() => useSidebarWidth())

    expect(result.current[0]).toBe(320)
  })

  it.each(['not json', '"320"', 'null', 'true', '{}'])(
    'ignores the malformed stored value %s',
    (stored) => {
      localStorageMock.getItem.mockReturnValue(stored)

      const { result } = renderHook(() => useSidebarWidth())

      expect(result.current[0]).toBe(SIDEBAR_DEFAULT_WIDTH)
    }
  )

  it('clamps and persists the setter value below the minimum', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useSidebarWidth())

    act(() => {
      result.current[1](100)
    })

    expect(result.current[0]).toBe(SIDEBAR_MIN_WIDTH)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:width', '200')
  })

  it('clamps and persists the setter value above the maximum', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useSidebarWidth())

    act(() => {
      result.current[1](900)
    })

    expect(result.current[0]).toBe(SIDEBAR_MAX_WIDTH)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:width', '480')
  })

  it('rounds and clamps in clampSidebarWidth', () => {
    expect(clampSidebarWidth(250.6)).toBe(251)
    expect(clampSidebarWidth(100.4)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX_WIDTH)
  })
})
