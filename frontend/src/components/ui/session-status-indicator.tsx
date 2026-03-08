import { memo, useEffect, useState } from 'react'
import { useSessionStatusForSession, type SessionStatusType } from '@/stores/sessionStatusStore'

interface SessionStatusIndicatorProps {
  sessionID: string
  className?: string
}

const SCANNER_WIDTH = 6
const SCANNER_SEGMENTS = 12

export const SessionStatusIndicator = memo(function SessionStatusIndicator({ 
  sessionID, 
  className = '' 
}: SessionStatusIndicatorProps) {
  const status = useSessionStatusForSession(sessionID)
  const [position, setPosition] = useState(0)
  const [direction, setDirection] = useState(1)
  const [retryCountdown, setRetryCountdown] = useState(0)
  
  useEffect(() => {
    if (status.type !== 'busy' && status.type !== 'retry' && status.type !== 'compact') {
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
  }, [status.type, direction])
  
  useEffect(() => {
    if (status.type !== 'retry') {
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
  }, [status])
  
  if (status.type === 'idle') {
    return null
  }
  
  const getSegmentColor = (index: number, statusType: SessionStatusType['type']) => {
    const distance = Math.abs(index - (position + SCANNER_WIDTH / 2))
    const maxDistance = SCANNER_WIDTH / 2
    
    if (distance > maxDistance + 1) {
      return 'bg-muted/20'
    }
    
    const intensity = Math.max(0, 1 - distance / (maxDistance + 2))
    
    if (statusType === 'retry') {
      if (intensity > 0.8) return 'bg-warning'
      if (intensity > 0.5) return 'bg-warning/70'
      if (intensity > 0.2) return 'bg-warning/40'
      return 'bg-warning/20'
    }
    
    if (statusType === 'compact') {
      if (intensity > 0.8) return 'bg-chart-4'
      if (intensity > 0.5) return 'bg-chart-4/70'
      if (intensity > 0.2) return 'bg-chart-4/40'
      return 'bg-chart-4/20'
    }
    
    if (intensity > 0.8) return 'bg-primary'
    if (intensity > 0.5) return 'bg-primary/70'
    if (intensity > 0.2) return 'bg-primary/40'
    return 'bg-primary/20'
  }
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex gap-0.5">
        {Array.from({ length: SCANNER_SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`w-1 h-4 rounded-sm transition-colors duration-75 ${getSegmentColor(i, status.type)}`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {status.type === 'retry'  && (
          <>
            Retry #{status.attempt}
            {retryCountdown > 0 && <span className="ml-1 text-warning">({retryCountdown}s)</span>}
          </>
        )}
      </span>
    </div>
  )
})

interface CompactStatusIndicatorProps {
  sessionID: string
  className?: string
}

export const CompactStatusIndicator = memo(function CompactStatusIndicator({
  sessionID,
  className = ''
}: CompactStatusIndicatorProps) {
  const status = useSessionStatusForSession(sessionID)
  const [frame, setFrame] = useState(0)
  
  useEffect(() => {
    if (status.type !== 'busy' && status.type !== 'retry' && status.type !== 'compact') return
    
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % 8)
    }, 120)
    
    return () => clearInterval(interval)
  }, [status.type])
  
  if (status.type === 'idle') {
    return null
  }
  
  const pulseFrames = ['●', '◐', '○', '◑', '●', '◐', '○', '◑']
  const color = status.type === 'retry' ? 'text-warning' : status.type === 'compact' ? 'text-chart-4' : 'text-primary'
  
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`${color} text-sm font-mono`}>{pulseFrames[frame]}</span>
      <span className={`text-xs ${color}`}>
        {status.type === 'retry' ? `Retry #${status.attempt}` : status.type === 'compact' ? 'Compacting' : 'Working'}
      </span>
    </span>
  )
})
