import { create } from 'zustand'
import type { components } from '@/api/opencode-types'

type CommandType = components['schemas']['Command']

interface UIStateStore {
  isEditingMessage: boolean
  pendingPromptCommand: { id: number; command: CommandType } | null
  pendingPromptFile: { id: number; path: string } | null
  activePromptFileBasePath: string | null
  setIsEditingMessage: (isEditing: boolean) => void
  selectPromptCommand: (command: CommandType) => void
  clearPendingPromptCommand: () => void
  selectPromptFile: (path: string) => void
  clearPendingPromptFile: () => void
  setActivePromptFileBasePath: (basePath: string | null) => void
}

export const useUIState = create<UIStateStore>((set) => ({
  isEditingMessage: false,
  pendingPromptCommand: null,
  pendingPromptFile: null,
  activePromptFileBasePath: null,
  setIsEditingMessage: (isEditing: boolean) => set({ isEditingMessage: isEditing }),
  selectPromptCommand: (command: CommandType) => set({ pendingPromptCommand: { id: Date.now(), command } }),
  clearPendingPromptCommand: () => set({ pendingPromptCommand: null }),
  selectPromptFile: (path: string) => set({ pendingPromptFile: { id: Date.now(), path } }),
  clearPendingPromptFile: () => set({ pendingPromptFile: null }),
  setActivePromptFileBasePath: (basePath: string | null) => set({ activePromptFileBasePath: basePath }),
}))
