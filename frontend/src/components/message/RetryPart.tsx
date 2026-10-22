import { memo, useEffect, useState } from 'react'
import type { SessionMessageAssistantRetry } from '@opencode-manager/shared/opencode'
import { RefreshCw } from 'lucide-react'

interface RetryPartProps {
  retry: SessionMessageAssistantRetry
}

export const RetryPart = memo(function RetryPart({ retry }: RetryPartProps) {
  const nextTimestamp = retry.at
  const initialCountdown = nextTimestamp > 0
    ? Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1000))
    : 0
  const [countdown, setCountdown] = useState(initialCountdown)

  useEffect(() => {
    if (nextTimestamp === 0) {
      setCountdown(0)
      return
    }

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining <= 0) {
        clearInterval(timer)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [nextTimestamp])

  return (
    <div className="my-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <RefreshCw
        className="w-3.5 h-3.5 flex-shrink-0 text-warning animate-spin"
        style={{ animationDuration: '2s' }}
      />
      <span className="font-medium text-warning">Retry attempt {retry.attempt}</span>
      {countdown > 0 ? (
        <span className="text-warning/80">(retrying in {countdown}s)</span>
      ) : (
        <span className="text-warning/80">(retrying...)</span>
      )}
      <span aria-hidden="true" className="text-muted-foreground">·</span>
      <span className="min-w-0 break-words text-muted-foreground">{retry.error.message}</span>
    </div>
  )
})
