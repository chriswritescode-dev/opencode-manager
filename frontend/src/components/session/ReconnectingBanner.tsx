import { useEffect, useState } from 'react'

export interface ReconnectingBannerProps {
  connected: boolean
}

/**
 * Full-width strip under the session header that reports a paused event
 * stream. It stays hidden until the stream has connected at least once, so a
 * first paint before the subscription settles does not read as a dropped
 * connection.
 *
 * @param connected Whether the session's event stream is currently connected.
 */
export function ReconnectingBanner({ connected }: ReconnectingBannerProps) {
  const [hasConnected, setHasConnected] = useState(false)

  useEffect(() => {
    if (connected) setHasConnected(true)
  }, [connected])

  if (connected || !hasConnected) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full border-b border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning"
    >
      Reconnecting… live updates paused
    </div>
  )
}
