import { useState } from 'react'
import { Box } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getIconToggleButtonClassName } from '@/components/ui/icon-toggle-button'
import { useSandboxToggle } from '@/hooks/useSandboxToggle'
import { shouldShowSandboxResources } from '@/lib/sandboxResources'
import { SandboxMenuItems } from '@/components/message/SandboxMenuItems'
import { SessionSandboxResourcesDialog } from '@/components/message/SessionSandboxResourcesDialog'

interface SessionSandboxMenuProps {
  sessionID: string
}

export function SessionSandboxMenu({ sessionID }: SessionSandboxMenuProps) {
  const sandbox = useSandboxToggle(sessionID)
  const [resourcesOpen, setResourcesOpen] = useState(false)

  if (!sandbox.available) return null

  const label = `Sandbox: ${sandbox.isSandboxed ? 'on' : 'off'}${
    sandbox.lockedReason === 'child' ? ` (${sandbox.label})` : ''
  }`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            className={getIconToggleButtonClassName(sandbox.isSandboxed)}
          >
            <Box className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" collisionPadding={8} className="w-64">
          <SandboxMenuItems sandbox={sandbox} onOpenResources={() => setResourcesOpen(true)} />
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
