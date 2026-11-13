import { create } from 'zustand'

interface UIStateStore {
  isEditingMessage: boolean
  setIsEditingMessage: (isEditing: boolean) => void
  isToolRailMounted: boolean
  setToolRailMounted: (mounted: boolean) => void
}

export const useUIState = create<UIStateStore>((set) => ({
  isEditingMessage: false,
  setIsEditingMessage: (isEditing: boolean) => set({ isEditingMessage: isEditing }),
  isToolRailMounted: false,
  setToolRailMounted: (mounted: boolean) => set({ isToolRailMounted: mounted }),
}))
