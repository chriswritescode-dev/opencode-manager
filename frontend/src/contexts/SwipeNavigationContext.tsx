/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useRef, useMemo, type ReactNode } from 'react'

interface SwipeNavigationValue {
  suspend: () => void
  resume: () => void
  isSuspended: () => boolean
}

export const SwipeNavigationContext = createContext<SwipeNavigationValue | null>(null)

function SwipeNavigationProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const value = useMemo<SwipeNavigationValue>(
    () => ({
      suspend: () => {
        countRef.current += 1
      },
      resume: () => {
        countRef.current = Math.max(0, countRef.current - 1)
      },
      isSuspended: () => countRef.current > 0,
    }),
    []
  )

  return (
    <SwipeNavigationContext.Provider value={value}>
      {children}
    </SwipeNavigationContext.Provider>
  )
}

export function useSwipeNavigation(): SwipeNavigationValue | null {
  return useContext(SwipeNavigationContext)
}

export { SwipeNavigationProvider }
