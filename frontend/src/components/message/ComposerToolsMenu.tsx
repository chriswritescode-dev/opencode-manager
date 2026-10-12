import type { ReactNode } from 'react'
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

interface ComposerToolsMenuProps {
  sessionID: string
  directory: string
  goalArmed: boolean
  goalDisabled: boolean
  goalLabel: string
  onToggleGoal: () => void
  onAttachFile: () => void
  onDictate?: () => void
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
}: ComposerToolsMenuProps) {
  const permission = usePermissionModeToggle(sessionID, directory)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Composer options"
          title="Composer options"
          className={getIconToggleButtonClassName(permission.isAuto || goalArmed)}
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
        {onDictate ? (
          <DropdownMenuItem onSelect={onDictate} className="pl-8">
            <ToolMenuItemContent icon={<Mic className="h-4 w-4" />} title="Dictate" />
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ToolMenuItemContent({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <span className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span>{title}</span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  )
}
