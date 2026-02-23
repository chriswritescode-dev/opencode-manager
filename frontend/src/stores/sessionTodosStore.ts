import { create } from 'zustand'
import type { components } from '@/api/opencode-types'

type Todo = components['schemas']['Todo']

interface SessionTodosStore {
  todos: Map<string, Todo[]>
  setTodos: (sessionID: string, todos: Todo[]) => void
  getTodos: (sessionID: string) => Todo[]
  clearSession: (sessionID: string) => void
  hasSessionTodos: (sessionID: string) => boolean
}

export const useSessionTodos = create<SessionTodosStore>((set, get) => ({
  todos: new Map(),

  setTodos: (sessionID: string, todos: Todo[]) => {
    set((state) => {
      const newMap = new Map(state.todos)
      newMap.set(sessionID, todos)
      return { todos: newMap }
    })
  },

  getTodos: (sessionID: string) => {
    return get().todos.get(sessionID) || []
  },

  clearSession: (sessionID: string) => {
    set((state) => {
      const newMap = new Map(state.todos)
      newMap.delete(sessionID)
      return { todos: newMap }
    })
  },

  hasSessionTodos: (sessionID: string) => {
    const sessionTodos = get().todos.get(sessionID)
    return !!sessionTodos && sessionTodos.length > 0
  },
}))

export const useSessionTodosForSession = (sessionID: string | undefined): Todo[] => {
  const todos = useSessionTodos((state) => 
    sessionID ? state.todos.get(sessionID) : undefined
  )
  return todos || []
}