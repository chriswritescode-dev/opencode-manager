import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { useSwipeNavigation, type SwipeNavigationValue } from '@/contexts/swipe-navigation-context'

export interface LocationCatcherProps {
  capturedSearch: { current: string }
  capturedPathname?: { current: string }
  capturedNavigationType?: { current: string }
}

export function LocationCatcher({
  capturedSearch,
  capturedPathname,
  capturedNavigationType,
}: LocationCatcherProps) {
  const location = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    capturedSearch.current = location.search
    if (capturedPathname) capturedPathname.current = location.pathname
    if (capturedNavigationType) capturedNavigationType.current = navigationType
  })
  return null
}

export interface SwipeNavigationCatcherProps {
  captured: { current: SwipeNavigationValue | null }
}

export function SwipeNavigationCatcher({ captured }: SwipeNavigationCatcherProps) {
  captured.current = useSwipeNavigation()
  return null
}
