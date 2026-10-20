import { create } from 'zustand'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

export const SIDEBAR_SERVER_STORAGE_KEY = 'oc:sidebar:server'

function readStoredServerId(): string {
  const stored = readStoredValue(SIDEBAR_SERVER_STORAGE_KEY)
  if (stored === null) return LOCAL_OPENCODE_SERVER_ID
  try {
    const parsed = JSON.parse(stored)
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : LOCAL_OPENCODE_SERVER_ID
  } catch {
    return LOCAL_OPENCODE_SERVER_ID
  }
}

interface SidebarServerStore {
  serverId: string
  selectServer: (serverId: string) => void
}

/**
 * The server whose projects and sessions the sidebar lists. Shared by the desktop sidebar, its
 * collapsed switcher, and the mobile repo sheet, and persisted across reloads.
 */
export const useSidebarServerStore = create<SidebarServerStore>((set) => ({
  serverId: readStoredServerId(),
  selectServer: (serverId) => {
    writeStoredValue(SIDEBAR_SERVER_STORAGE_KEY, serverId)
    set({ serverId })
  },
}))
