import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { OutputsPanel } from './OutputsPanel'
import type { OutputOpenRequest } from './OutputsPanel'
import { SideDrawer, SideDrawerHeader } from '@/components/ui/side-drawer'
import type { ModelRef } from '@opencode-manager/shared/opencode'

export interface OutputSheetProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  definitionId: string
  onDefinitionChange: (definitionId: string) => void
  request?: OutputOpenRequest
  model?: ModelRef | null
  onOpenSession?: (sessionId: string) => void
  onOpenFile?: (path: string, line?: number) => void
}

/** The outputs panel as a right-side sheet: full screen on mobile, a drawer over the page on desktop. */
export function OutputSheet({
  sessionId,
  open,
  onOpenChange,
  definitionId,
  onDefinitionChange,
  request,
  model,
  onOpenSession,
  onOpenFile,
}: OutputSheetProps): ReactNode {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <SideDrawer
      isOpen={open}
      onClose={close}
      side="right"
      widthClass="w-full sm:w-[min(640px,92vw)]"
      ariaLabel="Outputs"
    >
      <SideDrawerHeader title="Outputs" onClose={close} />
      <OutputsPanel
        key={sessionId}
        sessionId={sessionId}
        definitionId={definitionId}
        onDefinitionChange={onDefinitionChange}
        request={request}
        model={model}
        onOpenSession={onOpenSession}
        onOpenFile={onOpenFile}
      />
    </SideDrawer>
  )
}
