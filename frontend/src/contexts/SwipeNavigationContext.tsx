import { useRef, useMemo, type ReactNode } from 'react'
import { SwipeNavigationContext, type SwipeNavigationValue } from './swipe-navigation-context'

export function SwipeNavigationProvider({ children }: { children: ReactNode }) {
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
