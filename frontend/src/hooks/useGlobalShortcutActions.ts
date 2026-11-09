import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { repoQueryOptions } from '@/lib/repoQuery'
import { buildToolItems, toolKeyOf } from '@/components/navigation/navItems'
import { useShortcutActions } from '@/contexts/KeyboardShortcutsContext'
import { sessionQueryOptions, useCreateSession } from '@/hooks/useOpenCode'
import { useMobile } from '@/hooks/useMobile'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSideMenu } from '@/hooks/useSideMenu'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useUrlParams } from '@/hooks/useUrlParams'
import {
  toggleToolDialogParams,
  useToolPanelToggle,
  type PanelTool,
} from '@/hooks/useToolPanel'
import { isLocalOpenCodeServer, useRouteOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import {
  getServerSessionPath,
  getSessionPath,
  isAssistantPath,
  parseRepoRoute,
  parseServerSessionRoute,
} from '@/lib/navigation'
import { encodeProjectTarget } from '@/lib/projectTarget'

/**
 * Registers the app-wide shortcut actions: the settings dialog, the route tool panels, and session creation on the
 * route's OpenCode server. Page layers can override any of these by registering the same action name.
 */
export function useGlobalShortcutActions(): void {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const { open: openSettings } = useSettingsDialog()
  const { project: menuProject } = useSideMenu()
  const isMobile = useMobile()
  const routeServerId = useRouteOpenCodeServerId()
  const routeIsRemote = !isLocalOpenCodeServer(routeServerId)

  const routeRepoId = isAssistantPath(pathname) ? ASSISTANT_REPO_ID : parseRepoRoute(pathname).repoId
  const menuRepoId = menuProject?.kind === 'repo' ? menuProject.repoId : null
  const repoId = routeRepoId ?? menuRepoId

  const menuServerProject = !routeIsRemote && routeRepoId === null && menuProject?.kind === 'server' ? menuProject : null
  const serverId = menuServerProject?.serverId ?? routeServerId
  const isRemoteRoute = !isLocalOpenCodeServer(serverId)

  const { data: repo } = useQuery({
    ...repoQueryOptions(repoId as number),
    enabled: repoId !== null,
  })

  const remoteSessionRoute = isRemoteRoute ? parseServerSessionRoute(pathname) : null
  const { data: remoteSession } = useQuery(
    sessionQueryOptions(remoteSessionRoute?.sessionId, undefined, serverId),
  )
  const sessionDirectory = isRemoteRoute
    ? remoteSession?.location?.directory ?? menuServerProject?.directory
    : repo?.fullPath

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
  const togglePanelTool = useToolPanelToggle()

  const toggleRouteTool = useCallback((tool: PanelTool) => {
    if (toolItems.some((item) => toolKeyOf(item) === tool)) {
      if (isMobile) {
        updateParams((params) => toggleToolDialogParams(params, tool), 'push')
        return
      }
      togglePanelTool(tool)
      return
    }
    if (isRemoteRoute || tool === 'files') return
    const projectTarget = repoId !== null && repoId !== ASSISTANT_REPO_ID
      ? { kind: 'repo' as const, repoId }
      : { kind: 'repo' as const, repoId: ASSISTANT_REPO_ID }
    const params = new URLSearchParams({ dialog: tool, toolProject: encodeProjectTarget(projectTarget) })
    navigate(`/?${params.toString()}`)
  }, [toolItems, isMobile, togglePanelTool, updateParams, navigate, repoId, isRemoteRoute])

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
