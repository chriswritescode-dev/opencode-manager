import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileBrowser } from '@/components/file-browser/FileBrowser'
import { SourceControlContent } from '@/components/source-control'
import { RemoteSourceControlContent } from '@/components/source-control/RemoteSourceControlContent'
import { TerminalWorkspace } from '@/components/terminal/TerminalPanel'
import {
  ChangesWalkthroughCancel,
  ChangesWalkthroughProvider,
  ChangesWalkthroughRegenerate,
  ChangesWalkthroughSourcePicker,
  ChangesWalkthroughView,
  type WalkthroughSourceRequest,
} from '@/components/session/ChangesWalkthroughSheet'
import { PreviewWorkspace } from '@/components/preview/PreviewPanel'
import { RepoMcpContent } from '@/components/repo/RepoMcpDialog'
import { RepoActionsContent } from '@/components/repo/RepoActionsDialog'
import { RepoSkillsContent } from '@/components/repo/RepoSkillsDialog'
import { RepoSecretsContent } from '@/components/secrets/RepoSecretsDialog'
import { RepoSchedulesContent } from '@/components/schedules/RepoSchedulesContent'
import type { SkillFileInfo } from '@opencode-manager/shared'
import type { ModelRef } from '@opencode-manager/shared/opencode'
import { buildToolItems, toolKeyOf, type MoreDrawerItem } from '@/components/navigation/moreDrawerItems'
import { isPanelTool, type ToolPanelState, type PanelTool } from '@/hooks/useToolPanel'
import { useOpenNavItem } from '@/hooks/useOpenNavItem'
import { ActivityList } from '@/components/activity/ActivityList'
import { ActivityCountPill } from '@/components/activity/ActivityCountPill'
import { withQueryParam } from '@/lib/navigation'
import type { TerminalTarget } from '@/lib/terminal-target'
import { useActiveWorkCounts, useActivityWindowMinutes } from '@/hooks/useActiveWork'
import { formatActivityWindow } from '@/lib/activeWork'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TOOLTIP_OPEN_DELAY_MS } from '@/components/ui/tooltip'
import { restoreOverlayFocus } from '@/lib/overlayFocus'
import { useRestoreFocusOnClose } from '@/hooks/useRestoreFocusOnClose'
import { cn } from '@/lib/utils'
import { useToolPanelLayout, useToolPanelWidth } from '@/hooks/useToolPanelLayout'
import { isLocalOpenCodeServer, useRouteOpenCodeServerId } from '@/contexts/OpenCodeServerContext'

const PANEL_WIDTH_CLASSES: Partial<Record<PanelTool, string>> = {
  activity: 'w-80',
}

interface PanelResizeState {
  pointerId: number
  startX: number
  startWidth: number
}

interface PanelResizeHandleProps {
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
}

function PanelResizeHandle({ width, minWidth, maxWidth, onWidthChange }: PanelResizeHandleProps) {
  const dragRef = useRef<PanelResizeState | null>(null)

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
    },
    [width],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      onWidthChange(drag.startWidth - (event.clientX - drag.startX))
    },
    [onWidthChange],
  )

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    dragRef.current = null
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16
      let nextWidth: number
      switch (event.key) {
        case 'ArrowLeft':
          nextWidth = width + step
          break
        case 'ArrowRight':
          nextWidth = width - step
          break
        case 'Home':
          nextWidth = minWidth
          break
        case 'End':
          nextWidth = maxWidth
          break
        default:
          return
      }
      event.preventDefault()
      onWidthChange(nextWidth)
    },
    [maxWidth, minWidth, onWidthChange, width],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none bg-transparent hover:bg-highlight/30 focus-visible:bg-highlight/30 focus-visible:outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
    />
  )
}

const REMOTE_TOOL_KEYS: ReadonlySet<string> = new Set(['activity', 'mcp', 'skills', 'source-control', 'terminal'])

/**
 * Escape closes the floating panel, except while a nested menu is open or the terminal owns
 * the key. Focus moving into the opener is handled by `useRestoreFocusOnClose`.
 */
function useFloatingPanelDismiss(
  floating: boolean,
  closePanel: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(closePanel)
  closeRef.current = closePanel

  useEffect(() => {
    if (!floating) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (target instanceof Element) {
        if (target.closest('.xterm')) return
        if (target.closest('[role="listbox"], [role="menu"]')) return
        const dialog = target.closest('[role="dialog"]')
        if (dialog !== null && dialog !== panelRef.current) return
      }
      closeRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [floating, panelRef])
}

function ActivityWindowLabel() {
  const minutes = useActivityWindowMinutes()
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      Last {formatActivityWindow(minutes)}
    </span>
  )
}

function ActivityPanelBody() {
  const navigate = useNavigate()
  const minutes = useActivityWindowMinutes()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ActivityList
        minutes={minutes}
        onNavigate={(item) => navigate(withQueryParam(item.path, 'panel', 'activity'))}
      />
    </div>
  )
}

function ActivityRailIndicator() {
  const { needsInput, running } = useActiveWorkCounts()
  const total = needsInput + running
  const label = total > 0 ? `Activity, ${needsInput} needs input, ${running} running` : 'Activity'

  return (
    <>
      <span className="sr-only">{label}</span>
      <ActivityCountPill
        needsInput={needsInput}
        running={running}
        className="absolute -right-0.5 -top-0.5"
      />
    </>
  )
}

interface ToolSidePanelProps {
  panel: ToolPanelState
  filesBasePath: string | undefined
  allowNavigateAboveBase?: boolean
  repoId?: number
  sessionId?: string
  directory?: string
  terminalDirectory?: string
  terminalTarget?: TerminalTarget
  repoDirectory?: string
  currentBranch?: string
  selectedFilePath?: string
  onSkillLoaded?: (skill: SkillFileInfo) => void
  walkthroughSourceRequest?: WalkthroughSourceRequest
  walkthroughModel?: ModelRef | null
  walkthroughOnOpenSession?: (id: string) => void
}

interface RailButtonProps {
  item: MoreDrawerItem
  active: boolean
  onClick: () => void
  /**
   * Rendered inside the button. When present, the indicator owns the button's accessible name,
   * so the item label is not applied as an `aria-label`.
   */
  indicator?: ReactNode
}

function RailButton({ item, active, onClick, indicator }: RailButtonProps) {
  const Icon = item.icon
  return (
    <Tooltip delayDuration={TOOLTIP_OPEN_DELAY_MS}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={indicator ? undefined : item.label}
          aria-pressed={active}
          className={cn(
            'relative rounded-md p-2 transition-colors',
            active
              ? 'bg-accent text-foreground'
              : item.danger
                ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
          {indicator}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" align="center">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Desktop-only tool panel with its icon rail, rendered to the right of a page's content. The panel
 * docks when the page has room and otherwise floats over the page as a sheet, so the content keeps
 * a usable width. The rail lists the current route's tool items; repo- and session-scoped tools
 * render only when their context is given.
 */
export function ToolSidePanel({
  panel,
  filesBasePath,
  allowNavigateAboveBase,
  repoId,
  sessionId,
  directory,
  terminalDirectory,
  terminalTarget,
  repoDirectory,
  currentBranch = 'main',
  selectedFilePath,
  onSkillLoaded,
  walkthroughSourceRequest,
  walkthroughModel,
  walkthroughOnOpenSession,
}: ToolSidePanelProps) {
  const { activeTool, toggleTool, closePanel } = panel
  const location = useLocation()
  const openNavItem = useOpenNavItem()
  const routeServerId = useRouteOpenCodeServerId()
  const isRemoteRoute = !isLocalOpenCodeServer(routeServerId)
  const railRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const previousActiveToolRef = useRef(activeTool)
  const panelWidth = useToolPanelWidth()
  const { docked } = useToolPanelLayout()
  const floating = activeTool !== null && !docked

  useRestoreFocusOnClose(floating, panelRef)
  useFloatingPanelDismiss(floating, closePanel, panelRef)

  useEffect(() => {
    if (!floating) return
    const panelElement = panelRef.current
    if (panelElement === null || panelElement.contains(document.activeElement)) return
    panelElement.focus()
  }, [floating])

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
  const terminalWorkspaceTarget: TerminalTarget | undefined =
    terminalTarget ?? (repoId === undefined ? undefined : { kind: 'repo', repoId })
  for (const item of buildToolItems(location.pathname)) {
    if (isRemoteRoute && !REMOTE_TOOL_KEYS.has(item.key)) continue
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
    if (tool === 'activity') return <ActivityPanelBody />
    if (tool === 'terminal') {
      return terminalWorkspaceTarget
        ? <TerminalWorkspace target={terminalWorkspaceTarget} directory={terminalDirectory ?? directory} isOpen onLastTerminalExited={closePanel} />
        : null
    }
    if (tool === 'skills') {
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
        <RepoSkillsContent open repoId={repoId} directory={repoDirectory} onDone={closePanel} />
      )
    }
    if (tool === 'sourceControl') {
      if (isRemoteRoute) {
        return repoDirectory
          ? <RemoteSourceControlContent serverId={routeServerId} directory={repoDirectory} compact />
          : null
      }
      return repoId === undefined
        ? null
        : <SourceControlContent repoId={repoId} isOpen currentBranch={currentBranch} compact />
    }
    if (repoId === undefined) return null
    switch (tool) {
      case 'actions':
        return <RepoActionsContent repoId={repoId} directory={directory} open />
      case 'schedules':
        return <RepoSchedulesContent repoId={repoId} embedded />
      case 'secrets':
        return <RepoSecretsContent repoId={repoId} />
    }
  }

  const fixedWidthClass = activeTool ? PANEL_WIDTH_CLASSES[activeTool] : undefined

  const panelBody =
    activeTool && activeLabel ? (
      <>
        {docked ? null : (
          <div
            data-testid="tool-panel-backdrop"
            aria-hidden="true"
            className="fixed inset-y-0 left-0 right-11 z-50 bg-black/50 backdrop-blur-sm"
            onClick={closePanel}
          />
        )}
        <aside
          ref={panelRef}
          aria-label={activeLabel}
          role={docked ? undefined : 'dialog'}
          aria-modal={docked ? undefined : true}
          tabIndex={docked ? undefined : -1}
          className={cn(
            'flex flex-col border-l border-border bg-background outline-none',
            docked
              ? 'relative shrink-0'
              : 'fixed inset-y-0 right-11 z-50 w-[min(420px,calc(100vw-2.75rem))] pt-safe pb-safe shadow-2xl',
            fixedWidthClass,
          )}
          style={docked && !fixedWidthClass ? { width: panelWidth.width } : undefined}
        >
          {docked && !fixedWidthClass ? (
            <PanelResizeHandle
              width={panelWidth.width}
              minWidth={panelWidth.minWidth}
              maxWidth={panelWidth.maxWidth}
              onWidthChange={panelWidth.setWidth}
            />
          ) : null}
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{activeLabel}</h2>
              {activeTool === 'activity' ? <ActivityWindowLabel /> : null}
            </div>
            {activeTool === 'walkthrough' ? (
              <>
                <ChangesWalkthroughSourcePicker />
                <ChangesWalkthroughCancel />
                <ChangesWalkthroughRegenerate />
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
      </>
    ) : null

  const panelContent =
    panelBody !== null && !docked && typeof document !== 'undefined'
      ? createPortal(panelBody, document.body)
      : panelBody

  return (
    <>
      {panelContent ? (
        activeTool === 'walkthrough' && sessionId ? (
          <ChangesWalkthroughProvider
            key={sessionId}
            sessionId={sessionId}
            active
            sourceRequest={walkthroughSourceRequest}
            model={walkthroughModel}
            onOpenSession={walkthroughOnOpenSession}
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
            <RailButton
              key={item.key}
              item={item}
              active={tool === activeTool}
              onClick={() => toggleTool(tool)}
              indicator={tool === 'activity' ? <ActivityRailIndicator /> : undefined}
            />
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
