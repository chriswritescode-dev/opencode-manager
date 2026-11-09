import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { CalendarClock, Columns3, Layers, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RemoteMultiRun, useRemoteMultiRun } from '@/components/repo/RemoteMultiRunButton'
import { RemoteSchedulesDialog } from '@/components/schedules/RemoteSchedulesButton'
import { useOpenProjectDialog, useOpenProjectTool } from '@/hooks/useOpenProjectTool'
import { ProjectActionsMenuItems, useProjectActionsMenu } from '@/components/repo/ProjectActionsMenu'
import { buildNavModel, buildProjectNavModel, navItemByKey, type NavItem } from '@/components/navigation/navItems'
import type { ProjectTarget } from '@/lib/projectTarget'

const REPO_TOOL_ITEM_KEYS: readonly string[] = [
  'mcp',
  'skills',
  'secrets',
  'terminal',
  'preview',
  'schedules',
  'reset-permissions',
]

const SERVER_TOOL_ITEM_KEYS: readonly string[] = ['mcp', 'skills', 'source-control', 'terminal']

const SERVER_TOOL_LABELS: Readonly<Partial<Record<string, string>>> = { 'source-control': 'Git' }

/**
 * Repo tool items for the hub menu, read from the repo detail route's model so the hub offers every
 * repo tool, including for the assistant repo whose side-menu model describes the assistant workspace.
 */
function repoToolItems(repoId: number): NavItem[] {
  return buildNavModel(`/repos/${repoId}`).items
}

interface ProjectHubOverflowMenuProps {
  target: ProjectTarget
  directory?: string
  onCreateWorktree?: () => void
  includeMultiRun?: boolean
}

/**
 * Renders the project hub's overflow menu with the actions for a Manager repo or a linked server.
 */
export function ProjectHubOverflowMenu({
  target,
  directory,
  onCreateWorktree,
  includeMultiRun,
}: ProjectHubOverflowMenuProps) {
  if (target.kind === 'repo') {
    return (
      <RepoProjectOverflowMenu
        repoId={target.repoId}
        directory={directory}
        onCreateWorktree={onCreateWorktree}
        includeMultiRun={includeMultiRun}
      />
    )
  }
  return (
    <ServerProjectOverflowMenu
      serverId={target.serverId}
      directory={directory ?? target.directory}
    />
  )
}

interface RepoProjectOverflowMenuProps {
  repoId: number
  directory: string | undefined
  onCreateWorktree?: () => void
  includeMultiRun?: boolean
}

function RepoProjectOverflowMenu({
  repoId,
  directory,
  onCreateWorktree,
  includeMultiRun = true,
}: RepoProjectOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const openProjectTool = useOpenProjectTool()
  const openProjectDialog = useOpenProjectDialog()
  const target = useMemo(() => ({ kind: 'repo' as const, repoId }), [repoId])
  const navItems = useMemo(() => repoToolItems(repoId), [repoId])
  const repoTools = REPO_TOOL_ITEM_KEYS.map((key) => navItemByKey(navItems, key))

  const openTerminal = useCallback((terminalId: string | null, extraParams?: Record<string, string>) => {
    openProjectDialog('terminal', target, {
      ...(terminalId ? { terminal: terminalId } : {}),
      ...extraParams,
    })
  }, [openProjectDialog, target])

  const openPreview = useCallback((port: number, path = '/') => {
    openProjectDialog('preview', target, {
      previewPort: String(port),
      previewPath: path,
    })
  }, [openProjectDialog, target])

  const {
    actions,
    runningByAction,
    isRunning,
    startRun,
    stopRun,
    manageActions,
    trustDialog,
  } = useProjectActionsMenu({
    repoId,
    directory,
    active: open,
    openTerminal,
    openPreview,
    onManageActions: () => openProjectTool(navItemByKey(navItems, 'actions'), target),
  })

  return (
    <>
      <ProjectActionsTrigger open={open} onOpenChange={setOpen}>
        <ProjectActionsMenuItems
          actions={actions}
          runningByAction={runningByAction}
          isRunning={isRunning}
          onRun={startRun}
          onStop={stopRun}
          onManage={manageActions}
        />
        <DropdownMenuSeparator />
        {includeMultiRun && (
          <DropdownMenuItem
            onSelect={() => openProjectTool({ key: 'multiRun', label: 'Multi-run', icon: Columns3, dialog: 'multiRun' }, target)}
          >
            <Columns3 className="mr-2 h-4 w-4" />
            Multi-run
          </DropdownMenuItem>
        )}
        {onCreateWorktree && (
          <DropdownMenuItem onSelect={onCreateWorktree}>
            <Layers className="mr-2 h-4 w-4" />
            Create worktree
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Project tools</DropdownMenuLabel>
        {repoTools.map((item) => (
          <ProjectToolMenuItem key={item.key} item={item} onSelect={() => openProjectTool(item, target)} />
        ))}
      </ProjectActionsTrigger>
      {trustDialog}
    </>
  )
}

function ServerProjectOverflowMenu({ serverId, directory }: { serverId: string; directory: string }) {
  const [open, setOpen] = useState(false)
  const [schedulesOpen, setSchedulesOpen] = useState(false)
  const openProjectTool = useOpenProjectTool()
  const {
    mounted: multiRunMounted,
    open: multiRunOpen,
    setOpen: setMultiRunOpen,
    openMultiRun,
  } = useRemoteMultiRun()
  const target = useMemo<ProjectTarget>(
    () => ({ kind: 'server', serverId, directory }),
    [serverId, directory],
  )
  const navItems = useMemo(() => buildProjectNavModel(target).items, [target])
  const serverTools = SERVER_TOOL_ITEM_KEYS.map((key) => {
    const item = navItemByKey(navItems, key)
    const label = SERVER_TOOL_LABELS[key]
    return label ? { ...item, label } : item
  })

  return (
    <>
      <ProjectActionsTrigger open={open} onOpenChange={setOpen}>
        <DropdownMenuItem onSelect={() => setSchedulesOpen(true)}>
          <CalendarClock className="mr-2 h-4 w-4" />
          Schedules
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openMultiRun}>
          <Columns3 className="mr-2 h-4 w-4" />
          Multi-run
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Project tools</DropdownMenuLabel>
        {serverTools.map((item) => (
          <ProjectToolMenuItem key={item.key} item={item} onSelect={() => openProjectTool(item, target)} />
        ))}
      </ProjectActionsTrigger>
      <RemoteSchedulesDialog
        serverId={serverId}
        directory={directory}
        open={schedulesOpen}
        onOpenChange={setSchedulesOpen}
      />
      {multiRunMounted ? (
        <RemoteMultiRun
          serverId={serverId}
          directory={directory}
          open={multiRunOpen}
          onOpenChange={setMultiRunOpen}
        />
      ) : null}
    </>
  )
}

interface ProjectActionsTriggerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function ProjectActionsTrigger({ open, onOpenChange, children }: ProjectActionsTriggerProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Project actions"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ProjectToolMenuItemProps {
  item: NavItem
  onSelect: () => void
}

function ProjectToolMenuItem({ item, onSelect }: ProjectToolMenuItemProps) {
  const Icon = item.icon
  return (
    <DropdownMenuItem
      className={item.danger ? 'text-destructive' : undefined}
      onSelect={onSelect}
    >
      <Icon className="mr-2 h-4 w-4" />
      {item.label}
    </DropdownMenuItem>
  )
}
