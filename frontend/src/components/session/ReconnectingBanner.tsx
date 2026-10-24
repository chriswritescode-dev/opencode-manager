import { useEffect, useState } from 'react'

const NOT_CONNECTED_GRACE_PERIOD_MS = 5000

export interface ReconnectingBannerProps {
  connected: boolean
}

function StatusBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full border-b border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning"
    >
      {message}
    </div>
  )
}

export function ReconnectingBanner({ connected }: ReconnectingBannerProps) {
  const [hasConnected, setHasConnected] = useState(false)
  const [graceElapsed, setGraceElapsed] = useState(false)

  useEffect(() => {
    if (connected) setHasConnected(true)
  }, [connected])

  useEffect(() => {
    if (connected) {
      setGraceElapsed(false)
      return
    }
    const timer = setTimeout(() => setGraceElapsed(true), NOT_CONNECTED_GRACE_PERIOD_MS)
    return () => clearTimeout(timer)
  }, [connected])

  if (connected) return null
  if (hasConnected) return <StatusBanner message="Reconnecting… live updates paused" />
  if (graceElapsed) return <StatusBanner message="Not connected — live updates unavailable" />
  return null
}
