import { useCallback, useState } from 'react'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

export const SIDEBAR_DEFAULT_WIDTH = 240
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480

const STORAGE_KEY = 'oc:sidebar:width'

const widthStorageSchema = z.number()

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function readStoredWidth(): number {
  const stored = readStoredValue(STORAGE_KEY)
  if (stored === null) {
    return SIDEBAR_DEFAULT_WIDTH
  }
  const parsed = widthStorageSchema.safeParse(parseJsonText(stored))
  return parsed.success && Number.isFinite(parsed.data)
    ? clampSidebarWidth(parsed.data)
    : SIDEBAR_DEFAULT_WIDTH
}

export function useSidebarWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState<number>(readStoredWidth)

  const updateWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next)
    writeStoredValue(STORAGE_KEY, clamped)
    setWidth(clamped)
  }, [])

  return [width, updateWidth]
}
