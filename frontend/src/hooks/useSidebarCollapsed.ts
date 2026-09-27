import { useState, useCallback } from 'react'

const STORAGE_KEY = 'oc:sidebar:collapsed'

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback
  }
  const stored = localStorage.getItem(key)
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

function usePersistentBoolean(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => readStoredBoolean(key, fallback))

  const toggle = useCallback(() => {
    setValue((prev: boolean) => {
      const newValue = !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(newValue))
      }
      return newValue
    })
  }, [key])

  return [value, toggle]
}

export function useSidebarCollapsed(): [boolean, () => void] {
  return usePersistentBoolean(STORAGE_KEY, false)
}

export function useSidebarSectionCollapsed(section: string): [boolean, () => void] {
  return usePersistentBoolean(`${STORAGE_KEY}:${section}`, false)
}
