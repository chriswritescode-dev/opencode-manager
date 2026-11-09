import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildNavModel, type NavItem } from '@/components/navigation/navItems'
import { getPathWithReturnTo } from '@/lib/navigation'
import {
  encodeProjectTarget,
  isSameProjectTarget,
  projectTargetFromRoute,
  type ProjectTarget,
} from '@/lib/projectTarget'
import { openDialogParams } from './useDialogParam'
import { useUrlParams } from './useUrlParams'

/**
 * Opens a navigation item's route, or its dialog scoped to the project the item belongs to.
 *
 * Route items navigate and drop the menu params. Dialog items close the menu and open the dialog in
 * one URL update: when the item's project is the route's project and the route's own nav model hosts
 * the dialog, the route host opens it and a push lets Back close it again. Otherwise the dialog is
 * tagged with `toolProject` and the current entry is replaced so Back returns to the entry before the
 * menu, while `ProjectToolsHost` renders the tool.
 *
 * @returns A handler that returns false for items with neither a route nor a dialog.
 */
export function useOpenProjectTool(): (item: NavItem, target: ProjectTarget | null) => boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()

  return useCallback((item: NavItem, target: ProjectTarget | null) => {
    if (item.to) {
      navigate(item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to)
      return true
    }

    const dialog = item.dialog
    if (!dialog) return false

    const sameProject = isSameProjectTarget(target, projectTargetFromRoute(location.pathname, location.search))
    const routeHostsDialog = buildNavModel(location.pathname).items.some((navItem) => navItem.dialog === dialog)
    const useRouteHost = sameProject && routeHostsDialog

    updateParams((params) => {
      openDialogParams(params, dialog)
      params.delete('menu')
      params.delete('menuProject')
      if (useRouteHost) {
        params.delete('toolProject')
      } else if (target !== null) {
        params.set('toolProject', encodeProjectTarget(target))
      }
    }, useRouteHost ? 'push' : 'replace')

    return true
  }, [location.pathname, location.search, navigate, updateParams])
}
