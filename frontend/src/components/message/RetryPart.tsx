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
    <div className="flex items-center gap-3 p-3 my-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <div className="flex-shrink-0">
        <div className="relative">
          <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" style={{ animationDuration: '2s' }} />
          <AlertTriangle className="w-3 h-3 text-amber-600 absolute -bottom-0.5 -right-0.5" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Retry attempt {part.attempt}
          </span>
          {countdown > 0 ? (
            <span className="text-xs text-amber-500/80">
              (retrying in {countdown}s)
            </span>
          ) : (
            <span className="text-xs text-amber-500/80">
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
