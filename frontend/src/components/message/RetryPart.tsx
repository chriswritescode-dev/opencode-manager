import { memo, useEffect, useState } from 'react'
import type { components } from '@/api/opencode-types'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'

type RetryPartType = components['schemas']['RetryPart']

interface RetryPartProps {
  part: RetryPartType
}

export const RetryPart = memo(function RetryPart({ part }: RetryPartProps) {
  const sessionStatus = useSessionStatusForSession(part.sessionID)
  const nextTimestamp = sessionStatus.type === 'retry' ? sessionStatus.next : 0
  const initialCountdown = sessionStatus.type === 'retry' && nextTimestamp > 0
    ? Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1000))
    : 0
  const [countdown, setCountdown] = useState(initialCountdown)
  
  useEffect(() => {
    if (sessionStatus.type !== 'retry' || nextTimestamp === 0) {
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
  }, [sessionStatus.type, nextTimestamp])
  
  const errorMessage = part.error?.data?.message || 'An error occurred'
  
  return (
    <div className="my-2 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
      <div className="flex-shrink-0">
        <div className="relative">
          <RefreshCw className="h-5 w-5 animate-spin text-warning" style={{ animationDuration: '2s' }} />
          <AlertTriangle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 text-warning" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-warning">
            Retry attempt {part.attempt}
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
          {errorMessage}
        </p>
      </div>
    </div>
  )
})
