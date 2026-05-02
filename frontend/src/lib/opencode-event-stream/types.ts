export type OpenCodeEventHandler = (data: unknown) => void
export type EventStreamStatusHandler = (connected: boolean) => void

export interface EventStreamHealthState {
  isConnected: boolean
  isHealthy: boolean
  lastEventAt: number | null
  isStalled: boolean
}

export interface EventStreamConnection {
  close(): void
}

export interface EventStreamTransportHandlers {
  onOpen(): void
  onError(): void
  onMessage(data: string): void
  onConnected(data: string): void
  onHeartbeat(): void
}

export interface EventStreamTransport {
  open(url: string, handlers: EventStreamTransportHandlers): EventStreamConnection
  post(path: string, body: unknown): Promise<boolean>
}

export interface EventStreamSubscription {
  dispose(): void
  reconnect(): void
  reportVisibility(visible: boolean, activeSessionId?: string): void
}

export interface GlobalMonitorSubscription extends EventStreamSubscription {
  updateDirectories(directories: string[]): void
}
