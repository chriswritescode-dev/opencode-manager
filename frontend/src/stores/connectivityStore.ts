import { create } from 'zustand'
import { subscribeConnectivityFailure } from '@/lib/connectivitySignal'
import { openCodeEventStream, type OpenCodeEventStream } from '@/lib/opencode-event-stream'

interface ConnectivityStore {
  interrupted: boolean
  markInterrupted: () => void
  clearInterrupted: () => void
}

export const useConnectivityStore = create<ConnectivityStore>((set) => ({
  interrupted: false,
  markInterrupted: () => set({ interrupted: true }),
  clearInterrupted: () => set({ interrupted: false }),
}))

/**
 * Connects Manager failure reports, stream status changes, and page visibility to the
 * connectivity store and stream reconnection. Returns a cleanup that removes every listener.
 */
export function installConnectivityMonitor(stream: OpenCodeEventStream = openCodeEventStream): () => void {
  const unsubscribeFailure = subscribeConnectivityFailure(() => {
    useConnectivityStore.getState().markInterrupted()
    stream.reconnectNow()
  })

  const unsubscribeStatus = stream.subscribeStatus((connected) => {
    if (connected) useConnectivityStore.getState().clearInterrupted()
  })

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      stream.reconnectNow()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    unsubscribeFailure()
    unsubscribeStatus()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
