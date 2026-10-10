import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { FileBrowser } from '@/components/file-browser/FileBrowser'
import { SourceControlContent } from '@/components/source-control'
import { TerminalWorkspace } from '@/components/terminal/TerminalPanel'
import {
  ChangesWalkthroughNav,
  ChangesWalkthroughProvider,
  ChangesWalkthroughRegenerate,
  ChangesWalkthroughSourcePicker,
  ChangesWalkthroughStop,
  ChangesWalkthroughView,
  type WalkthroughSourceRequest,
} from '@/components/session/ChangesWalkthroughSheet'
import { PreviewWorkspace } from '@/components/preview/PreviewPanel'
import { RepoMcpContent } from '@/components/repo/RepoMcpDialog'
import { RepoActionsContent } from '@/components/repo/RepoActionsDialog'
import { RepoSkillsContent } from '@/components/repo/RepoSkillsDialog'
import { RepoSchedulesContent } from '@/components/schedules/RepoSchedulesContent'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { buildToolItems, toolKeyOf, type MoreDrawerItem } from '@/components/navigation/moreDrawerItems'
import { isPanelTool, type ToolPanelState, type PanelTool } from '@/hooks/useToolPanel'
import { useOpenNavItem } from '@/hooks/useOpenNavItem'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { restoreOverlayFocus } from '@/lib/overlayFocus'
import { cn } from '@/lib/utils'

interface ToolSidePanelProps {
  panel: ToolPanelState
  filesBasePath: string | undefined
  allowNavigateAboveBase?: boolean
  repoId?: number
  sessionId?: string
  directory?: string
  terminalDirectory?: string
  repoDirectory?: string
  currentBranch?: string
  selectedFilePath?: string
  onSkillLoaded?: (skill: SkillFileInfo) => void
  walkthroughSourceRequest?: WalkthroughSourceRequest
}

interface RailButtonProps {
  item: MoreDrawerItem
  active: boolean
  onClick: () => void
}

function RailButton({ item, active, onClick }: RailButtonProps) {
  const Icon = item.icon
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={item.label}
          aria-pressed={active}
          className={cn(
            'rounded-md p-2 transition-colors',
            active
              ? 'bg-accent text-foreground'
              : item.danger
                ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" align="center">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Desktop-only docked tool panel with its icon rail, rendered to the right of a page's content.
 * The rail lists the current route's tool items; repo- and session-scoped tools render only when their context is given.
 */
export function ToolSidePanel({
  panel,
  filesBasePath,
  allowNavigateAboveBase,
  repoId,
  sessionId,
  directory,
  terminalDirectory,
  repoDirectory,
  currentBranch = 'main',
  selectedFilePath,
  onSkillLoaded,
  walkthroughSourceRequest,
}: ToolSidePanelProps) {
  const { activeTool, toggleTool, closePanel } = panel
  const location = useLocation()
  const openNavItem = useOpenNavItem()
  const railRef = useRef<HTMLElement>(null)
  const previousActiveToolRef = useRef(activeTool)

  useEffect(() => {
    const previousTool = previousActiveToolRef.current
    previousActiveToolRef.current = activeTool
    if (previousTool === null || activeTool !== null) return
    const active = document.activeElement
    if (active === null || active === document.body || railRef.current?.contains(active)) {
      restoreOverlayFocus(null)
    }
  }, [activeTool])

  const panelTools: Array<{ item: MoreDrawerItem; tool: PanelTool }> = []
  const actionItems: MoreDrawerItem[] = []
  for (const item of buildToolItems(location.pathname)) {
    const tool = toolKeyOf(item)
    if (isPanelTool(tool)) panelTools.push({ item, tool })
    else actionItems.push(item)
  }
  const activeLabel = panelTools.find(({ tool }) => tool === activeTool)?.item.label

  if (panelTools.length === 0 && actionItems.length === 0) return null

  const renderTool = (tool: PanelTool) => {
    if (tool === 'files') {
      return (
        <FileBrowser
          embedded
          compact
          basePath={filesBasePath || '.'}
          allowNavigateAboveBase={allowNavigateAboveBase}
          initialSelectedFile={selectedFilePath}
        />
      )
    }
    if (tool === 'preview') return <PreviewWorkspace isOpen directory={directory} compact />
    if (tool === 'mcp') return repoDirectory ? <RepoMcpContent open directory={repoDirectory} /> : null
    if (tool === 'walkthrough') return sessionId ? <ChangesWalkthroughView /> : null
    if (repoId === undefined) return null
    switch (tool) {
      case 'sourceControl':
        return <SourceControlContent repoId={repoId} isOpen currentBranch={currentBranch} compact />
      case 'terminal':
        return <TerminalWorkspace repoId={repoId} directory={terminalDirectory ?? directory} isOpen />
      case 'actions':
        return <RepoActionsContent repoId={repoId} directory={directory} open />
      case 'skills':
        return sessionId ? (
          <RepoSkillsContent
            open
            repoId={repoId}
            sessionId={sessionId}
            directory={repoDirectory}
            onSkillLoaded={onSkillLoaded}
            onDone={closePanel}
          />
        ) : (
          <RepoSkillsContent open repoId={repoId} onDone={closePanel} />
        )
      case 'schedules':
        return <RepoSchedulesContent repoId={repoId} embedded />
    }
  }

  const panelContent =
    activeTool && activeLabel ? (
      <aside
        aria-label={activeLabel}
        className="flex w-[min(600px,45vw)] shrink-0 flex-col border-l border-border bg-background"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{activeLabel}</h2>
          {activeTool === 'walkthrough' ? (
            <>
              <ChangesWalkthroughSourcePicker />
              <ChangesWalkthroughStop />
              <ChangesWalkthroughRegenerate />
              <ChangesWalkthroughNav />
            </>
          ) : null}
          <button
            type="button"
            onClick={closePanel}
            aria-label="Close panel"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{renderTool(activeTool)}</div>
      </aside>
    ) : null

  return (
    <>
      {panelContent ? (
        activeTool === 'walkthrough' && sessionId ? (
          <ChangesWalkthroughProvider
            key={sessionId}
            sessionId={sessionId}
            active
            sourceRequest={walkthroughSourceRequest}
          >
            {panelContent}
          </ChangesWalkthroughProvider>
        ) : (
          panelContent
        )
      ) : null}

      <TooltipProvider>
        <nav ref={railRef} aria-label="Tools" className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l border-border bg-background py-2">
          {panelTools.map(({ item, tool }) => (
            <RailButton key={item.key} item={item} active={tool === activeTool} onClick={() => toggleTool(tool)} />
          ))}
          {actionItems.length > 0 ? <div className="my-1 h-px w-6 shrink-0 bg-border" role="separator" /> : null}
          {actionItems.map((item) => (
            <RailButton key={item.key} item={item} active={false} onClick={() => openNavItem(item)} />
          ))}
        </nav>
      </TooltipProvider>
    </>
  )
}
