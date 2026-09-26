import { create } from 'zustand'
import type { CommandInfo } from '@opencode-manager/shared/opencode'

interface UIStateStore {
  isEditingMessage: boolean
  activePromptFileBasePath: string | null
  pendingPromptCommand: { id: number; command: CommandInfo } | null
  pendingPromptFile: { id: number; path: string } | null
  setIsEditingMessage: (isEditing: boolean) => void
  setActivePromptFileBasePath: (basePath: string | null) => void
  selectPromptCommand: (command: CommandInfo) => void
  clearPendingPromptCommand: () => void
  selectPromptFile: (path: string) => void
  clearPendingPromptFile: () => void
}

export const useUIState = create<UIStateStore>((set) => ({
  isEditingMessage: false,
  activePromptFileBasePath: null,
  pendingPromptCommand: null,
  pendingPromptFile: null,
  setIsEditingMessage: (isEditing: boolean) => set({ isEditingMessage: isEditing }),
  setActivePromptFileBasePath: (basePath: string | null) => set({ activePromptFileBasePath: basePath }),
  selectPromptCommand: (command: CommandInfo) => set({ pendingPromptCommand: { id: Date.now(), command } }),
  clearPendingPromptCommand: () => set({ pendingPromptCommand: null }),
  selectPromptFile: (path: string) => set({ pendingPromptFile: { id: Date.now(), path } }),
  clearPendingPromptFile: () => set({ pendingPromptFile: null }),
}))
