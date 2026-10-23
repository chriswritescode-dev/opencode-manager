import { useCallback, useSyncExternalStore } from 'react'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

const STORAGE_KEY = 'oc:sidebar:collapsed'

let collapsedSnapshot: boolean | null = null
const listeners = new Set<() => void>()

function readStoredCollapsed(): boolean {
  const stored = readStoredValue(STORAGE_KEY)
  if (stored === null) {
    return false
  }
  try {
    const parsed: unknown = JSON.parse(stored)
    return typeof parsed === 'boolean' ? parsed : false
  } catch {
    return false
  }
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

/**
 * The persisted desktop sidebar collapse preference, shared by the sidebar's own toggle and the
 * global shortcut so both stay in sync.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    getCollapsedSnapshot
  )
  return [collapsed, useCallback(toggleCollapsed, [])]
}
