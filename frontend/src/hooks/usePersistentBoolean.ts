import { useState, useCallback } from 'react'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStoredValue(key)
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
      writeStoredValue(key, newValue)
      return newValue
    })
  }, [key])

  return [value, toggle]
}
