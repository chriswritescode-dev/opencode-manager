import { memo, useEffect, useState } from 'react'
import { ActivitySpinner } from '@/components/ui/activity-spinner'
import { useHasBackgroundActivity, useSessionStatusForSession, type SessionStatusType } from '@/stores/sessionStatusStore'

interface SessionStatusIndicatorProps {
  sessionID: string
  className?: string
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const SCANNER_WIDTH = 6
const SCANNER_SEGMENTS = 12

/**
 * Shows a session's activity. `sm` renders the braille spinner sized for list rows;
 * `md` renders the animated scanner used by the session composer.
 */
export const SessionStatusIndicator = memo(function SessionStatusIndicator({ 
  sessionID, 
  className = '',
  size = 'md',
  showLabel = false
}: SessionStatusIndicatorProps) {
  const status = useSessionStatusForSession(sessionID)
  const hasBackground = useHasBackgroundActivity(sessionID)
  const [position, setPosition] = useState(0)
  const [direction, setDirection] = useState(1)
  const [retryCountdown, setRetryCountdown] = useState(0)
  const backgroundOnly = status.type === 'idle' && hasBackground
  
  useEffect(() => {
    if (size !== 'md') {
      return
    }
    if (status.type === 'idle' && !hasBackground) {
      return
    }
    
    const interval = setInterval(() => {
      setPosition(prev => {
        const next = prev + direction
        if (next >= SCANNER_SEGMENTS - SCANNER_WIDTH) {
          setDirection(-1)
          return SCANNER_SEGMENTS - SCANNER_WIDTH
        }
        if (next <= 0) {
          setDirection(1)
          return 0
        }
        return next
      })
    }, 60)
    
    return () => clearInterval(interval)
  }, [size, status.type, hasBackground, direction])
  
  useEffect(() => {
    if (!showLabel || status.type !== 'retry') {
      setRetryCountdown(0)
      return
    }
    
    const remaining = Math.max(0, Math.ceil((status.next - Date.now()) / 1000))
    setRetryCountdown(remaining)
    
    const interval = setInterval(() => {
      const newRemaining = Math.max(0, Math.ceil((status.next - Date.now()) / 1000))
      setRetryCountdown(newRemaining)
    }, 1000)
    
    return () => clearInterval(interval)
  }, [status, showLabel])
  
  if (status.type === 'idle' && !hasBackground) {
    return null
  }
  
  if (size === 'sm') {
    const colorClass = backgroundOnly
      ? 'text-muted-foreground'
      : status.type === 'retry'
        ? 'text-warning'
        : status.type === 'compact'
          ? 'text-primary'
          : 'text-info'
    const label = backgroundOnly
      ? 'Background tasks running'
      : status.type === 'retry'
        ? 'Retrying'
        : status.type === 'compact'
          ? 'Compacting'
          : 'Running'

    return (
      <span
        role="img"
        aria-label={label}
        title={backgroundOnly ? label : undefined}
        className={`inline-flex items-center ${colorClass} ${className}`}
      >
        <ActivitySpinner />
      </span>
    )
  }
  
  const getSegmentColor = (index: number, statusType: SessionStatusType['type'], background: boolean) => {
    const distance = Math.abs(index - (position + SCANNER_WIDTH / 2))
    const maxDistance = SCANNER_WIDTH / 2
    
    if (distance > maxDistance + 1) {
      return 'bg-muted/20'
    }
    
    const intensity = Math.max(0, 1 - distance / (maxDistance + 2))
    
    if (background) {
      if (intensity > 0.8) return 'bg-muted-foreground'
      if (intensity > 0.5) return 'bg-muted-foreground/70'
      if (intensity > 0.2) return 'bg-muted-foreground/40'
      return 'bg-muted-foreground/20'
    }

    if (statusType === 'retry') {
      if (intensity > 0.8) return 'bg-warning'
      if (intensity > 0.5) return 'bg-warning/70'
      if (intensity > 0.2) return 'bg-warning/40'
      return 'bg-warning/20'
    }
    
    if (statusType === 'compact') {
      if (intensity > 0.8) return 'bg-primary'
      if (intensity > 0.5) return 'bg-primary/70'
      if (intensity > 0.2) return 'bg-primary/40'
      return 'bg-primary/20'
    }
    
    if (intensity > 0.8) return 'bg-info'
    if (intensity > 0.5) return 'bg-info/70'
    if (intensity > 0.2) return 'bg-info/40'
    return 'bg-info/20'
  }
  
  const segmentClass = 'w-1 h-4'
  const containerGap = showLabel ? 'gap-2' : ''
  
  return (
    <div
      className={`flex items-center ${containerGap} ${className}`}
      title={backgroundOnly ? 'Background tasks running' : undefined}
      aria-label={backgroundOnly ? 'Background tasks running' : undefined}
    >
      <div className="flex gap-0.5">
        {Array.from({ length: SCANNER_SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`${segmentClass} rounded-sm transition-colors duration-75 ${getSegmentColor(i, status.type, backgroundOnly)}`}
          />
        ))}
      </div>
      {showLabel && status.type === 'retry' && (
        <span className="text-xs text-muted-foreground">
          Retry #{status.attempt}
          {retryCountdown > 0 && <span className="text-warning ml-1">({retryCountdown}s)</span>}
        </span>
      )}
    </div>
  )
})
