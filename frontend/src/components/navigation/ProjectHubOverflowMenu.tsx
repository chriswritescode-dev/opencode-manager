import { useMemo, useState, type ReactNode } from 'react'
import {
  CalendarClock,
  Columns3,
  GitCommitHorizontal,
  Globe,
  KeyRound,
  Layers,
  MoreHorizontal,
  Play,
  Plug,
  ShieldOff,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
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
import { useOpenProjectTool } from '@/hooks/useOpenProjectTool'
import { ProjectActionsMenuItems, useProjectActionsMenu } from '@/components/repo/ProjectActionsMenu'
import type { NavItem } from '@/components/navigation/navItems'
import type { ProjectTarget } from '@/lib/projectTarget'

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
  const target = useMemo(() => ({ kind: 'repo' as const, repoId }), [repoId])
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
    onManageActions: () => openProjectTool({ key: 'actions', label: 'Actions', icon: Play, dialog: 'actions' }, target),
  })

  const repoTools: NavItem[] = [
    { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
    { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
    { key: 'secrets', label: 'Secrets', icon: KeyRound, dialog: 'secrets' },
    { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
    { key: 'preview', label: 'Preview', icon: Globe, dialog: 'preview' },
    { key: 'schedules', label: 'Schedules', icon: CalendarClock, to: `/repos/${repoId}/schedules` },
    { key: 'reset-permissions', label: 'Reset Permissions', icon: ShieldOff, dialog: 'resetPermissions', danger: true },
  ]

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

  const serverTools: NavItem[] = [
    { key: 'mcp', label: 'MCP', icon: Plug, dialog: 'mcp' },
    { key: 'skills', label: 'Skills', icon: Sparkles, dialog: 'skills' },
    { key: 'source-control', label: 'Git', icon: GitCommitHorizontal, dialog: 'sourceControl' },
    { key: 'terminal', label: 'Terminal', icon: SquareTerminal, dialog: 'terminal' },
  ]

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
