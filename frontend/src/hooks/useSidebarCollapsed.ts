import { useState, useCallback } from 'react'

const STORAGE_KEY = 'oc:sidebar:collapsed'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStorage(key)
  if (stored === null) {
    return fallback
  }
  try {
    const parsed = JSON.parse(stored)
    return typeof parsed === 'boolean' ? parsed : fallback
  } catch {
    return fallback
  }
}

/**
 * Persists a boolean preference under `key` in localStorage and returns it with a toggler.
 * Falls back to `fallback` when the stored value is missing or malformed.
 */
export function usePersistentBoolean(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => readStoredBoolean(key, fallback))

  const toggle = useCallback(() => {
    setValue((prev: boolean) => {
      const newValue = !prev
      writeStorage(key, newValue)
      return newValue
    })
  }, [key])

  return [value, toggle]
}

export function useSidebarCollapsed(): [boolean, () => void] {
  return usePersistentBoolean(STORAGE_KEY, false)
}
