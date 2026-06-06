import { EventSource } from 'eventsource'
import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { DEFAULTS } from '@opencode-manager/shared/config'
import { getOpenCodeBasicAuthHeader, type OpenCodePasswordResolver } from './opencode/auth'
import { encodeSSEFrame } from '../routes/sse-writer'

type SSEClientCallback = (event: string, data: string) => void
type SSEClientFrameWriter = (frame: Uint8Array) => void
type SSEEventListener = (directory: string, event: SSEEvent) => void

interface SSEClient {
  id: string
  callback: SSEClientCallback
  writeFrame: SSEClientFrameWriter
  directories: Set<string>
  visible: boolean
  activeSessionId: string | null
}

export interface SSEEvent {
  type: string
  properties: Record<string, unknown>
}

interface GlobalEventEnvelope {
  directory?: string
  project?: string
  workspace?: string
  payload: SSEEvent
}

export interface PendingActionsFetcher {
  getJson<T>(path: string, opts?: { directory?: string; signal?: AbortSignal }): Promise<T>
}

interface PendingPermission {
  id: string
  sessionID: string
  [key: string]: unknown
}

interface PendingQuestion {
  id: string
  sessionID: string
  [key: string]: unknown
}

const OPENCODE_PORT = ENV.OPENCODE.PORT
const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } = DEFAULTS.SSE

class SSEAggregator {
  private static instance: SSEAggregator
  private clients: Map<string, SSEClient> = new Map()
  private activeSessions: Map<string, Set<string>> = new Map()
  private eventListeners: Set<SSEEventListener> = new Set()
  private subagentSessions: Map<string, Set<string>> = new Map()
  private upstream: EventSource | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay: number = RECONNECT_DELAY_MS
  private upstreamConnected = false
  private everConnected = false
  private started = false
  private pendingActionsFetcher: PendingActionsFetcher | null = null
  private passwordResolver: OpenCodePasswordResolver | null = null

  private constructor() {}

  setPendingActionsFetcher(fetcher: PendingActionsFetcher | null): void {
    this.pendingActionsFetcher = fetcher
  }

  setPasswordResolver(resolver: OpenCodePasswordResolver | null): void {
    this.passwordResolver = resolver
  }

  reconnect(): void {
    if (!this.started) return
    logger.info('SSE forcing upstream reconnect (auth changed)')
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.reconnectDelay = RECONNECT_DELAY_MS
    void this.connectUpstream()
  }

  static getInstance(): SSEAggregator {
    if (!SSEAggregator.instance) {
      SSEAggregator.instance = new SSEAggregator()
    }
    return SSEAggregator.instance
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.connectUpstream()
  }

  addClient(id: string, callback: SSEClientCallback, writeFrame: SSEClientFrameWriter, directories: string[]): () => void {
    const client: SSEClient = {
      id,
      callback,
      writeFrame,
      directories: new Set(directories),
      visible: false,
      activeSessionId: null
    }
    this.clients.set(id, client)

    logger.info(`Client ${id} connected with directories: ${directories.length > 0 ? directories.join(', ') : '(none)'}`)

    if (directories.length > 0) {
      void this.replayPendingActionsForClient(id, directories)
    }

    return () => this.removeClient(id)
  }

  removeClient(id: string): void {
    this.clients.delete(id)
  }

  addDirectories(clientId: string, directories: string[]): boolean {
    const client = this.clients.get(clientId)
    if (!client) {
      logger.warn(`addDirectories: client ${clientId} not found`)
      return false
    }
    const newDirectories: string[] = []
    directories.forEach(dir => {
      if (!client.directories.has(dir)) {
        newDirectories.push(dir)
      }
      client.directories.add(dir)
    })
    logger.info(`Client ${clientId} subscribed to: ${directories.join(', ')}`)

    if (newDirectories.length > 0) {
      void this.replayPendingActionsForClient(clientId, newDirectories)
    }

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
    return true
  }

  private async replayPendingActionsForClient(clientId: string, directories: string[]): Promise<void> {
    const fetcher = this.pendingActionsFetcher
    if (!fetcher) return

    await Promise.allSettled(directories.map(directory =>
      this.replayPendingActionsForDirectory(clientId, directory, fetcher)
    ))
  }

  private async replayPendingActionsForAllClients(): Promise<void> {
    const fetcher = this.pendingActionsFetcher
    if (!fetcher) return

    const tasks: Promise<void>[] = []
    this.clients.forEach((client) => {
      const directories = Array.from(client.directories)
      if (directories.length === 0) return
      tasks.push(this.replayPendingActionsForClient(client.id, directories))
    })

    if (tasks.length === 0) return
    logger.info(`replay: replaying pending actions to ${tasks.length} client(s) after upstream reconnect`)
    await Promise.allSettled(tasks)
  }

  private async replayPendingActionsForDirectory(
    clientId: string,
    directory: string,
    fetcher: PendingActionsFetcher,
  ): Promise<void> {
    const [permissionsResult, questionsResult] = await Promise.allSettled([
      fetcher.getJson<PendingPermission[]>('/permission', { directory }),
      fetcher.getJson<PendingQuestion[]>('/question', { directory }),
    ])

    if (permissionsResult.status === 'rejected') {
      logger.warn(`replay: failed to fetch pending permissions for ${directory}: ${String(permissionsResult.reason)}`)
    } else {
      this.emitPendingEventsToClient(clientId, directory, 'permission.asked', permissionsResult.value)
    }

    if (questionsResult.status === 'rejected') {
      logger.warn(`replay: failed to fetch pending questions for ${directory}: ${String(questionsResult.reason)}`)
    } else {
      this.emitPendingEventsToClient(clientId, directory, 'question.asked', questionsResult.value)
    }
  }

  private emitPendingEventsToClient(
    clientId: string,
    directory: string,
    type: 'permission.asked' | 'question.asked',
    items: Array<PendingPermission | PendingQuestion> | null,
  ): void {
    if (!items || items.length === 0) return

    const client = this.clients.get(clientId)
    if (!client || !client.directories.has(directory)) return

    for (const item of items) {
      const payload = JSON.stringify({ directory, payload: { type, properties: item } })
      try {
        client.callback('message', payload)
      } catch (error) {
        logger.error(`replay: failed to deliver ${type} to client ${clientId}:`, error)
        return
      }
    }

    logger.info(`replay: sent ${items.length} ${type} event(s) for ${directory} to client ${clientId}`)
  }

  private async connectUpstream(): Promise<void> {
    if (!this.started) return
    if (this.upstream) {
      this.upstream.close()
      this.upstream = null
    }

    const url = `http://127.0.0.1:${OPENCODE_PORT}/global/event`
    const wasConnectedBefore = this.everConnected
    logger.info(`SSE connecting to OpenCode global stream: ${url}`)

    const authHeader = this.passwordResolver
      ? await getOpenCodeBasicAuthHeader(this.passwordResolver)
      : getOpenCodeBasicAuthHeader()

    if (!this.started) return

    const init: ConstructorParameters<typeof EventSource>[1] = authHeader
      ? {
          fetch: (input, fetchInit) =>
            fetch(input, {
              ...fetchInit,
              headers: {
                ...(fetchInit?.headers ?? {}),
                Authorization: authHeader,
              },
            }),
        }
      : undefined

    const es = new EventSource(url, init)
    this.upstream = es

    es.onopen = () => {
      logger.info('SSE global stream connected')
      this.upstreamConnected = true
      this.reconnectDelay = RECONNECT_DELAY_MS
      this.everConnected = true
      if (wasConnectedBefore) {
        void this.replayPendingActionsForAllClients()
      }
    }

    es.onerror = (event) => {
      this.upstreamConnected = false
      if (es === this.upstream) {
        const code = (event as { code?: number }).code
        const message = (event as { message?: string }).message
        logger.warn(`SSE upstream error${code ? ` (code=${code})` : ''}${message ? `: ${message}` : ''}`)
        es.close()
        this.upstream = null
        this.scheduleReconnect()
      }
    }

    es.onmessage = (event) => {
      this.handleUpstreamMessage(event.data)
    }
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimeout) return
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      void this.connectUpstream()
    }, this.reconnectDelay)
  }

  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  private handleUpstreamMessage(data: string): void {
    let envelope: GlobalEventEnvelope
    try {
      envelope = JSON.parse(data) as GlobalEventEnvelope
    } catch {
      return
    }

    if (!envelope.directory || !envelope.payload?.type) return

    const directory = envelope.directory
    const parsed = envelope.payload

    this.handleEvent(directory, parsed)

    this.eventListeners.forEach(listener => {
      try { listener(directory, parsed) } catch { /* ignore listener errors */ }
    })

    let frame: Uint8Array | undefined
    const getFrame = (): Uint8Array => (frame ??= encodeSSEFrame('message', data))

    this.clients.forEach((client) => {
      if (client.directories.has(directory)) {
        try {
          client.writeFrame(getFrame())
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
    } else if (type === 'session.created' || type === 'session.updated') {
      const info = properties.info as { id?: string; parentID?: string } | undefined
      if (info?.id && info.parentID) {
        let sessions = this.subagentSessions.get(directory)
        if (!sessions) {
          sessions = new Set()
          this.subagentSessions.set(directory, sessions)
        }
        sessions.add(info.id)
      }
    } else if (type === 'session.deleted') {
      const info = properties.info as { id?: string } | undefined
      if (info?.id) {
        const sessions = this.subagentSessions.get(directory)
        if (sessions) {
          sessions.delete(info.id)
          if (sessions.size === 0) {
            this.subagentSessions.delete(directory)
          }
        }
      }
    }
  }

  private markSessionActive(directory: string, sessionID: string): void {
    let sessions = this.activeSessions.get(directory)
    if (!sessions) {
      sessions = new Set()
      this.activeSessions.set(directory, sessions)
    }
    sessions.add(sessionID)

    logger.info(`Session active: ${sessionID} in ${directory} (${sessions.size} active)`)
  }

  private markSessionIdle(directory: string, sessionID: string): void {
    const sessions = this.activeSessions.get(directory)
    if (sessions) {
      sessions.delete(sessionID)
      logger.info(`Session idle: ${sessionID} in ${directory} (${sessions.size} active)`)

      if (sessions.size === 0) {
        this.activeSessions.delete(directory)
      }
    }
  }

  getConnectionStatus(): { connected: number; total: number } {
    const total = this.started ? 1 : 0
    return { connected: this.upstreamConnected ? 1 : 0, total }
  }

  getClientCount(): number {
    return this.clients.size
  }

  setClientVisibility(id: string, visible: boolean, activeSessionId: string | null = null): boolean {
    const client = this.clients.get(id)
    if (!client) {
      logger.warn(`setClientVisibility: client ${id} not found`)
      return false
    }
    client.visible = visible
    client.activeSessionId = visible ? activeSessionId : null
    return true
  }

  isSessionBeingViewed(sessionId: string): boolean {
    for (const client of this.clients.values()) {
      if (client.visible && client.activeSessionId === sessionId) {
        return true
      }
    }
    return false
  }

  isSubagentSession(sessionId: string): boolean {
    for (const sessions of this.subagentSessions.values()) {
      if (sessions.has(sessionId)) {
        return true
      }
    }
    return false
  }

  getActiveDirectories(): string[] {
    return Array.from(this.activeSessions.keys())
  }

  getActiveSessions(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    this.activeSessions.forEach((sessions, dir) => {
      result[dir] = Array.from(sessions)
    })
    return result
  }

  shutdown(): void {
    this.started = false

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.upstream) {
      this.upstream.close()
      this.upstream = null
    }
    this.upstreamConnected = false

    this.activeSessions.clear()
    this.subagentSessions.clear()
    this.clients.clear()
    this.eventListeners.clear()
  }

  broadcastToAll(event: string, data: string): void {
    this.clients.forEach((client) => {
      try {
        client.callback(event, data)
      } catch { /* ignore broadcast errors */ }
    })
  }
}

export const sseAggregator = SSEAggregator.getInstance()

export function broadcastSSHHostKeyRequest(data: Record<string, unknown>): void {
  const event = JSON.stringify({
    payload: {
      type: 'ssh.host-key-request',
      properties: data,
    },
  })
  sseAggregator.broadcastToAll('message', event)
}
