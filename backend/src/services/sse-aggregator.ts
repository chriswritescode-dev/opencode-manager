import { EventSource } from 'eventsource'
import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { DEFAULTS } from '@opencode-manager/shared/config'

type SSEClientCallback = (event: string, data: string) => void
type SSEEventListener = (directory: string, event: SSEEvent) => void

interface SSEClient {
  id: string
  callback: SSEClientCallback
  directories: Set<string>
  visible: boolean
}

interface DirectoryConnection {
  eventSource: EventSource | null
  reconnectTimeout: ReturnType<typeof setTimeout> | null
  reconnectDelay: number
  isConnected: boolean
}

export interface SSEEvent {
  type: string
  properties: Record<string, unknown>
}

const OPENCODE_PORT = ENV.OPENCODE.PORT
const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS, IDLE_GRACE_PERIOD_MS } = DEFAULTS.SSE

class SSEAggregator {
  private static instance: SSEAggregator
  private clients: Map<string, SSEClient> = new Map()
  private connections: Map<string, DirectoryConnection> = new Map()
  private activeSessions: Map<string, Set<string>> = new Map()
  private idleTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private sessionStateVersion: Map<string, number> = new Map()
  private eventListeners: Set<SSEEventListener> = new Set()

  private constructor() {}

  static getInstance(): SSEAggregator {
    if (!SSEAggregator.instance) {
      SSEAggregator.instance = new SSEAggregator()
    }
    return SSEAggregator.instance
  }

  addClient(id: string, callback: SSEClientCallback, directories: string[]): () => void {
    const client: SSEClient = {
      id,
      callback,
      directories: new Set(directories),
      visible: false
    }
    this.clients.set(id, client)
    
    logger.info(`Client ${id} connected with directories: ${directories.length > 0 ? directories.join(', ') : '(none)'}`)
    this.syncConnections()

    return () => this.removeClient(id)
  }

  removeClient(id: string): void {
    this.clients.delete(id)
    this.syncConnections()
  }

  addDirectories(clientId: string, directories: string[]): boolean {
    const client = this.clients.get(clientId)
    if (!client) {
      logger.warn(`addDirectories: client ${clientId} not found`)
      return false
    }
    directories.forEach(dir => client.directories.add(dir))
    logger.info(`Client ${clientId} subscribed to: ${directories.join(', ')}`)
    this.syncConnections()
    return true
  }

  removeDirectories(clientId: string, directories: string[]): boolean {
    const client = this.clients.get(clientId)
    if (!client) {
      logger.warn(`removeDirectories: client ${clientId} not found`)
      return false
    }
    directories.forEach(dir => client.directories.delete(dir))
    logger.info(`Client ${clientId} unsubscribed from: ${directories.join(', ')}`)
    this.syncConnections()
    return true
  }

  private getRequiredDirectories(): Set<string> {
    const dirs = new Set<string>()
    this.clients.forEach(client => {
      client.directories.forEach(dir => dirs.add(dir))
    })
    return dirs
  }

  private syncConnections(): void {
    const required = this.getRequiredDirectories()

    this.connections.forEach((_, dir) => {
      if (!required.has(dir)) {
        this.disconnectDirectory(dir)
      }
    })

    required.forEach(dir => {
      if (!this.connections.has(dir)) {
        this.connectDirectory(dir)
      }
    })
  }

  private connectDirectory(directory: string): void {
    if (this.connections.has(directory)) return

    const conn: DirectoryConnection = {
      eventSource: null,
      reconnectTimeout: null,
      reconnectDelay: RECONNECT_DELAY_MS,
      isConnected: false
    }
    this.connections.set(directory, conn)

    this.establishConnection(directory)
  }

  private establishConnection(directory: string): void {
    const conn = this.connections.get(directory)
    if (!conn) return

    if (conn.eventSource) {
      conn.eventSource.close()
      conn.eventSource = null
    }

    const url = new URL(`http://127.0.0.1:${OPENCODE_PORT}/event`)
    url.searchParams.set('directory', directory)
    
    logger.info(`SSE connecting to OpenCode: ${directory}`)

    const eventSource = new EventSource(url.toString())
    conn.eventSource = eventSource

    eventSource.onopen = () => {
      logger.info(`SSE connected: ${directory}`)
      conn.isConnected = true
      conn.reconnectDelay = RECONNECT_DELAY_MS
    }

    eventSource.onerror = () => {
      conn.isConnected = false

      if (conn.eventSource) {
        conn.eventSource.close()
        conn.eventSource = null
      }

      if (this.connections.has(directory)) {
        this.scheduleReconnect(directory)
      }
    }

    eventSource.onmessage = (event) => {
      this.broadcastToDirectory(directory, 'message', event.data)
    }
  }

  private disconnectDirectory(directory: string): void {
    const conn = this.connections.get(directory)
    if (!conn) return

    if (conn.reconnectTimeout) {
      clearTimeout(conn.reconnectTimeout)
    }

    if (conn.eventSource) {
      conn.eventSource.close()
    }

    this.connections.delete(directory)
    logger.info(`SSE disconnected: ${directory}`)
  }

  private scheduleReconnect(directory: string): void {
    const conn = this.connections.get(directory)
    if (!conn || conn.reconnectTimeout) return

    conn.reconnectTimeout = setTimeout(() => {
      conn.reconnectTimeout = null
      conn.reconnectDelay = Math.min(conn.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      this.establishConnection(directory)
    }, conn.reconnectDelay)
  }

  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  private broadcastToDirectory(directory: string, event: string, data: string): void {
    try {
      const parsed = JSON.parse(data) as SSEEvent
      this.handleEvent(directory, parsed)
      this.eventListeners.forEach(listener => {
        try { listener(directory, parsed) } catch { /* ignore listener errors */ }
      })
    } catch {
      // Ignore parse errors
    }

    this.clients.forEach((client) => {
      if (client.directories.has(directory)) {
        try {
          client.callback(event, data)
        } catch (error) {
          logger.error(`Failed to send to client ${client.id}:`, error)
        }
      }
    })
  }

  private handleEvent(directory: string, event: SSEEvent): void {
    const { type, properties } = event

    if (type === 'session.status') {
      const sessionID = properties.sessionID as string
      const status = properties.status as { type: string }
      
      if (!sessionID || !status) return

      const isActive = status.type === 'busy' || status.type === 'retry' || status.type === 'compact'
      
      if (isActive) {
        this.markSessionActive(directory, sessionID)
      } else if (status.type === 'idle') {
        this.markSessionIdle(directory, sessionID)
      }
    } else if (type === 'session.idle') {
      const sessionID = properties.sessionID as string
      if (sessionID) {
        this.markSessionIdle(directory, sessionID)
      }
    }
  }

  private getStateVersion(directory: string): number {
    return this.sessionStateVersion.get(directory) ?? 0
  }

  private incrementStateVersion(directory: string): number {
    const newVersion = this.getStateVersion(directory) + 1
    this.sessionStateVersion.set(directory, newVersion)
    return newVersion
  }

  private markSessionActive(directory: string, sessionID: string): void {
    this.incrementStateVersion(directory)
    
    const existingTimeout = this.idleTimeouts.get(directory)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.idleTimeouts.delete(directory)
    }

    let sessions = this.activeSessions.get(directory)
    if (!sessions) {
      sessions = new Set()
      this.activeSessions.set(directory, sessions)
    }
    sessions.add(sessionID)
    
    logger.info(`Session active: ${sessionID} in ${directory} (${sessions.size} active)`)
  }

  private markSessionIdle(directory: string, sessionID: string): void {
    const existingTimeout = this.idleTimeouts.get(directory)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.idleTimeouts.delete(directory)
    }

    const sessions = this.activeSessions.get(directory)
    if (sessions) {
      sessions.delete(sessionID)
      logger.info(`Session idle: ${sessionID} in ${directory} (${sessions.size} active)`)
      
      if (sessions.size === 0) {
        this.activeSessions.delete(directory)
        this.scheduleIdleDisconnect(directory)
      }
    }
  }

  private hasActiveViewers(directory: string): boolean {
    for (const client of this.clients.values()) {
      if (client.directories.has(directory)) {
        return true
      }
    }
    return false
  }

  private scheduleIdleDisconnect(directory: string): void {
    if (this.hasActiveViewers(directory)) {
      logger.info(`Skipping idle disconnect for ${directory} - has active viewers`)
      return
    }

    const existingTimeout = this.idleTimeouts.get(directory)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const versionAtSchedule = this.getStateVersion(directory)
    logger.info(`Scheduling idle disconnect for ${directory} in ${IDLE_GRACE_PERIOD_MS}ms (version: ${versionAtSchedule})`)
    
    const timeout = setTimeout(() => {
      this.idleTimeouts.delete(directory)
      
      const currentVersion = this.getStateVersion(directory)
      if (currentVersion !== versionAtSchedule) {
        logger.info(`Cancelled idle disconnect for ${directory} - state changed (${versionAtSchedule} -> ${currentVersion})`)
        return
      }
      
      const sessions = this.activeSessions.get(directory)
      const hasViewers = this.hasActiveViewers(directory)
      
      if ((!sessions || sessions.size === 0) && !hasViewers) {
        logger.info(`Idle disconnect: ${directory}`)
        this.disconnectDirectory(directory)
      } else if (hasViewers) {
        logger.info(`Cancelled idle disconnect for ${directory} - has active viewers`)
      }
    }, IDLE_GRACE_PERIOD_MS)

    this.idleTimeouts.set(directory, timeout)
  }

  getConnectionStatus(): { connected: number; total: number } {
    let connected = 0
    this.connections.forEach(conn => {
      if (conn.isConnected) connected++
    })
    return { connected, total: this.connections.size }
  }

  getClientCount(): number {
    return this.clients.size
  }

  setClientVisibility(id: string, visible: boolean): boolean {
    const client = this.clients.get(id)
    if (!client) {
      logger.warn(`setClientVisibility: client ${id} not found`)
      return false
    }
    client.visible = visible
    return true
  }

  hasVisibleClients(): boolean {
    for (const client of this.clients.values()) {
      if (client.visible) return true
    }
    return false
  }

  getActiveDirectories(): string[] {
    return Array.from(this.connections.keys())
  }

  shutdown(): void {
    this.idleTimeouts.forEach((timeout) => {
      clearTimeout(timeout)
    })
    this.idleTimeouts.clear()
    this.activeSessions.clear()
    this.sessionStateVersion.clear()

    this.connections.forEach((conn, dir) => {
      if (conn.reconnectTimeout) {
        clearTimeout(conn.reconnectTimeout)
      }
      if (conn.eventSource) {
        conn.eventSource.close()
      }
      logger.info(`SSE closed: ${dir}`)
    })
    this.connections.clear()
    this.clients.clear()
    this.eventListeners.clear()
  }

  getActiveSessions(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    this.activeSessions.forEach((sessions, dir) => {
      result[dir] = Array.from(sessions)
    })
    return result
  }
}

export const sseAggregator = SSEAggregator.getInstance()
