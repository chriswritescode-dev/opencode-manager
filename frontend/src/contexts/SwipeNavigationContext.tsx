/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useRef, useMemo, type ReactNode } from 'react'

interface SwipeNavigationValue {
  suspend: () => void
  resume: () => void
  isSuspended: () => boolean
  /** Overrides the URL-derived swipe-back destination for the current page; pass null to clear it. */
  setBackTarget: (path: string | null) => void
  /** Returns the page-registered swipe-back destination, or null when the URL should decide. */
  backTarget: () => string | null
}

export const SwipeNavigationContext = createContext<SwipeNavigationValue | null>(null)

function SwipeNavigationProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const backTargetRef = useRef<string | null>(null)
  const value = useMemo<SwipeNavigationValue>(
    () => ({
      suspend: () => {
        countRef.current += 1
      },
      resume: () => {
        countRef.current = Math.max(0, countRef.current - 1)
      },
      isSuspended: () => countRef.current > 0,
      setBackTarget: (path) => {
        backTargetRef.current = path
      },
      backTarget: () => backTargetRef.current,
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
