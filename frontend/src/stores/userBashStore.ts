import { create } from 'zustand'

interface UserBashStore {
  userBashCommands: Map<string, number>
  addUserBashCommand: (command: string) => void
}

export const useUserBash = create<UserBashStore>((set) => ({
  userBashCommands: new Map(),
  addUserBashCommand: (command: string) => {
    set((state) => {
      const newMap = new Map(state.userBashCommands)
      newMap.set(command, Date.now())
      return { userBashCommands: newMap }
    })
  },
}))