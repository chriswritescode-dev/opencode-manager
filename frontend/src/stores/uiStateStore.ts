import { create } from 'zustand'

interface UIStateStore {
  isEditingMessage: boolean
  setIsEditingMessage: (isEditing: boolean) => void
  /**
   * True while a page renders the desktop tool rail, so callers outside the rail know whether
   * `?panel=` has a host.
   */
  isToolRailMounted: boolean
  setToolRailMounted: (mounted: boolean) => void
}

export const useUIState = create<UIStateStore>((set) => ({
  isEditingMessage: false,
  setIsEditingMessage: (isEditing: boolean) => set({ isEditingMessage: isEditing }),
  isToolRailMounted: false,
  setToolRailMounted: (mounted: boolean) => set({ isToolRailMounted: mounted }),
}))
