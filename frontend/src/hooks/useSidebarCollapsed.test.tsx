import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarCollapsed, useSidebarSectionCollapsed } from './useSidebarCollapsed'

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

describe('sidebar collapse hooks', () => {
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

  describe('useSidebarCollapsed', () => {
    it('returns false by default when no stored value', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const { result } = renderHook(() => useSidebarCollapsed())

      expect(result.current[0]).toBe(false)
    })

    it('returns stored value from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('true')

      const { result } = renderHook(() => useSidebarCollapsed())

      expect(result.current[0]).toBe(true)
    })

    it('toggles collapsed state and persists to localStorage', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const { result } = renderHook(() => useSidebarCollapsed())

      expect(result.current[0]).toBe(false)

      act(() => {
        result.current[1]()
      })

      expect(result.current[0]).toBe(true)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:collapsed', 'true')
    })

    it('returns false when stored value is malformed JSON', () => {
      localStorageMock.getItem.mockReturnValue('not-json{{')

      const { result } = renderHook(() => useSidebarCollapsed())

      expect(result.current[0]).toBe(false)
    })

    it('returns false when stored value is JSON but not a boolean', () => {
      localStorageMock.getItem.mockReturnValue('"some string"')

      const { result } = renderHook(() => useSidebarCollapsed())

      expect(result.current[0]).toBe(false)
    })
  })

  describe('useSidebarSectionCollapsed', () => {
    it('returns false by default when no stored value', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const { result } = renderHook(() => useSidebarSectionCollapsed('sessions'))

      expect(result.current[0]).toBe(false)
    })

    it('returns stored value from the section key', () => {
      localStorageMock.getItem.mockReturnValue('true')

      const { result } = renderHook(() => useSidebarSectionCollapsed('menu'))

      expect(localStorageMock.getItem).toHaveBeenCalledWith('oc:sidebar:collapsed:menu')
      expect(result.current[0]).toBe(true)
    })

    it('toggles collapsed state and persists under the section key', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const { result } = renderHook(() => useSidebarSectionCollapsed('sessions'))

      expect(result.current[0]).toBe(false)

      act(() => {
        result.current[1]()
      })

      expect(result.current[0]).toBe(true)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('oc:sidebar:collapsed:sessions', 'true')
    })
  })
})
