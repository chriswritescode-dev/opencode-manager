import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { getRepo } from '@/api/repos'
import { buildToolItems, toolKeyOf } from '@/components/navigation/moreDrawerItems'
import { useShortcutActions } from '@/contexts/KeyboardShortcutsContext'
import { dialogSearch } from '@/hooks/useDialogParam'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useMobile } from '@/hooks/useMobile'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useUrlParams } from '@/hooks/useUrlParams'
import { toggleToolDialogParams, toggleToolPanelParams, type PanelTool } from '@/hooks/useToolPanel'
import { getAssistantPath, getRepoPath, getSessionPath, isAssistantPath, parseRepoRoute } from '@/lib/navigation'

/**
 * Registers the app-wide shortcut actions: the settings dialog, the route tool panels, and repo-scoped session
 * creation. Page layers can override any of these by registering the same action name.
 */
export function useGlobalShortcutActions(): void {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const { open: openSettings } = useSettingsDialog()
  const isMobile = useMobile()

  const repoId = isAssistantPath(pathname) ? ASSISTANT_REPO_ID : parseRepoRoute(pathname).repoId

  const { data: repo } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId as number),
    enabled: repoId !== null,
  })

  const createSession = useCreateSession(repo?.fullPath, (session) => {
    if (repoId === null) return
    navigate(getSessionPath(repoId, session.id))
  })

  const toolItems = useMemo(() => buildToolItems(pathname), [pathname])
  const hasFilesTool = toolItems.some((item) => toolKeyOf(item) === 'files')

  const toggleRouteTool = useCallback((tool: PanelTool) => {
    if (toolItems.some((item) => toolKeyOf(item) === tool)) {
      updateParams((params) => {
        if (isMobile) toggleToolDialogParams(params, tool)
        else toggleToolPanelParams(params, tool)
      }, 'push')
      return
    }
    if (tool === 'files') return
    const host = repoId !== null ? getRepoPath(repoId) : getAssistantPath()
    navigate(`${host}${dialogSearch(tool)}`)
  }, [toolItems, isMobile, updateParams, navigate, repoId])

  const newSession = repoId !== null && repo?.fullPath && !createSession.isPending
    ? () => createSession.mutate({})
    : undefined

  useShortcutActions({
    settings: openSettings,
    toggleTerminal: () => toggleRouteTool('terminal'),
    toggleSourceControl: () => toggleRouteTool('sourceControl'),
    toggleSidebar: hasFilesTool ? () => toggleRouteTool('files') : undefined,
    newSession,
  }, 'global')
}
