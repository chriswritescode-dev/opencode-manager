import { openCodeEventStream } from '@/lib/opencode-event-stream'
import { useConnectivityStore } from '@/stores/connectivityStore'

export interface ConnectivityPillProps {
  serverOffline: boolean
}

const PILL_CLASSNAME =
  'flex min-h-11 items-center justify-center rounded-full border border-border bg-card px-3 text-xs text-foreground shadow'

/**
 * Floating transcript status pill: a tappable reconnect control after an action-triggered
 * connectivity failure, or a passive "Server offline" notice for an unreachable remote server.
 */
export function ConnectivityPill({ serverOffline }: ConnectivityPillProps) {
  const interrupted = useConnectivityStore((state) => state.interrupted)

  if (!serverOffline && !interrupted) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute left-1/2 top-2 -translate-x-1/2 z-30"
    >
      {serverOffline ? (
        <div className={PILL_CLASSNAME}>Server offline</div>
      ) : (
        <button
          type="button"
          onClick={() => openCodeEventStream.reconnectNow()}
          className={PILL_CLASSNAME}
        >
          Reconnecting…
        </button>
      )}
    </div>
  )
}
