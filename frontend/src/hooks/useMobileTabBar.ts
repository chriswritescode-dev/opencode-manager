import { useCallback, useMemo } from 'react'
import { useUrlParams } from './useUrlParams'

type MobileSheetKey = 'sessions' | 'files' | 'notifications' | 'more'

interface UseMobileTabBarReturn {
  openSheet: MobileSheetKey | null
  open: (key: MobileSheetKey) => void
  close: () => void
}

export function useMobileTabBar(): UseMobileTabBarReturn {
  const { searchParams, updateParams, closePushedParams } = useUrlParams()

  const openSheet = useMemo<MobileSheetKey | null>(() => {
    const v = searchParams.get('mobileTab')
    return (v === 'sessions' || v === 'files' || v === 'notifications' || v === 'more') ? v : null
  }, [searchParams])

  const open = useCallback((key: MobileSheetKey) => {
    updateParams((p) => p.set('mobileTab', key), 'push')
  }, [updateParams])

  const close = useCallback(() => {
    closePushedParams((p) => p.delete('mobileTab'))
  }, [closePushedParams])

  return { openSheet, open, close }
}
