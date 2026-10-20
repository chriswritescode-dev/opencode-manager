import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Layers, Loader2, MoreVertical, Plus } from 'lucide-react'
import { useCreateSession } from '@/hooks/useOpenCode'
import { useMobile } from '@/hooks/useMobile'
import { getServerSessionPath } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RemoteSchedulesDialog } from '@/components/schedules/RemoteSchedulesButton'
import { RemoteMultiRun } from '@/components/repo/RemoteMultiRunButton'

interface RemoteProjectRowActionsProps {
  serverId: string
  directory: string
}

interface ProjectActionButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}

function ProjectActionButton({ label, onClick, disabled, children }: ProjectActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          size="sm"
          variant="ghost"
          onClick={onClick}
          disabled={disabled}
          className="h-8 w-8 p-0"
          title={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The project actions for one remote project: new session, schedules, and multi-run. Desktop shows
 * inline icon buttons and mobile shows a menu, matching local repository rows.
 */
export function RemoteProjectRowActions({ serverId, directory }: RemoteProjectRowActionsProps) {
  const navigate = useNavigate()
  const isMobile = useMobile()
  const createSession = useCreateSession(directory)
  const [schedulesOpen, setSchedulesOpen] = useState(false)
  const [multiRunMounted, setMultiRunMounted] = useState(false)
  const [multiRunOpen, setMultiRunOpen] = useState(false)

  const handleNewSession = async () => {
    try {
      const session = await createSession.mutateAsync({ agent: undefined })
      navigate(getServerSessionPath(serverId, session.id))
    } catch {
      return
    }
  }

  const handleMultiRunOpen = () => {
    setMultiRunMounted(true)
    setMultiRunOpen(true)
  }

  return (
    <div className="contents" onClick={(event) => event.stopPropagation()}>
      {isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Project actions"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Project actions"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[200]"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem
              onClick={() => {
                void handleNewSession()
              }}
              disabled={createSession.isPending}
            >
              {createSession.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              New session
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSchedulesOpen(true)}>
              <CalendarClock className="w-4 h-4 mr-2" />
              Schedules
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleMultiRunOpen}>
              <Layers className="w-4 h-4 mr-2" />
              Multi-run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-1">
            <ProjectActionButton
              label="New session"
              onClick={() => {
                void handleNewSession()
              }}
              disabled={createSession.isPending}
            >
              {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </ProjectActionButton>
            <ProjectActionButton label="Schedules" onClick={() => setSchedulesOpen(true)}>
              <CalendarClock className="w-4 h-4" />
            </ProjectActionButton>
            <ProjectActionButton label="Multi-run" onClick={handleMultiRunOpen}>
              <Layers className="w-4 h-4" />
            </ProjectActionButton>
          </div>
        </TooltipProvider>
      )}

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
    </div>
  )
}
