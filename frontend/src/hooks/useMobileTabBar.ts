import { useCallback } from 'react'
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

  const searchParams = new URLSearchParams(location.search)
  const mobileTabParam = searchParams.get('mobileTab')
  const openSheet = (mobileTabParam === 'repos' || mobileTabParam === 'files' || mobileTabParam === 'notifications' || mobileTabParam === 'more')
    ? mobileTabParam
    : null

  const open = useCallback((key: MobileSheetKey) => {
    const newParams = new URLSearchParams(location.search)
    newParams.set('mobileTab', key)
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate, location.search])

  const close = useCallback(() => {
    const newParams = new URLSearchParams(location.search)
    newParams.delete('mobileTab')
    navigate({ search: newParams.toString() }, { replace: true })
  }, [navigate, location.search])

  return {
    openSheet,
    open,
    close,
  }
}
