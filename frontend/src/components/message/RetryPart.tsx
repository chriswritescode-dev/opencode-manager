import { memo, useEffect, useState } from 'react'
import type { SessionMessageAssistantRetry } from '@opencode-manager/shared/opencode'
import { RefreshCw, AlertTriangle } from 'lucide-react'

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
    <div className="flex items-center gap-3 p-3 my-2 rounded-lg bg-warning/10 border border-warning/30">
      <div className="flex-shrink-0">
        <div className="relative">
          <RefreshCw className="w-5 h-5 text-warning animate-spin" style={{ animationDuration: '2s' }} />
          <AlertTriangle className="w-3 h-3 text-warning absolute -bottom-0.5 -right-0.5" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-warning">
            Retry attempt {retry.attempt}
          </span>
          {countdown > 0 ? (
            <span className="text-xs text-warning/80">
              (retrying in {countdown}s)
            </span>
          ) : (
            <span className="text-xs text-warning/80">
              (retrying...)
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {retry.error.message}
        </p>
      </div>
    </div>
  )
})
