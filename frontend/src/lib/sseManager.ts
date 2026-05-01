import { DEFAULTS } from '@opencode-manager/shared/config'

type SSEEventHandler = (data: unknown) => void
type SSEStatusHandler = (connected: boolean) => void

interface SSESubscriber {
  id: string
  onMessage: SSEEventHandler
  onStatusChange?: SSEStatusHandler
}

export interface SSEHealthState {
  isConnected: boolean
  isHealthy: boolean
  lastEventAt: number | null
  isStalled: boolean
}

const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS, STALL_THRESHOLD_MS, WATCHDOG_TICK_MS } = DEFAULTS.SSE

class SSEManager {
  private static instance: SSEManager
  private eventSource: EventSource | null = null
  private subscribers: Map<string, SSESubscriber> = new Map()
  private directoryRefCounts: Map<string, number> = new Map()
  private pendingDirectories: Set<string> = new Set()
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay: number = RECONNECT_DELAY_MS
  private isConnected = false
  private subscriberIdCounter = 0
  private clientId: string | null = null
  private lastEventAt: number | null = null
  private healthListeners: Set<(state: SSEHealthState) => void> = new Set()
  private watchdogTimer: ReturnType<typeof setInterval> | null = null

  private constructor() {}

  static getInstance(): SSEManager {
    if (!SSEManager.instance) {
      SSEManager.instance = new SSEManager()
    }
    return SSEManager.instance
  }

  private markActivity() {
    this.lastEventAt = Date.now()
    this.notifyHealth()
  }

  private startWatchdog() {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      if (this.lastEventAt == null) return
      if (Date.now() - this.lastEventAt > STALL_THRESHOLD_MS) {
        this.handleStall()
      }
    }, WATCHDOG_TICK_MS)
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private handleStall() {
    this.eventSource?.close()
    this.eventSource = null
    this.lastEventAt = null
    this.notifyHealth()
    this.connect()
  }

  private notifyHealth() {
    const state: SSEHealthState = {
      isConnected: this.isConnected,
      isHealthy: this.isConnected && this.lastEventAt != null && Date.now() - this.lastEventAt <= STALL_THRESHOLD_MS,
      lastEventAt: this.lastEventAt,
      isStalled: this.isConnected && this.lastEventAt != null && Date.now() - this.lastEventAt > STALL_THRESHOLD_MS,
    }
    this.healthListeners.forEach(listener => {
      try {
        listener(state)
      } catch {
        // Ignore listener errors
      }
    })
  }

  subscribeHealth(listener: (state: SSEHealthState) => void): () => void {
    this.healthListeners.add(listener)
    listener(this.getHealth())
    return () => {
      this.healthListeners.delete(listener)
    }
  }

  getHealth(): SSEHealthState {
    return {
      isConnected: this.isConnected,
      isHealthy: this.isConnected && this.lastEventAt != null && Date.now() - this.lastEventAt <= STALL_THRESHOLD_MS,
      lastEventAt: this.lastEventAt,
      isStalled: this.isConnected && this.lastEventAt != null && Date.now() - this.lastEventAt > STALL_THRESHOLD_MS,
    }
  }

  subscribe(
    onMessage: SSEEventHandler,
    onStatusChange?: SSEStatusHandler
  ): () => void {
    const id = `sub_${++this.subscriberIdCounter}`
    const subscriber: SSESubscriber = {
      id,
      onMessage,
      onStatusChange
    }

    this.subscribers.set(id, subscriber)

    if (onStatusChange) {
      onStatusChange(this.isConnected)
    }

    if (this.subscribers.size === 1) {
      this.connect()
    }

    return () => this.unsubscribe(id)
  }

  private unsubscribe(id: string): void {
    this.subscribers.delete(id)

    if (this.subscribers.size === 0) {
      this.disconnect()
    }
  }

  addDirectory(directory: string): () => void {
    const currentCount = this.directoryRefCounts.get(directory) ?? 0
    this.directoryRefCounts.set(directory, currentCount + 1)
    
    if (currentCount === 0) {
      if (this.clientId && this.isConnected) {
        this.subscribeToDirectory(directory)
      } else {
        this.pendingDirectories.add(directory)
        if (!this.eventSource) {
          this.reconnect()
        }
      }
    }

    return () => this.cleanupDirectory(directory)
  }

  private cleanupDirectory(directory: string): void {
    const currentCount = this.directoryRefCounts.get(directory) ?? 0
    if (currentCount <= 1) {
      this.directoryRefCounts.delete(directory)
      this.pendingDirectories.delete(directory)
      
      if (this.clientId && this.isConnected) {
        fetch('/api/sse/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: this.clientId, directories: [directory] })
        }).catch(() => {})
      }
    } else {
      this.directoryRefCounts.set(directory, currentCount - 1)
    }
  }

  private subscribeToDirectory(directory: string): void {
    fetch('/api/sse/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, directories: [directory] })
    }).then(res => {
      if (!res.ok) {
        this.reconnect()
      }
    }).catch(() => {
      this.reconnect()
    })
  }

  private flushPendingDirectories(): void {
    if (this.pendingDirectories.size === 0) return
    if (!this.clientId || !this.isConnected) return

    const dirs = Array.from(this.pendingDirectories)
    this.pendingDirectories.clear()

    fetch('/api/sse/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, directories: dirs })
    }).then(res => {
      if (!res.ok) {
        dirs.forEach(d => this.pendingDirectories.add(d))
        this.reconnect()
      }
    }).catch(() => {
      dirs.forEach(d => this.pendingDirectories.add(d))
      this.reconnect()
    })
  }

  removeDirectory(directory: string): void {
    this.cleanupDirectory(directory)
  }

  getDirectories(): string[] {
    return Array.from(this.directoryRefCounts.keys())
  }

  private buildUrl(): string {
    const url = new URL('/api/sse/stream', window.location.origin)
    if (this.directoryRefCounts.size > 0) {
      url.searchParams.set('directories', Array.from(this.directoryRefCounts.keys()).join(','))
    }
    return url.toString()
  }

  private connect(): void {
    if (this.eventSource) return

    const url = this.buildUrl()
    this.eventSource = new EventSource(url, { withCredentials: true })

    this.eventSource.onopen = () => {
      this.isConnected = true
      this.reconnectDelay = RECONNECT_DELAY_MS
      this.startWatchdog()
      this.markActivity()
      this.notifyStatusChange(true)
      this.notifyHealth()
    }

    this.eventSource.onerror = () => {
      this.isConnected = false
      this.clientId = null
      this.stopWatchdog()
      this.lastEventAt = null
      this.notifyStatusChange(false)
      this.notifyHealth()

      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
      }

      if (this.subscribers.size > 0) {
        this.scheduleReconnect()
      }
    }

    this.eventSource.onerror = () => {
      this.isConnected = false
      this.clientId = null
      this.stopWatchdog()
      this.lastEventAt = null
      this.notifyStatusChange(false)
      this.notifyHealth()

      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
      }

      if (this.subscribers.size > 0) {
        this.scheduleReconnect()
      }
    }

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.markActivity()
        this.broadcast(data)
      } catch {
        // Ignore parse errors
      }
    }

    this.eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        if (data.clientId) {
          this.clientId = data.clientId
        }
        this.isConnected = true
        this.startWatchdog()
        this.markActivity()
        this.notifyStatusChange(true)
        this.notifyHealth()
        this.flushPendingDirectories()
      } catch {
        // Ignore
      }
    })

    this.eventSource.addEventListener('heartbeat', () => {
      this.markActivity()
    })
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.stopWatchdog()

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.isConnected = false
    this.clientId = null
    this.lastEventAt = null
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

  private notifyStatusChange(connected: boolean): void {
    this.subscribers.forEach(sub => {
      if (sub.onStatusChange) {
        try {
          sub.onStatusChange(connected)
        } catch {
          // Ignore callback errors
        }
      }
    })
  }

  private broadcast(data: unknown): void {
    this.subscribers.forEach(sub => {
      try {
        sub.onMessage(data)
      } catch {
        // Ignore callback errors
      }
    })
  }

  reconnect(): void {
    if (this.subscribers.size === 0) return
    
    this.reconnectDelay = RECONNECT_DELAY_MS
    this.disconnect()
    this.connect()
  }

  getConnectionStatus(): boolean {
    return this.isConnected
  }

  reportVisibility(visible: boolean, activeSessionId?: string): void {
    if (!this.clientId || !this.isConnected) return
    fetch('/api/sse/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, visible, activeSessionId: activeSessionId ?? null })
    }).catch(() => {})
  }

  async ensureConnected(timeoutMs: number = 5000): Promise<boolean> {
    if (this.isConnected && this.clientId) {
      return true
    }

    if (this.subscribers.size === 0) {
      return false
    }

    this.reconnectDelay = RECONNECT_DELAY_MS
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false)
      }, timeoutMs)

      const checkConnection = () => {
        if (this.isConnected && this.clientId) {
          clearTimeout(timeout)
          resolve(true)
        }
      }

      const originalNotify = this.notifyStatusChange.bind(this)
      this.notifyStatusChange = (connected: boolean) => {
        originalNotify(connected)
        if (connected) {
          this.notifyStatusChange = originalNotify
          checkConnection()
        }
      }

      this.connect()
    })
  }
}

export const sseManager = SSEManager.getInstance()

export function subscribeToSSE(
  onMessage: SSEEventHandler,
  onStatusChange?: SSEStatusHandler
): () => void {
  return sseManager.subscribe(onMessage, onStatusChange)
}

export function addSSEDirectory(directory: string): () => void {
  return sseManager.addDirectory(directory)
}

export function removeSSEDirectory(directory: string): void {
  sseManager.removeDirectory(directory)
}

export function reconnectSSE(): void {
  sseManager.reconnect()
}

export function isSSEConnected(): boolean {
  return sseManager.getConnectionStatus()
}

export async function ensureSSEConnected(timeoutMs?: number): Promise<boolean> {
  return sseManager.ensureConnected(timeoutMs)
}
