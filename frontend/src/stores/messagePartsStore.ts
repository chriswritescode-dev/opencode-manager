import { create } from 'zustand'
import type { Part } from '@/api/types'

const EMPTY_PARTS: Part[] = []

interface MessagePartsStore {
  parts: Map<string, Part[]>
  version: number
  setPart: (messageID: string, part: Part) => void
  setParts: (messageID: string, parts: Part[]) => void
  removePart: (messageID: string, partID: string) => void
  clearMessage: (messageID: string) => void
  clearSession: (sessionID: string) => void
  initFromMessages: (messages: Array<{ info: { id: string }, parts: Part[] }>) => void
}

export const useMessageParts = create<MessagePartsStore>((set) => ({
  parts: new Map(),
  version: 0,

  setPart: (messageID, part) => {
    set((state) => {
      const newMap = new Map(state.parts)
      const existing = newMap.get(messageID)
      if (!existing) {
        newMap.set(messageID, [part])
        return { parts: newMap, version: state.version + 1 }
      }
      const idx = existing.findIndex(p => p.id === part.id)
      if (idx >= 0) {
        const updated = [...existing]
        updated[idx] = part
        newMap.set(messageID, updated)
      } else {
        newMap.set(messageID, [...existing, part])
      }
      return { parts: newMap, version: state.version + 1 }
    })
  },

  setParts: (messageID, parts) => {
    set((state) => {
      const newMap = new Map(state.parts)
      newMap.set(messageID, parts)
      return { parts: newMap, version: state.version + 1 }
    })
  },

  removePart: (messageID, partID) => {
    set((state) => {
      const existing = state.parts.get(messageID)
      if (!existing) return state
      const newMap = new Map(state.parts)
      newMap.set(messageID, existing.filter(p => p.id !== partID))
      return { parts: newMap, version: state.version + 1 }
    })
  },

  clearMessage: (messageID) => {
    set((state) => {
      const newMap = new Map(state.parts)
      newMap.delete(messageID)
      return { parts: newMap, version: state.version + 1 }
    })
  },

  clearSession: (sessionID) => {
    set((state) => {
      const newMap = new Map(state.parts)
      for (const [, parts] of newMap) {
        if (parts.some(p => p.sessionID === sessionID)) {
          newMap.delete(sessionID)
        }
      }
      return { parts: newMap, version: state.version + 1 }
    })
  },

  initFromMessages: (messages) => {
    set((state) => {
      const newMap = new Map(state.parts)
      for (const msg of messages) {
        newMap.set(msg.info.id, msg.parts)
      }
      return { parts: newMap, version: state.version + 1 }
    })
  },
}))

export const usePartsForMessage = (messageID: string | undefined): Part[] => {
  return useMessageParts((state) => {
    if (!messageID) return EMPTY_PARTS
    return state.parts.get(messageID) ?? EMPTY_PARTS
  })
}

export const usePartsVersion = (): number => {
  return useMessageParts((state) => state.version)
}
