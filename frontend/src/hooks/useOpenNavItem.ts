import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { MoreDrawerItem } from '@/components/navigation/moreDrawerItems'
import { getPathWithReturnTo } from '@/lib/navigation'
import { openDialogParam } from './useDialogParam'
import { useUrlParams } from './useUrlParams'

/** Opens a navigation item's route or dialog; returns false for items it does not handle. */
export function useOpenNavItem(): (item: MoreDrawerItem) => boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()

  return useCallback((item: MoreDrawerItem) => {
    if (item.to) {
      navigate(item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to)
      return true
    }
    if (item.dialog) {
      openDialogParam(updateParams, item.dialog)
      return true
    }
    return false
  }, [location.pathname, location.search, navigate, updateParams])
}
