import { create } from 'zustand'

interface SessionSwitcherStore {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useSessionSwitcherStore = create<SessionSwitcherStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}))
