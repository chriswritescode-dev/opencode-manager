import { create } from 'zustand'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

interface UIStateStore {
  isEditingMessage: boolean
  pendingPromptCommand: { id: number; command: CommandType } | null
  pendingPromptFile: { id: number; path: string } | null
  activePromptDirectory: string | null
  setIsEditingMessage: (isEditing: boolean) => void
  selectPromptCommand: (command: CommandType) => void
  clearPendingPromptCommand: () => void
  selectPromptFile: (path: string) => void
  clearPendingPromptFile: () => void
  setActivePromptDirectory: (directory: string | null) => void
}

export const useUIState = create<UIStateStore>((set) => ({
  isEditingMessage: false,
  pendingPromptCommand: null,
  pendingPromptFile: null,
  activePromptDirectory: null,
  setIsEditingMessage: (isEditing: boolean) => set({ isEditingMessage: isEditing }),
  selectPromptCommand: (command: CommandType) => set({ pendingPromptCommand: { id: Date.now(), command } }),
  clearPendingPromptCommand: () => set({ pendingPromptCommand: null }),
  selectPromptFile: (path: string) => set({ pendingPromptFile: { id: Date.now(), path } }),
  clearPendingPromptFile: () => set({ pendingPromptFile: null }),
  setActivePromptDirectory: (directory: string | null) => set({ activePromptDirectory: directory }),
}))
