import { useCallback, useState } from 'react'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480

const STORAGE_KEY = 'oc:sidebar:width'

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function readStoredWidth(): number {
  const stored = readStoredValue(STORAGE_KEY)
  if (stored === null) {
    return SIDEBAR_DEFAULT_WIDTH
  }
  try {
    const parsed: unknown = JSON.parse(stored)
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

/**
 * Persists the desktop sidebar width under `oc:sidebar:width` and returns it with a clamped setter.
 * Falls back to `SIDEBAR_DEFAULT_WIDTH` when the stored value is missing, malformed, or not finite.
 */
export function useSidebarWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState<number>(readStoredWidth)

  const updateWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next)
    writeStoredValue(STORAGE_KEY, clamped)
    setWidth(clamped)
  }, [])

  return [width, updateWidth]
}
