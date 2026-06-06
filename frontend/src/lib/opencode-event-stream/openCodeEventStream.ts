import { DEFAULTS } from '@opencode-manager/shared/config'
import { createBrowserEventStreamTransport } from './browserTransport'
import type {
  EventStreamHealthState,
  EventStreamStatusHandler,
  EventStreamTransport,
  GlobalMonitorSubscription,
  OpenCodeEventHandler,
} from './types'

interface Subscriber {
  id: string
  onEvent: OpenCodeEventHandler
  onStatusChange?: EventStreamStatusHandler
  onHealthChange?: (state: EventStreamHealthState) => void
  directories: Set<string>
}

interface OpenCodeEventStreamOptions {
  transport?: EventStreamTransport
}

const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS, STALL_THRESHOLD_MS, WATCHDOG_TICK_MS } = DEFAULTS.SSE

export class OpenCodeEventStream {
  private connection: { close(): void } | null = null
  private readonly transport: EventStreamTransport
  private subscribers = new Map<string, Subscriber>()
  private directoryRefCounts = new Map<string, number>()
  private pendingDirectories = new Set<string>()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay: number = RECONNECT_DELAY_MS
  private connected = false
  private subscriberIdCounter = 0
  private clientId: string | null = null
  private lastEventAt: number | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private upstreamConnectedCount: number | null = null
  private upstreamTotalCount: number | null = null

  constructor(options: OpenCodeEventStreamOptions = {}) {
    this.transport = options.transport ?? createBrowserEventStreamTransport()
  }

  subscribeGlobalMonitor(input: {
    directories: string[]
    onEvent: OpenCodeEventHandler
    onStatusChange?: EventStreamStatusHandler
    onHealthChange?: (state: EventStreamHealthState) => void
  }): GlobalMonitorSubscription {
    const id = this.addSubscriber(input.onEvent, input.onStatusChange, input.onHealthChange, input.directories)

    return {
      updateDirectories: (directories) => this.updateSubscriberDirectories(id, directories),
      reconnect: () => this.reconnect(),
      reportVisibility: (visible, activeSessionId) => this.reportVisibility(visible, activeSessionId),
      dispose: () => this.removeSubscriber(id),
    }
  }

  getHealth(): EventStreamHealthState {
    return this.buildHealth()
  }

  private addSubscriber(
    onEvent: OpenCodeEventHandler,
    onStatusChange?: EventStreamStatusHandler,
    onHealthChange?: (state: EventStreamHealthState) => void,
    directories: string[] = [],
  ): string {
    const id = `sub_${++this.subscriberIdCounter}`

    const initialDirectories = new Set(directories.filter(Boolean))
    const newDirectories: string[] = []

    for (const directory of initialDirectories) {
      const currentCount = this.directoryRefCounts.get(directory) ?? 0
      this.directoryRefCounts.set(directory, currentCount + 1)
      if (currentCount === 0) {
        if (this.clientId && this.connected) {
          newDirectories.push(directory)
        } else {
          this.pendingDirectories.add(directory)
        }
      }
    }

    this.subscribers.set(id, {
      id,
      onEvent,
      onStatusChange,
      onHealthChange,
      directories: initialDirectories,
    })

    onStatusChange?.(this.connected)
    onHealthChange?.(this.buildHealth())

    if (this.subscribers.size === 1) {
      this.connect()
    } else if (newDirectories.length > 0) {
      void this.subscribeToRemoteDirectories(newDirectories)
    }

    return id
  }

  private removeSubscriber(id: string): void {
    const subscriber = this.subscribers.get(id)
    if (!subscriber) return

    this.updateSubscriberDirectories(id, [])
    this.subscribers.delete(id)

    if (this.subscribers.size === 0) {
      this.disconnect()
    }
  }

  private updateSubscriberDirectories(id: string, directories: string[]): void {
    const subscriber = this.subscribers.get(id)
    if (!subscriber) return

    const nextDirectories = new Set(directories.filter(Boolean))

    for (const directory of subscriber.directories) {
      if (!nextDirectories.has(directory)) {
        this.removeDirectory(directory)
      }
    }

    for (const directory of nextDirectories) {
      if (!subscriber.directories.has(directory)) {
        this.addDirectory(directory)
      }
    }

    subscriber.directories = nextDirectories
  }

  private addDirectory(directory: string): void {
    const currentCount = this.directoryRefCounts.get(directory) ?? 0
    this.directoryRefCounts.set(directory, currentCount + 1)

    if (currentCount > 0) return

    if (this.clientId && this.connected) {
      void this.subscribeToRemoteDirectories([directory])
      return
    }

    this.pendingDirectories.add(directory)
    if (!this.connection) {
      this.reconnect()
    }
  }

  private removeDirectory(directory: string): void {
    const currentCount = this.directoryRefCounts.get(directory) ?? 0

    if (currentCount > 1) {
      this.directoryRefCounts.set(directory, currentCount - 1)
      return
    }

    this.directoryRefCounts.delete(directory)
    this.pendingDirectories.delete(directory)

    if (this.clientId && this.connected) {
      void this.transport.post('/api/sse/unsubscribe', {
        clientId: this.clientId,
        directories: [directory],
      })
    }
  }

  private buildUrl(): string {
    const url = new URL('/api/sse/stream', window.location.origin)
    const directories = Array.from(this.directoryRefCounts.keys())
    if (directories.length > 0) {
      url.searchParams.set('directories', directories.join(','))
    }
    return url.toString()
  }

  private connect(): void {
    if (this.connection) return

    this.connection = this.transport.open(this.buildUrl(), {
      onOpen: () => this.handleOpen(),
      onError: () => this.handleError(),
      onMessage: (data) => this.handleMessage(data),
      onConnected: (data) => this.handleConnected(data),
      onHeartbeat: () => this.markActivity(),
    })
  }

  private handleOpen(): void {
    this.connected = true
    this.reconnectDelay = RECONNECT_DELAY_MS
    this.startWatchdog()
    this.markActivity()
    this.notifyStatusChange(true)
  }

  private handleError(): void {
    this.connected = false
    this.clientId = null
    this.upstreamConnectedCount = null
    this.upstreamTotalCount = null
    this.stopWatchdog()
    this.lastEventAt = null

    if (this.connection) {
      this.connection.close()
      this.connection = null
    }

    this.notifyStatusChange(false)
    this.notifyHealth()

    if (this.subscribers.size > 0) {
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: string): void {
    try {
      this.markActivity()
      this.broadcast(flattenEventEnvelope(JSON.parse(data)))
    } catch {
      this.markActivity()
    }
  }

  private handleConnected(data: string): void {
    try {
      const parsed = JSON.parse(data) as { clientId?: unknown; connected?: unknown; total?: unknown }
      if (typeof parsed.clientId === 'string') {
        this.clientId = parsed.clientId
      }
      if (typeof parsed.connected === 'number') {
        this.upstreamConnectedCount = parsed.connected
      }
      if (typeof parsed.total === 'number') {
        this.upstreamTotalCount = parsed.total
      }
    } catch {
      this.clientId = null
    }

    this.connected = true
    this.startWatchdog()
    this.markActivity()
    this.notifyStatusChange(true)
    this.flushPendingDirectories()
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.stopWatchdog()
    this.connection?.close()
    this.connection = null
    this.connected = false
    this.clientId = null
    this.upstreamConnectedCount = null
    this.upstreamTotalCount = null
    this.lastEventAt = null
    this.pendingDirectories.clear()
    this.notifyHealth()
  }

  private reconnect(): void {
    if (this.subscribers.size === 0) return

    this.reconnectDelay = RECONNECT_DELAY_MS
    this.disconnectConnectionOnly()
    this.connect()
  }

  private disconnectConnectionOnly(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.stopWatchdog()
    this.connection?.close()
    this.connection = null
    this.connected = false
    this.clientId = null
    this.upstreamConnectedCount = null
    this.upstreamTotalCount = null
    this.lastEventAt = null
    this.pendingDirectories = new Set(this.directoryRefCounts.keys())
    this.notifyStatusChange(false)
    this.notifyHealth()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      this.connect()
    }, this.reconnectDelay)
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return

    this.watchdogTimer = setInterval(() => {
      if (this.lastEventAt == null) return
      if (Date.now() - this.lastEventAt > STALL_THRESHOLD_MS) {
        this.handleStall()
      }
    }, WATCHDOG_TICK_MS)
  }

  private stopWatchdog(): void {
    if (!this.watchdogTimer) return
    clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
  }

  private handleStall(): void {
    this.disconnectConnectionOnly()
    this.connect()
  }

  private markActivity(): void {
    this.lastEventAt = Date.now()
    this.notifyHealth()
  }

  private buildHealth(): EventStreamHealthState {
    const isStalled = this.connected && this.lastEventAt != null && Date.now() - this.lastEventAt > STALL_THRESHOLD_MS
    const upstreamDisconnected = this.upstreamTotalCount != null && this.upstreamTotalCount > 0 && this.upstreamConnectedCount === 0
    return {
      isConnected: this.connected,
      isHealthy: this.connected && this.lastEventAt != null && !isStalled && !upstreamDisconnected,
      lastEventAt: this.lastEventAt,
      isStalled,
    }
  }

  private notifyHealth(): void {
    const health = this.buildHealth()
    this.subscribers.forEach((subscriber) => {
      try {
        subscriber.onHealthChange?.(health)
      } catch {
        void 0
      }
    })
  }

  private notifyStatusChange(connected: boolean): void {
    this.subscribers.forEach((subscriber) => {
      try {
        subscriber.onStatusChange?.(connected)
      } catch {
        void 0
      }
    })
  }

  private broadcast(data: unknown): void {
    this.subscribers.forEach((subscriber) => {
      try {
        subscriber.onEvent(data)
      } catch {
        void 0
      }
    })
  }

  private async subscribeToRemoteDirectories(directories: string[]): Promise<void> {
    if (!this.clientId || directories.length === 0) return

    const success = await this.transport.post('/api/sse/subscribe', {
      clientId: this.clientId,
      directories,
    })

    if (!success) {
      directories.forEach((directory) => this.pendingDirectories.add(directory))
      this.reconnect()
    }
  }

  private flushPendingDirectories(): void {
    if (this.pendingDirectories.size === 0) return
    if (!this.clientId || !this.connected) return

    const directories = Array.from(this.pendingDirectories)
    this.pendingDirectories.clear()
    void this.subscribeToRemoteDirectories(directories)
  }

  private reportVisibility(visible: boolean, activeSessionId?: string): void {
    if (!this.clientId || !this.connected) return

    void this.transport.post('/api/sse/visibility', {
      clientId: this.clientId,
      visible,
      activeSessionId: activeSessionId ?? null,
    })
  }
}

function flattenEventEnvelope(parsed: unknown): unknown {
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'payload' in parsed &&
    (parsed as { payload: unknown }).payload !== null &&
    typeof (parsed as { payload: unknown }).payload === 'object'
  ) {
    const { payload, directory } = parsed as { payload: object; directory?: unknown }
    return { ...payload, directory }
  }
  return parsed
}

export const openCodeEventStream = new OpenCodeEventStream()
