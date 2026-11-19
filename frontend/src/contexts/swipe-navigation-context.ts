import { createContext, useContext } from 'react'

export interface SwipeNavigationValue {
  suspend: () => void
  resume: () => void
  isSuspended: () => boolean
  setBackTarget: (path: string | null) => void
  backTarget: () => string | null
}

export const SwipeNavigationContext = createContext<SwipeNavigationValue | null>(null)

export function useSwipeNavigation(): SwipeNavigationValue | null {
  return useContext(SwipeNavigationContext)
}
