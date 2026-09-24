import { EventSource } from 'eventsource'
import { logger } from '../utils/logger'
import { DEFAULTS } from '@opencode-manager/shared/config'
import type { SSEEventEnvelope } from '@opencode-manager/shared'
import type { OpenCodeApi, V2Event } from '@opencode-manager/shared/opencode'
import { getOpenCodeBasicAuthHeader, type OpenCodePasswordResolver } from './opencode/auth'
import { getOpenCodeUpstreamBaseUrl } from './opencode/upstream'
import { encodeSSEFrame } from '../utils/sse-frame'

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

export type SSEEvent = V2Event

export interface PendingActionsFetcher {
  api: OpenCodeApi
}

export interface ScheduledSessionRef {
  sessionID: string
  directory: string
}

type ReplayEventType = 'permission.asked' | 'form.created' | 'session.status'

const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } = DEFAULTS.SSE

class SSEAggregator {
  private static instance: SSEAggregator
  private clients: Map<string, SSEClient> = new Map()
  private directoryClients: Map<string, Set<string>> = new Map()
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
  private scheduledSessionsResolver: (() => ScheduledSessionRef[]) | null = null
  private replayEventCount = 0

  private constructor() {}

  setPendingActionsFetcher(fetcher: PendingActionsFetcher | null): void {
    this.pendingActionsFetcher = fetcher
  }

  setPasswordResolver(resolver: OpenCodePasswordResolver | null): void {
    this.passwordResolver = resolver
  }

  setScheduledSessionsResolver(resolver: () => ScheduledSessionRef[]): void {
    this.scheduledSessionsResolver = resolver
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
    const existing = this.clients.get(id)
    if (existing) {
      existing.directories.forEach(dir => this.deindexClientDirectory(id, dir))
    }

    const client: SSEClient = {
      id,
      callback,
      writeFrame,
      directories: new Set(directories),
      visible: false,
      activeSessionId: null
    }
    this.clients.set(id, client)
    directories.forEach(dir => this.indexClientDirectory(id, dir))

    logger.info(`Client ${id} connected with directories: ${directories.length > 0 ? directories.join(', ') : '(none)'}`)

    if (directories.length > 0) {
      void this.replayPendingActionsForClient(id, directories)
    }

    return () => this.removeClient(id)
  }

  removeClient(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      client.directories.forEach(dir => this.deindexClientDirectory(id, dir))
    }
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
    newDirectories.forEach(dir => this.indexClientDirectory(clientId, dir))
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
    directories.forEach(dir => {
      client.directories.delete(dir)
      this.deindexClientDirectory(clientId, dir)
    })
    logger.info(`Client ${clientId} unsubscribed from: ${directories.join(', ')}`)
    return true
  }

  private indexClientDirectory(clientId: string, directory: string): void {
    let set = this.directoryClients.get(directory)
    if (!set) {
      set = new Set()
      this.directoryClients.set(directory, set)
    }
    set.add(clientId)
  }

  private deindexClientDirectory(clientId: string, directory: string): void {
    const set = this.directoryClients.get(directory)
    if (!set) return
    set.delete(clientId)
    if (set.size === 0) this.directoryClients.delete(directory)
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
    const [permissionsResult, formsResult] = await Promise.allSettled([
      fetcher.api.permission.request.list({ location: { directory } }),
      fetcher.api.form.list({ location: { directory } }),
    ])

    if (permissionsResult.status === 'rejected') {
      logger.warn(`replay: failed to fetch pending permissions for ${directory}: ${String(permissionsResult.reason)}`)
    } else {
      this.emitReplayEventsToClient(clientId, directory, permissionsResult.value.data.map(request =>
        this.buildReplayEvent('permission.asked', directory, request)
      ))
    }

    if (formsResult.status === 'rejected') {
      logger.warn(`replay: failed to fetch pending forms for ${directory}: ${String(formsResult.reason)}`)
    } else {
      this.emitReplayEventsToClient(clientId, directory, formsResult.value.data.map(form =>
        this.buildReplayEvent('form.created', directory, { form })
      ))
    }
  }

  private emitReplayEventsToClient(clientId: string, directory: string, events: V2Event[]): void {
    if (events.length === 0) return

    const client = this.clients.get(clientId)
    if (!client || !client.directories.has(directory)) return

    for (const event of events) {
      const envelope: SSEEventEnvelope = { directory, payload: event }
      try {
        client.callback('message', JSON.stringify(envelope))
      } catch (error) {
        logger.error(`replay: failed to deliver ${event.type} to client ${clientId}:`, error)
        return
      }
    }

    logger.info(`replay: sent ${events.length} pending action(s) for ${directory} to client ${clientId}`)
  }

  private async replaySessionStatusesForTrackedDirectories(): Promise<void> {
    const fetcher = this.pendingActionsFetcher
    if (!fetcher) return

    let running: Record<string, { type: string }>
    try {
      running = await fetcher.api.session.active()
    } catch (error) {
      logger.warn(`replay: failed to fetch active sessions: ${String(error)}`)
      return
    }

    const tracked = this.getTrackedSessions()
    const runningIDs = Object.keys(running ?? {})
    const runningSet = new Set(runningIDs)

    let replayed = 0

    for (const [sessionID, directory] of tracked) {
      if (runningSet.has(sessionID)) continue
      this.deliverEvent(directory, this.buildReplayEvent('session.status', directory, { sessionID, status: { type: 'idle' } }))
      replayed++
    }

    for (const sessionID of runningIDs) {
      const directory = tracked.get(sessionID) ?? await this.resolveSessionDirectory(fetcher, sessionID)
      if (!directory) continue
      this.deliverEvent(directory, this.buildReplayEvent('session.status', directory, { sessionID, status: { type: 'busy' } }))
      replayed++
    }

    if (replayed > 0) {
      logger.info(`replay: re-emitted ${replayed} session status(es) after upstream reconnect`)
    }
  }

  private getTrackedSessions(): Map<string, string> {
    const tracked = new Map<string, string>()
    this.activeSessions.forEach((sessionIDs, directory) => {
      sessionIDs.forEach(sessionID => tracked.set(sessionID, directory))
    })
    for (const ref of this.getScheduledSessions()) {
      tracked.set(ref.sessionID, ref.directory)
    }
    return tracked
  }

  private async resolveSessionDirectory(fetcher: PendingActionsFetcher, sessionID: string): Promise<string | null> {
    try {
      const session = await fetcher.api.session.get({ sessionID })
      return session.location.directory
    } catch (error) {
      logger.warn(`replay: failed to resolve directory for session ${sessionID}: ${String(error)}`)
      return null
    }
  }

  private buildReplayEvent(type: ReplayEventType, directory: string, data: unknown): V2Event {
    this.replayEventCount += 1
    return {
      id: `ocm_replay_${this.replayEventCount}`,
      created: Date.now(),
      type,
      location: { directory },
      data,
    } as V2Event
  }

  private async connectUpstream(): Promise<void> {
    if (!this.started) return
    if (this.upstream) {
      this.upstream.close()
      this.upstream = null
    }

    const url = `${getOpenCodeUpstreamBaseUrl()}/api/event`
    const wasConnectedBefore = this.everConnected
    logger.info(`SSE connecting to OpenCode global stream: ${url}`)

    const authHeader = this.passwordResolver
      ? await getOpenCodeBasicAuthHeader(this.passwordResolver)
      : null

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
      this.handleUpstreamOpen(wasConnectedBefore)
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

  private handleUpstreamOpen(wasConnectedBefore: boolean): void {
    logger.info('SSE global stream connected')
    this.upstreamConnected = true
    this.reconnectDelay = RECONNECT_DELAY_MS
    this.everConnected = true
    this.broadcastResync()
    if (wasConnectedBefore) {
      void this.replayPendingActionsForAllClients()
      void this.replaySessionStatusesForTrackedDirectories()
    }
  }

  private broadcastResync(): void {
    this.broadcastToAll('resync', JSON.stringify({ timestamp: Date.now() }))
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
    let event: V2Event
    try {
      event = JSON.parse(data) as V2Event
    } catch {
      return
    }

    const directory = event?.location?.directory
    if (!event?.type || !directory) return

    try {
      this.deliverEvent(directory, event)
    } catch (error) {
      logger.error(`SSE failed to handle ${event.type} event:`, error)
    }
  }

  private deliverEvent(directory: string, event: SSEEvent): void {
    this.handleEvent(directory, event)

    this.eventListeners.forEach(listener => {
      try { listener(directory, event) } catch { /* ignore listener errors */ }
    })

    const subscriberIds = this.directoryClients.get(directory)
    if (!subscriberIds || subscriberIds.size === 0) return

    const envelope: SSEEventEnvelope = { directory, payload: event }
    const frame = encodeSSEFrame('message', JSON.stringify(envelope))
    for (const clientId of subscriberIds) {
      const client = this.clients.get(clientId)
      if (!client) continue
      try {
        client.writeFrame(frame)
      } catch (error) {
        logger.error(`Failed to send to client ${client.id}:`, error)
      }
    }
  }

  private handleEvent(directory: string, event: SSEEvent): void {
    switch (event.type) {
      case 'session.status': {
        const { sessionID, status } = event.data
        if (status.type === 'idle') {
          this.markSessionIdle(directory, sessionID)
        } else {
          this.markSessionActive(directory, sessionID)
        }
        return
      }
      case 'session.idle': {
        this.markSessionIdle(directory, event.data.sessionID)
        return
      }
      case 'session.execution.started': {
        this.markSessionActive(directory, event.data.sessionID)
        return
      }
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        this.markSessionIdle(directory, event.data.sessionID)
        return
      }
      case 'session.created': {
        const { sessionID, parentID } = event.data
        if (parentID) {
          this.markSubagentSession(directory, sessionID)
        }
        return
      }
      case 'session.deleted': {
        this.unmarkSubagentSession(directory, event.data.sessionID)
        return
      }
    }
  }

  private markSubagentSession(directory: string, sessionID: string): void {
    let sessions = this.subagentSessions.get(directory)
    if (!sessions) {
      sessions = new Set()
      this.subagentSessions.set(directory, sessions)
    }
    sessions.add(sessionID)
  }

  private unmarkSubagentSession(directory: string, sessionID: string): void {
    const sessions = this.subagentSessions.get(directory)
    if (!sessions) return
    sessions.delete(sessionID)
    if (sessions.size === 0) {
      this.subagentSessions.delete(directory)
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

  getScheduledSessionIds(): Set<string> {
    return new Set(this.getScheduledSessions().map(ref => ref.sessionID))
  }

  private getScheduledSessions(): ScheduledSessionRef[] {
    return this.scheduledSessionsResolver?.() ?? []
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
    this.directoryClients.clear()
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
