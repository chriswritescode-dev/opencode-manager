import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useUsageRangePreference,
  useUsageModelsPreference,
  USAGE_RANGE_STORAGE_KEY,
  SESSION_USAGE_RANGE_STORAGE_KEY,
  USAGE_MODELS_STORAGE_KEY,
} from './useUsagePreferences'

const realLocalStorage = window.localStorage

function createLocalStorageMock() {
  const store = new Map<string, string>()

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    clear: vi.fn(() => {
      store.clear()
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length(): number {
      return store.size
    },
  }
}

let storage = createLocalStorageMock()

describe('useUsagePreferences', () => {
  beforeEach(() => {
    storage = createLocalStorageMock()
    Object.defineProperty(global, 'localStorage', {
      value: storage,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(global, 'localStorage', {
      value: realLocalStorage,
      writable: true,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  describe('useUsageRangePreference', () => {
    it('returns the fallback and reads the passed storage key when nothing is stored', () => {
      const fallback = { preset: '4h' } as const

      const { result } = renderHook(() => useUsageRangePreference(USAGE_RANGE_STORAGE_KEY, fallback))

      expect(storage.getItem).toHaveBeenCalledWith(USAGE_RANGE_STORAGE_KEY)
      expect(result.current[0]).toEqual(fallback)
    })

    it('returns a valid stored selection for the session storage key', () => {
      storage.setItem(SESSION_USAGE_RANGE_STORAGE_KEY, JSON.stringify({ preset: 'custom', from: 1000, to: 2000 }))

      const { result } = renderHook(() =>
        useUsageRangePreference(SESSION_USAGE_RANGE_STORAGE_KEY, { preset: 'all' }),
      )

      expect(storage.getItem).toHaveBeenCalledWith(SESSION_USAGE_RANGE_STORAGE_KEY)
      expect(result.current[0]).toEqual({ preset: 'custom', from: 1000, to: 2000 })
    })

    it('falls back when the stored value is corrupt JSON', () => {
      storage.setItem(USAGE_RANGE_STORAGE_KEY, 'not-json{{')

      const { result } = renderHook(() =>
        useUsageRangePreference(USAGE_RANGE_STORAGE_KEY, { preset: '24h' }),
      )

      expect(result.current[0]).toEqual({ preset: '24h' })
    })

    it('falls back when the stored value is valid JSON but not a valid selection', () => {
      storage.setItem(USAGE_RANGE_STORAGE_KEY, JSON.stringify({ preset: 'tomorrow' }))

      const { result } = renderHook(() =>
        useUsageRangePreference(USAGE_RANGE_STORAGE_KEY, { preset: '24h' }),
      )

      expect(result.current[0]).toEqual({ preset: '24h' })
    })

    it('persists a new selection under the passed key and reads it back on a fresh mount', () => {
      const selection = { preset: 'custom', from: 1000, to: 2000 } as const

      const { result, unmount } = renderHook(() =>
        useUsageRangePreference(USAGE_RANGE_STORAGE_KEY, { preset: '4h' }),
      )

      act(() => {
        result.current[1](selection)
      })

      expect(storage.setItem).toHaveBeenCalledWith(
        USAGE_RANGE_STORAGE_KEY,
        JSON.stringify({ preset: 'custom', from: 1000, to: 2000 }),
      )
      expect(result.current[0]).toEqual(selection)

      unmount()

      const remount = renderHook(() =>
        useUsageRangePreference(USAGE_RANGE_STORAGE_KEY, { preset: '4h' }),
      )

      expect(remount.result.current[0]).toEqual(selection)
    })
  })

  describe('useUsageModelsPreference', () => {
    it('returns an empty list and reads the models storage key when nothing is stored', () => {
      const { result } = renderHook(() => useUsageModelsPreference())

      expect(storage.getItem).toHaveBeenCalledWith(USAGE_MODELS_STORAGE_KEY)
      expect(result.current[0]).toEqual([])
    })

    it('returns a valid stored model list', () => {
      storage.setItem(USAGE_MODELS_STORAGE_KEY, JSON.stringify(['anthropic/claude', 'openai/gpt']))

      const { result } = renderHook(() => useUsageModelsPreference())

      expect(result.current[0]).toEqual(['anthropic/claude', 'openai/gpt'])
    })

    it('falls back to an empty list for corrupt JSON and invalid shapes', () => {
      storage.setItem(USAGE_MODELS_STORAGE_KEY, 'not-json{{')
      const corrupt = renderHook(() => useUsageModelsPreference())
      expect(corrupt.result.current[0]).toEqual([])

      storage.setItem(USAGE_MODELS_STORAGE_KEY, JSON.stringify([1, 2]))
      const invalid = renderHook(() => useUsageModelsPreference())
      expect(invalid.result.current[0]).toEqual([])
    })

    it('persists a new list under the models key and reads it back on a fresh mount', () => {
      const { result, unmount } = renderHook(() => useUsageModelsPreference())

      act(() => {
        result.current[1](['anthropic/claude'])
      })

      expect(storage.setItem).toHaveBeenCalledWith(USAGE_MODELS_STORAGE_KEY, JSON.stringify(['anthropic/claude']))
      expect(result.current[0]).toEqual(['anthropic/claude'])

      unmount()

      const remount = renderHook(() => useUsageModelsPreference())

      expect(remount.result.current[0]).toEqual(['anthropic/claude'])
    })
  })

  describe('storage keys', () => {
    it('exports the expected oc:usage storage keys', () => {
      expect(USAGE_RANGE_STORAGE_KEY).toBe('oc:usage:range')
      expect(SESSION_USAGE_RANGE_STORAGE_KEY).toBe('oc:usage:session-range')
      expect(USAGE_MODELS_STORAGE_KEY).toBe('oc:usage:models')
    })
  })
})
