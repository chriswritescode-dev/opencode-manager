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
import { clearSideMenuParams } from './useSideMenu'
import { useUrlParams } from './useUrlParams'

/**
 * Opens a tool dialog scoped to a project.
 *
 * The menu params are dropped in the same replace update, so closing the dialog returns to the route
 * without the menu. When the project is the route's project and the route's own nav model hosts the
 * dialog, the route host opens it and no `toolProject` is set. Otherwise the dialog is tagged with
 * `toolProject` and `ProjectToolsHost` renders it.
 *
 * @returns A handler that takes the dialog name, its project, and any extra dialog params.
 */
export function useOpenProjectDialog(): (
  dialog: string,
  target: ProjectTarget | null,
  extraParams?: Record<string, string>,
) => void {
  const location = useLocation()
  const { updateParams } = useUrlParams()

  return useCallback((dialog, target, extraParams) => {
    const sameProject = isSameProjectTarget(target, projectTargetFromRoute(location.pathname, location.search))
    const routeHostsDialog = buildNavModel(location.pathname).items.some((item) => item.dialog === dialog)

    updateParams((params) => {
      openDialogParams(params, dialog, extraParams)
      clearSideMenuParams(params)
      if (sameProject && routeHostsDialog) {
        params.delete('toolProject')
      } else if (target !== null) {
        params.set('toolProject', encodeProjectTarget(target))
      }
    }, 'replace')
  }, [location.pathname, location.search, updateParams])
}

/**
 * Opens a navigation item's route, or its dialog scoped to the project the item belongs to.
 *
 * Route items navigate and drop the menu params. Dialog items close the menu and open the dialog in
 * one replace update through {@link useOpenProjectDialog}, so closing the dialog never reopens the
 * menu.
 *
 * @returns A handler that returns false for items with neither a route nor a dialog.
 */
export function useOpenProjectTool(): (item: NavItem, target: ProjectTarget | null) => boolean {
  const location = useLocation()
  const navigate = useNavigate()
  const openProjectDialog = useOpenProjectDialog()

  return useCallback((item, target) => {
    if (item.to) {
      navigate(item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to)
      return true
    }

    const dialog = item.dialog
    if (!dialog) return false

    openProjectDialog(dialog, target)
    return true
  }, [location.pathname, location.search, navigate, openProjectDialog])
}
