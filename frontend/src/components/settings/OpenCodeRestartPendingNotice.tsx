import { useEffect, type RefObject } from 'react'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useServerHealth } from '@/hooks/useServerHealth'

interface OpenCodeRestartPendingNoticeProps {
  hasAutoPromptedRef: RefObject<boolean>
  openRestartPrompt: () => void
  requestRestart: () => void
  restartIsPending: boolean
}

export function OpenCodeRestartPendingNotice({
  hasAutoPromptedRef,
  openRestartPrompt,
  requestRestart,
  restartIsPending,
}: OpenCodeRestartPendingNoticeProps) {
  const { data: health } = useServerHealth()

  useEffect(() => {
    if (health?.opencodeRestartPending && !hasAutoPromptedRef.current) {
      hasAutoPromptedRef.current = true
      void openRestartPrompt()
    }
  }, [health?.opencodeRestartPending, hasAutoPromptedRef, openRestartPrompt])

  if (!health?.opencodeRestartPending) {
    return null
  }

  return (
    <div className="shrink-0 bg-background px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm">
            Configuration changes are saved but require a server restart to take effect.
          </p>
        </div>
        <Button
          size="sm"
          onClick={requestRestart}
          disabled={restartIsPending}
          className="shrink-0"
        >
          {restartIsPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3 mr-1" />
          )}
          Restart Now
        </Button>
      </div>
    </div>
  )
}
