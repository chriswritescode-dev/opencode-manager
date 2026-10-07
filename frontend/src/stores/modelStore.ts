import { create } from 'zustand'
import { isSameModelRef, isSameModelSelection, normalizeModelVariant } from '@opencode-manager/shared/opencode'
import type { ModelRef } from '@opencode-manager/shared/opencode'
import type { ModelSelection } from '@/api/providers'

export type { ModelSelection }

export type ModelPick = ModelSelection & { variant?: string }

export interface ActiveAgent {
  id: string
  model?: ModelRef
}

interface ModelStore {
  newSessionPicks: Record<string, ModelPick>
  sessionPicks: Record<string, Record<string, ModelPick>>
  activeAgent: ActiveAgent | null
  setNewSessionPick: (key: string, selection: ModelPick) => void
  setSessionPick: (sessionID: string, agentID: string, selection: ModelPick | undefined) => void
  setActiveAgent: (agent: ActiveAgent) => void
}

export function locationAgentKey(directory: string | undefined, agentID: string | undefined): string {
  return JSON.stringify([directory ?? '', agentID ?? ''])
}

function isSamePick(left: ModelPick | undefined, right: ModelPick | undefined): boolean {
  if (!left || !right) return left === right
  return (
    isSameModelSelection(left, right) &&
    normalizeModelVariant(left.variant) === normalizeModelVariant(right.variant)
  )
}

if (typeof localStorage !== 'undefined') localStorage.removeItem('opencode-model-selection')

export const useModelStore = create<ModelStore>()((set, get) => ({
  newSessionPicks: {},
  sessionPicks: {},
  activeAgent: null,

  setNewSessionPick: (key, selection) => {
    if (isSamePick(get().newSessionPicks[key], selection)) return
    set((state) => ({ newSessionPicks: { ...state.newSessionPicks, [key]: selection } }))
  },

  setSessionPick: (sessionID, agentID, selection) => {
    const current = get().sessionPicks[sessionID]?.[agentID]
    if (selection === undefined) {
      if (current === undefined) return
      set((state) => {
        const next = { ...state.sessionPicks[sessionID] }
        delete next[agentID]
        return { sessionPicks: { ...state.sessionPicks, [sessionID]: next } }
      })
      return
    }
    if (isSamePick(current, selection)) return
    set((state) => ({
      sessionPicks: {
        ...state.sessionPicks,
        [sessionID]: { ...state.sessionPicks[sessionID], [agentID]: selection },
      },
    }))
  },

  setActiveAgent: (agent) => {
    const current = get().activeAgent
    if (current && current.id === agent.id && isSameModelRef(current.model, agent.model)) return
    set({ activeAgent: agent })
  },
}))
