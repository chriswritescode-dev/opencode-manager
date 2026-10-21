import { useState } from 'react'
import { Paperclip, Plus, Shield, ShieldCheck, Target } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getIconToggleButtonClassName } from '@/components/ui/icon-toggle-button'
import { isLocalOpenCodeServer, useOpenCodeServerId } from '@/contexts/OpenCodeServerContext'
import { usePermissionModeToggle } from '@/hooks/usePermissionModeToggle'
import { useSandboxToggle } from '@/hooks/useSandboxToggle'
import { shouldShowSandboxResources } from '@/lib/sandboxResources'
import { cn } from '@/lib/utils'
import { SandboxMenuItems } from './SandboxMenuItems'
import { ToolMenuItemContent } from './ToolMenuItemContent'
import { SessionSandboxResourcesDialog } from './SessionSandboxResourcesDialog'

interface ComposerToolsMenuProps {
  sessionID: string
  directory: string
  goalArmed: boolean
  goalDisabled: boolean
  goalLabel: string
  onToggleGoal: () => void
  onAttachFile: () => void
}

/**
 * Renders the mobile composer tools trigger: a dropdown for permission mode,
 * sandboxing, goal mode, and file attachment.
 *
 * @param props Session context, goal state, and the attach handler.
 */
export function ComposerToolsMenu({
  sessionID,
  directory,
  goalArmed,
  goalDisabled,
  goalLabel,
  onToggleGoal,
  onAttachFile,
}: ComposerToolsMenuProps) {
  const isLocalServer = isLocalOpenCodeServer(useOpenCodeServerId())
  const permission = usePermissionModeToggle(sessionID, directory)
  const sandbox = useSandboxToggle(sessionID, { enabled: isLocalServer })
  const [resourcesOpen, setResourcesOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Composer options"
            title="Composer options"
            className={cn(getIconToggleButtonClassName(permission.isAuto || sandbox.isSandboxed || goalArmed), 'flex items-center justify-center size-9 p-0')}
          >
            <Plus className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" collisionPadding={8} className="w-64">
          <DropdownMenuCheckboxItem
            checked={permission.isAuto}
            disabled={permission.disabled}
            onCheckedChange={permission.toggle}
          >
            <ToolMenuItemContent
              icon={permission.isAuto ? <ShieldCheck className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              title="Accept all permissions"
              detail={permission.disabled ? permission.label : undefined}
            />
          </DropdownMenuCheckboxItem>
          {isLocalServer && (
            <SandboxMenuItems sandbox={sandbox} onOpenResources={() => setResourcesOpen(true)} />
          )}
          <DropdownMenuCheckboxItem checked={goalArmed} disabled={goalDisabled} onCheckedChange={onToggleGoal}>
            <ToolMenuItemContent
              icon={<Target className="h-4 w-4" />}
              title="Goal mode"
              detail={goalDisabled ? goalLabel : undefined}
            />
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onAttachFile} className="pl-8">
            <ToolMenuItemContent icon={<Paperclip className="h-4 w-4" />} title="Attach image or PDF" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {shouldShowSandboxResources(sandbox) ? (
        <SessionSandboxResourcesDialog
          sessionID={sessionID}
          open={resourcesOpen}
          onOpenChange={setResourcesOpen}
          override={sandbox.resources}
          effective={sandbox.effectiveResources!}
        />
      ) : null}
    </>
  )
}
