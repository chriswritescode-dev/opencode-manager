const listeners = new Set<() => void>()

/** Notifies every current listener that the Manager could not be reached. */
export function reportConnectivityFailure(): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

/** Registers a listener and returns the function that unsubscribes it. */
export function subscribeConnectivityFailure(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Clears every listener so tests start from a clean signal. */
export function resetConnectivitySignalForTests(): void {
  listeners.clear()
}
