import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { repoQueryOptions } from '@/lib/repoQuery'
import { buildToolItems, toolKeyOf } from '@/components/navigation/moreDrawerItems'
import { useShortcutActions } from '@/contexts/KeyboardShortcutsContext'
import { dialogSearch } from '@/hooks/useDialogParam'
import { sessionQueryOptions, useCreateSession } from '@/hooks/useOpenCode'
import { useMobile } from '@/hooks/useMobile'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useUrlParams } from '@/hooks/useUrlParams'
import {
  clearToolPanelParams,
  panelToolParam,
  resolveToolPanelToggle,
  toggleToolDialogParams,
  toggleToolPanelParams,
  type PanelTool,
} from '@/hooks/useToolPanel'
import { isLocalOpenCodeServer, useRouteOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import {
  getAssistantPath,
  getRepoPath,
  getServerSessionPath,
  getSessionPath,
  isAssistantPath,
  parseRepoRoute,
  parseServerSessionRoute,
} from '@/lib/navigation'

/**
 * Registers the app-wide shortcut actions: the settings dialog, the route tool panels, and session creation on the
 * route's OpenCode server. Page layers can override any of these by registering the same action name.
 */
export function useGlobalShortcutActions(): void {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { searchParams, updateParams, closePushedParams } = useUrlParams()
  const { open: openSettings } = useSettingsDialog()
  const isMobile = useMobile()
  const serverId = useRouteOpenCodeServerId()
  const isRemoteRoute = !isLocalOpenCodeServer(serverId)

  const repoId = isAssistantPath(pathname) ? ASSISTANT_REPO_ID : parseRepoRoute(pathname).repoId

  const { data: repo } = useQuery({
    ...repoQueryOptions(repoId as number),
    enabled: repoId !== null,
  })

  const remoteSessionRoute = isRemoteRoute ? parseServerSessionRoute(pathname) : null
  const { data: remoteSession } = useQuery(
    sessionQueryOptions(remoteSessionRoute?.sessionId, undefined, serverId),
  )
  const sessionDirectory = isRemoteRoute ? remoteSession?.location?.directory : repo?.fullPath

  const createSession = useCreateSession(sessionDirectory, (session) => {
    if (isRemoteRoute) {
      navigate(getServerSessionPath(serverId, session.id))
      return
    }
    if (repoId === null) return
    navigate(getSessionPath(repoId, session.id))
  }, serverId)

  const toolItems = useMemo(() => buildToolItems(pathname), [pathname])
  const [, toggleSidebarCollapsed] = useSidebarCollapsed()

  const toggleRouteTool = useCallback((tool: PanelTool) => {
    if (toolItems.some((item) => toolKeyOf(item) === tool)) {
      if (isMobile) {
        updateParams((params) => toggleToolDialogParams(params, tool), 'push')
        return
      }
      const action = resolveToolPanelToggle(panelToolParam(searchParams), tool)
      if (action === 'close') {
        closePushedParams(clearToolPanelParams)
        return
      }
      updateParams((params) => toggleToolPanelParams(params, tool), action === 'switch' ? 'replace' : 'push')
      return
    }
    if (isRemoteRoute || tool === 'files') return
    const host = repoId !== null ? getRepoPath(repoId) : getAssistantPath()
    navigate(`${host}${dialogSearch(tool)}`)
  }, [toolItems, isMobile, searchParams, updateParams, closePushedParams, navigate, repoId, isRemoteRoute])

  const newSession = sessionDirectory && !createSession.isPending
    ? () => createSession.mutate({})
    : undefined

  useShortcutActions({
    settings: openSettings,
    toggleTerminal: () => toggleRouteTool('terminal'),
    toggleSourceControl: () => toggleRouteTool('sourceControl'),
    toggleSidebar: isMobile ? undefined : toggleSidebarCollapsed,
    newSession,
  }, 'global')
}
