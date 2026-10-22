import { useMemo, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMobile } from '@/hooks/useMobile'
import { clampDisplayText, tailLines } from '@/lib/clampDisplayText'
import { cn } from '@/lib/utils'
import { TRANSCRIPT_DETAIL_CLASS } from './transcriptStyles'

const SHELL_PREVIEW_LINES = 10
const MOBILE_SHELL_PREVIEW_LINES = 4

/** Tool-detail disclosure state that follows the preference until the user toggles it and never auto-opens on mobile. */
export function useToolDetailsState(defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const isMobile = useMobile()
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  return [userOpen ?? (defaultOpen && !isMobile), setUserOpen]
}

/** Renders tool detail content inline on desktop and in a fullscreen dialog on mobile. */
export function ToolDetails({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  const isMobile = useMobile()

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen className="flex flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle className="truncate pr-8 font-mono text-sm">{title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-3 p-4">{children}</div>
        </DialogContent>
      </Dialog>
    )
  }

  return open ? <div className={cn(TRANSCRIPT_DETAIL_CLASS, 'space-y-2')}>{children}</div> : null
}

/** Compact shell call summary that reveals the full detail when clicked. */
export function ShellPreview({
  command,
  output,
  onClick,
  status,
}: {
  command: string
  output: string
  onClick: () => void
  status?: ReactNode
}) {
  const isMobile = useMobile()
  const lineLimit = isMobile ? MOBILE_SHELL_PREVIEW_LINES : SHELL_PREVIEW_LINES
  const tail = useMemo(() => {
    const result = tailLines(output, lineLimit)
    return { ...result, text: clampDisplayText(result.text) }
  }, [output, lineLimit])

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show shell details"
      className="my-1 block w-full bg-muted px-3 py-2 text-left font-mono text-xs text-foreground hover:bg-accent transition-colors md:px-4 md:py-3"
    >
      <div className="flex items-start gap-2">
        <div className="line-clamp-1 min-w-0 flex-1 break-all md:line-clamp-2">
          <span className="text-success">$</span> {command}
        </div>
        {status}
      </div>
      {tail.text && (
        <div className="mt-1.5 md:mt-2">
          {tail.hiddenCount > 0 && (
            <div className="text-muted-foreground">({tail.hiddenCount} earlier lines)</div>
          )}
          <div className="whitespace-pre-wrap break-all text-muted-foreground">{tail.text}</div>
        </div>
      )}
    </button>
  )
}
