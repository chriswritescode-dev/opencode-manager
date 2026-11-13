import { useCallback, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

const STORAGE_KEY = 'oc:sidebar:collapsed'

const booleanStorageSchema = z.boolean()

let collapsedSnapshot: boolean | null = null
const listeners = new Set<() => void>()

function readStoredCollapsed(): boolean {
  const stored = readStoredValue(STORAGE_KEY)
  if (stored === null) {
    return false
  }
  const parsed = booleanStorageSchema.safeParse(parseJsonText(stored))
  return parsed.success ? parsed.data : false
}

function getCollapsedSnapshot(): boolean {
  if (collapsedSnapshot === null) {
    collapsedSnapshot = readStoredCollapsed()
  }
  return collapsedSnapshot
}

function subscribeToCollapsed(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      collapsedSnapshot = null
    }
  }
}

function toggleCollapsed(): void {
  collapsedSnapshot = !getCollapsedSnapshot()
  writeStoredValue(STORAGE_KEY, collapsedSnapshot)
  listeners.forEach((listener) => listener())
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    getCollapsedSnapshot
  )
  return [collapsed, useCallback(toggleCollapsed, [])]
}
