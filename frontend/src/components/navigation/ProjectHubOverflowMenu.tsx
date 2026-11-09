import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Columns3,
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
import { useOpenProjectTool } from '@/hooks/useOpenProjectTool'
import { ProjectActionsMenuItems, useProjectActionsMenu } from '@/components/repo/ProjectActionsMenu'
import type { NavItem } from '@/components/navigation/navItems'

interface ProjectHubOverflowMenuProps {
  repoId: number
  directory: string | undefined
  onCreateWorktree?: () => void
  includeMultiRun?: boolean
}

/**
 * Renders the project hub's overflow menu: actions, multi-run, worktree creation and repo tools.
 */
export function ProjectHubOverflowMenu({
  repoId,
  directory,
  onCreateWorktree,
  includeMultiRun = true,
}: ProjectHubOverflowMenuProps) {
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
      <DropdownMenu open={open} onOpenChange={setOpen}>
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
          {repoTools.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenuItem
                key={item.key}
                className={item.danger ? 'text-destructive' : undefined}
                onSelect={() => openProjectTool(item, target)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {item.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {trustDialog}
    </>
  )
}
