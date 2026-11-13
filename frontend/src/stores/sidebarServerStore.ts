import { create } from 'zustand'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { readStoredValue, writeStoredValue } from '@/lib/persistentStorage'

export const SIDEBAR_SERVER_STORAGE_KEY = 'oc:sidebar:server'

function readStoredServerId(): string {
  const stored = readStoredValue(SIDEBAR_SERVER_STORAGE_KEY)
  if (stored === null) return LOCAL_OPENCODE_SERVER_ID
  const parsed = z.string().min(1).safeParse(parseJsonText(stored))
  return parsed.success ? parsed.data : LOCAL_OPENCODE_SERVER_ID
}

interface SidebarServerStore {
  serverId: string
  selectServer: (serverId: string) => void
}

export const useSidebarServerStore = create<SidebarServerStore>((set) => ({
  serverId: readStoredServerId(),
  selectServer: (serverId) => {
    writeStoredValue(SIDEBAR_SERVER_STORAGE_KEY, serverId)
    set({ serverId })
  },
}))
