import { memo, useEffect, useState } from 'react'
import { useSessionStatusForSession, type SessionStatusType } from '@/stores/sessionStatusStore'

interface MiniScannerProps {
  sessionID: string
  className?: string
}

const SCANNER_WIDTH = 6
const SCANNER_SEGMENTS = 12

export const MiniScanner = memo(function MiniScanner({
  sessionID,
  className = ''
}: MiniScannerProps) {
  const status = useSessionStatusForSession(sessionID)
  const [position, setPosition] = useState(0)
  const [direction, setDirection] = useState(1)

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

  const getSegmentColor = (index: number, statusType: SessionStatusType['type']) => {
    if (statusType === 'idle') {
      return 'bg-transparent'
    }

    const distance = Math.abs(index - (position + SCANNER_WIDTH / 2))
    const maxDistance = SCANNER_WIDTH / 2

    if (distance > maxDistance + 1) {
      return 'bg-muted/20'
    }

    const intensity = Math.max(0, 1 - distance / (maxDistance + 2))

    if (statusType === 'retry') {
      if (intensity > 0.8) return 'bg-amber-500'
      if (intensity > 0.5) return 'bg-amber-500/70'
      if (intensity > 0.2) return 'bg-amber-500/40'
      return 'bg-amber-500/20'
    }

    if (statusType === 'compact') {
      if (intensity > 0.8) return 'bg-purple-500'
      if (intensity > 0.5) return 'bg-purple-500/70'
      if (intensity > 0.2) return 'bg-purple-500/40'
      return 'bg-purple-500/20'
    }

    if (intensity > 0.8) return 'bg-blue-500'
    if (intensity > 0.5) return 'bg-blue-500/70'
    if (intensity > 0.2) return 'bg-blue-500/40'
    return 'bg-blue-500/20'
  }

  return (
    <div className={`flex items-center ${className}`}>
      <div className="flex gap-0.5">
        {Array.from({ length: SCANNER_SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className={`w-0.5 h-2 rounded-sm transition-colors duration-75 ${getSegmentColor(i, status.type)}`}
          />
        ))}
      </div>
    </div>
  )
})