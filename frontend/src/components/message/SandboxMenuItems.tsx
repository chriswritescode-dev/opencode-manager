import { Box, Cpu } from 'lucide-react'
import { DropdownMenuCheckboxItem, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatSandboxResources, shouldShowSandboxResources, type SandboxToggleState } from '@/lib/sandboxResources'
import { ToolMenuItemContent } from './ToolMenuItemContent'

interface SandboxMenuItemsProps {
  sandbox: SandboxToggleState
  onOpenResources: () => void
}

export function SandboxMenuItems({ sandbox, onOpenResources }: SandboxMenuItemsProps) {
  return (
    <>
      {sandbox.available ? (
        <DropdownMenuCheckboxItem
          checked={sandbox.isSandboxed}
          disabled={sandbox.disabled}
          onCheckedChange={sandbox.toggle}
        >
          <ToolMenuItemContent
            icon={<Box className="h-4 w-4" />}
            title="Sandbox commands"
            detail={sandbox.disabled ? sandbox.label : undefined}
          />
        </DropdownMenuCheckboxItem>
      ) : null}
      {shouldShowSandboxResources(sandbox) ? (
        <DropdownMenuItem className="pl-8" aria-haspopup="dialog" onSelect={() => setTimeout(onOpenResources, 0)}>
          <ToolMenuItemContent
            icon={<Cpu className="h-4 w-4" />}
            title="Sandbox resources…"
            detail={`${formatSandboxResources(sandbox.effectiveResources!)}${sandbox.resources ? ' · custom' : ''}`}
          />
        </DropdownMenuItem>
      ) : null}
    </>
  )
}
