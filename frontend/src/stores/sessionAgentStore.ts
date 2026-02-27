import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionAgentStore {
  agents: Record<string, string>
  setAgent: (sessionID: string, agent: string) => void
  getAgent: (sessionID: string) => string | null
}

export const useSessionAgentStore = create<SessionAgentStore>()(
  persist(
    (set, get) => ({
      agents: {},
      setAgent: (sessionID: string, agent: string) =>
        set((state) => ({
          agents: { ...state.agents, [sessionID]: agent },
        })),
      getAgent: (sessionID: string) => get().agents[sessionID] ?? null,
    }),
    {
      name: 'opencode-session-agents',
      partialize: (state) => ({ agents: state.agents }),
    }
  )
)
