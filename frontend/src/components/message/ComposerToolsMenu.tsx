import { useState } from 'react'
import { Mic, Paperclip, Plus, Shield, ShieldCheck, Target } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getIconToggleButtonClassName } from '@/components/ui/icon-toggle-button'
import { usePermissionModeToggle } from '@/hooks/usePermissionModeToggle'
import { useSandboxToggle } from '@/hooks/useSandboxToggle'
import { shouldShowSandboxResources } from '@/lib/sandboxResources'
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
  onDictate?: () => void
  allowManagerTools?: boolean
}

export function ComposerToolsMenu({
  sessionID,
  directory,
  goalArmed,
  goalDisabled,
  goalLabel,
  onToggleGoal,
  onAttachFile,
  onDictate,
  allowManagerTools = true,
}: ComposerToolsMenuProps) {
  const permission = usePermissionModeToggle(sessionID, directory, { enabled: allowManagerTools })
  const sandbox = useSandboxToggle(sessionID, { enabled: allowManagerTools })
  const [resourcesOpen, setResourcesOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Composer options"
            title="Composer options"
            className={`${getIconToggleButtonClassName(permission.isAuto || sandbox.isSandboxed || goalArmed)} flex items-center justify-center min-h-[44px] min-w-[44px]`}
          >
            <Plus className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" collisionPadding={8} className="w-64">
          {allowManagerTools ? (
            <>
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
              <SandboxMenuItems sandbox={sandbox} onOpenResources={() => setResourcesOpen(true)} />
              <DropdownMenuCheckboxItem checked={goalArmed} disabled={goalDisabled} onCheckedChange={onToggleGoal}>
                <ToolMenuItemContent
                  icon={<Target className="h-4 w-4" />}
                  title="Goal mode"
                  detail={goalDisabled ? goalLabel : undefined}
                />
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={onAttachFile} className="pl-8">
            <ToolMenuItemContent icon={<Paperclip className="h-4 w-4" />} title="Attach image or PDF" />
          </DropdownMenuItem>
          {onDictate ? (
            <DropdownMenuItem onSelect={onDictate} className="pl-8">
              <ToolMenuItemContent icon={<Mic className="h-4 w-4" />} title="Dictate" />
            </DropdownMenuItem>
          ) : null}
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
