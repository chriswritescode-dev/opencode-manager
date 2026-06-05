import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export type MobileSheetKey = 'repos' | 'files' | 'notifications' | 'more'

export interface UseMobileTabBarReturn {
  openSheet: MobileSheetKey | null
  open: (key: MobileSheetKey) => void
  close: () => void
}

export function useMobileTabBar(): UseMobileTabBarReturn {
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef(location.search)

  useEffect(() => {
    searchRef.current = location.search
  }, [location.search])

  const openSheet = useMemo<MobileSheetKey | null>(() => {
    const searchParams = new URLSearchParams(location.search)
    const mobileTabParam = searchParams.get('mobileTab')
    return (mobileTabParam === 'repos' || mobileTabParam === 'files' || mobileTabParam === 'notifications' || mobileTabParam === 'more')
      ? mobileTabParam
      : null
  }, [location.search])

  const open = useCallback((key: MobileSheetKey) => {
    const newParams = new URLSearchParams(searchRef.current)
    newParams.set('mobileTab', key)
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate])

  const close = useCallback(() => {
    const newParams = new URLSearchParams(searchRef.current)
    newParams.delete('mobileTab')
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate])

  return {
    openSheet,
    open,
    close,
  }
}
