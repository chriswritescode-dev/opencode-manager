import { memo, useState, useEffect } from 'react'
import type { components } from '@/api/opencode-types'
import { RefreshCw, AlertTriangle } from 'lucide-react'

type RetryPartType = components['schemas']['RetryPart']

interface RetryPartProps {
  part: RetryPartType
}

export const RetryPart = memo(function RetryPart({ part }: RetryPartProps) {
  const [countdown, setCountdown] = useState(5)
  
  useEffect(() => {
    if (countdown <= 0) return
    
    const timer = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)
    
    return () => clearInterval(timer)
  }, [countdown])
  
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
          {countdown > 0 && (
            <span className="text-xs text-amber-500/80">
              (retrying in {countdown}s)
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
