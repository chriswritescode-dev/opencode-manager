import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePersistentBoolean } from './usePersistentBoolean'

const STORAGE_KEY = 'oc:test:flag'

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

describe('usePersistentBoolean', () => {
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

  it('returns the fallback when no stored value', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, false))

    expect(localStorageMock.getItem).toHaveBeenCalledWith(STORAGE_KEY)
    expect(result.current[0]).toBe(false)
  })

  it('returns a stored true value', () => {
    localStorageMock.getItem.mockReturnValue('true')

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, false))

    expect(result.current[0]).toBe(true)
  })

  it('toggles the value and persists it to localStorage', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, false))

    expect(result.current[0]).toBe(false)

    act(() => {
      result.current[1]()
    })

    expect(result.current[0]).toBe(true)
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'true')
  })

  it('returns the fallback when the stored value is malformed JSON', () => {
    localStorageMock.getItem.mockReturnValue('not-json{{')

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, false))

    expect(result.current[0]).toBe(false)
  })

  it('returns the fallback when the stored value is JSON but not a boolean', () => {
    localStorageMock.getItem.mockReturnValue('"some string"')

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, false))

    expect(result.current[0]).toBe(false)
  })

  it('honours a true fallback when no value is stored', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => usePersistentBoolean(STORAGE_KEY, true))

    expect(result.current[0]).toBe(true)
  })
})
