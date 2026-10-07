import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_RECENT_COMMANDS = 5

interface RecentCommandsStore {
  names: string[]
  recordCommand: (name: string) => void
}

export const useRecentCommandsStore = create<RecentCommandsStore>()(
  persist(
    (set) => ({
      names: [],
      recordCommand: (name: string) =>
        set((state) => ({
          names: [name, ...state.names.filter((existing) => existing !== name)].slice(0, MAX_RECENT_COMMANDS),
        })),
    }),
    {
      name: 'opencode-recent-commands',
      partialize: (state) => ({ names: state.names }),
    }
  )
)
