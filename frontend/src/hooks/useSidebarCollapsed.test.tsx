import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarCollapsed } from './useSidebarCollapsed'

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

describe('useSidebarCollapsed', () => {
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

  it('reads and persists under the sidebar storage key with a false default', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useSidebarCollapsed())

    expect(localStorageMock.getItem).toHaveBeenCalledWith('oc:sidebar:collapsed')
    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1]()
    })

    expect(result.current[0]).toBe(true)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:collapsed', 'true')
  })

  it('returns the stored value', () => {
    localStorageMock.getItem.mockReturnValue('true')

    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current[0]).toBe(true)
  })

  it('shares the collapse state between consumers', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const first = renderHook(() => useSidebarCollapsed())
    const second = renderHook(() => useSidebarCollapsed())

    act(() => {
      first.result.current[1]()
    })

    expect(first.result.current[0]).toBe(true)
    expect(second.result.current[0]).toBe(true)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:collapsed', 'true')
  })
})
