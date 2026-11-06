import { logger } from '../utils/logger'
import { buildServerDirectoryKey, LOCAL_OPENCODE_SERVER_ID, parseServerDirectoryKey } from '@opencode-manager/shared/schemas'
import { type V2Event } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './opencode/client'
import { encodeSSEFrame } from '../utils/sse-frame'
import {
  buildSessionStatusReplayEvent,
  collectPendingReplayEvents,
  createReplayEventBuilder,
  planSessionStatusReplay,
  routeOpenCodeEvent,
  type ReplayEventBuilder,
} from './opencode-event-routing'
import { subscribeOpenCodeEvents, type OpenCodeEventSubscription } from './opencode-event-subscription'

type SSEClientCallback = (event: string, data: string) => void
type SSEClientFrameWriter = (frame: Uint8Array) => void
type SSEEventListener = (directory: string | null, event: SSEEvent) => void
type ServerEventListener = (serverId: string, directory: string | null, event: SSEEvent) => void
type ServerConnectedListener = (serverId: string) => void
type RemoteSubagentResolver = (serverId: string, sessionId: string) => boolean

export type RemoteReplayHandler = (clientId: string, serverId: string, directory: string) => void | Promise<void>

interface SSEClient {
  id: string
  callback: SSEClientCallback
  writeFrame: SSEClientFrameWriter
  directories: Set<string>
  visible: boolean
  activeSessionId: string | null
  activeServerId: string | null
}

export type SSEEvent = V2Event

export interface ScheduledSessionRef {
  sessionID: string
  directory: string
}

const LOCATION_CATALOG_EVENT_TYPES = new Set(['command.updated', 'agent.updated', 'skill.updated', 'model.updated', 'provider.updated', 'integration.updated'])

function serializeEnvelope(directory: string | null, payloadJson: string, serverId?: string): string {
  const serverField = serverId === undefined ? '' : ',"serverId":' + JSON.stringify(serverId)
  return '{"directory":' + JSON.stringify(directory) + serverField + ',"payload":' + payloadJson + '}'
}

class SSEAggregator {
  private static instance: SSEAggregator
  private clients: Map<string, SSEClient> = new Map()
  private directoryClients: Map<string, Set<string>> = new Map()
  private activeSessions: Map<string, Set<string>> = new Map()
  private sessionDirectories: Map<string, string> = new Map()
  private eventListeners: Set<SSEEventListener> = new Set()
  private serverEventListeners: Set<ServerEventListener> = new Set()
  private upstreamConnectedListeners: Set<() => void> = new Set()
  private serverConnectedListeners: Set<ServerConnectedListener> = new Set()
  private remoteSubagentResolver: RemoteSubagentResolver | null = null
  private subagentSessions: Map<string, Set<string>> = new Map()
  private subscription: OpenCodeEventSubscription | null = null
  private upstreamConnected = false
  private everConnected = false
  private started = false
  private openCodeClient: Pick<OpenCodeClient, 'api'> | null = null
  private scheduledSessionsResolver: (() => ScheduledSessionRef[]) | null = null
  private remoteReplayHandler: RemoteReplayHandler | null = null
  private isResyncGateOpen: () => boolean = () => true
  private resyncPending = false
  private readonly buildReplayEvent: ReplayEventBuilder = createReplayEventBuilder('ocm_replay_')

  private constructor() {}

  setOpenCodeClient(client: Pick<OpenCodeClient, 'api'> | null): void {
    this.openCodeClient = client
  }

  setScheduledSessionsResolver(resolver: () => ScheduledSessionRef[]): void {
    this.scheduledSessionsResolver = resolver
  }

  setRemoteReplayHandler(handler: RemoteReplayHandler | null): void {
    this.remoteReplayHandler = handler
  }

  /**
   * Holds the upstream `resync` while the gate is closed, so clients do not re-read OpenCode
   * state through the proxy before it accepts requests. Call {@link releasePendingResync} when
   * the gate opens.
   */
  setResyncGate(isOpen: () => boolean): void {
    this.isResyncGateOpen = isOpen
  }

  /** Broadcasts a `resync` held by the gate while the upstream stream is still connected. */
  releasePendingResync(): void {
    if (!this.resyncPending || !this.upstreamConnected) return
    this.resyncPending = false
    this.broadcastResync()
  }

  /**
   * Forces the upstream event subscription to reconnect, used after credentials change. No-op while the
   * aggregator is not started.
   */
  reconnect(): void {
    if (!this.started) return
    logger.info('SSE forcing upstream reconnect (auth changed)')
    this.subscription?.reconnect()
  }

  /**
   * Returns the process-wide aggregator, creating it on first call. All events and client registrations
   * flow through this single instance.
   */
  static getInstance(): SSEAggregator {
    if (!SSEAggregator.instance) {
      SSEAggregator.instance = new SSEAggregator()
    }
    return SSEAggregator.instance
  }

  /**
   * Subscribes to local OpenCode events once per process, wiring the open, event, and disconnect handlers.
   * Without a registered OpenCode client it logs a warning and stays stopped.
   */
  start(): void {
    if (this.started) return
    const client = this.openCodeClient
    if (!client) {
      logger.warn('SSE aggregator cannot start without an OpenCode client')
      return
    }
    this.started = true
    this.subscription = subscribeOpenCodeEvents({
      api: () => client.api,
      label: 'SSE aggregator',
      onOpen: () => {
        this.handleUpstreamOpen(this.everConnected)
      },
      onEvent: (event) => {
        this.handleUpstreamEvent(event)
      },
      onDisconnect: (error) => {
        this.upstreamConnected = false
        this.resyncPending = false
        logger.warn(`SSE upstream disconnected: ${String(error)}`)
      },
    })
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
      activeSessionId: null,
      activeServerId: null
    }
    this.clients.set(id, client)
    directories.forEach(dir => this.indexClientDirectory(id, dir))

    logger.info(`Client ${id} connected with directories: ${directories.length > 0 ? directories.join(', ') : '(none)'}`)

    if (directories.length > 0) {
      this.replayForDirectories(id, directories)
    }

    return () => this.removeClient(id)
  }

  removeClient(id: string): void {
    const client = this.clients.get(id)
    if (client) {
      for (const directory of Array.from(client.directories)) {
        client.directories.delete(directory)
        this.deindexClientDirectory(id, directory)
      }
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
      this.replayForDirectories(clientId, newDirectories)
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

  private replayForDirectories(clientId: string, directories: string[]): void {
    const localDirectories: string[] = []
    const remoteDirectories: Array<{ serverId: string; directory: string }> = []

    for (const directory of directories) {
      const parsed = parseServerDirectoryKey(directory)
      if (parsed.serverId === LOCAL_OPENCODE_SERVER_ID) {
        localDirectories.push(directory)
      } else {
        remoteDirectories.push(parsed)
      }
    }

    if (localDirectories.length > 0) {
      void this.replayPendingActionsForClient(clientId, localDirectories)
    }

    const handler = this.remoteReplayHandler
    if (!handler) return

    for (const { serverId, directory } of remoteDirectories) {
      void this.replayRemoteDirectory(clientId, serverId, directory, handler)
    }
  }

  /**
   * Runs the remote replay handler for one server directory, catching and logging failures so that a
   * directory that cannot replay does not reject the caller.
   */
  private async replayRemoteDirectory(
    clientId: string,
    serverId: string,
    directory: string,
    handler: RemoteReplayHandler,
  ): Promise<void> {
    try {
      await handler(clientId, serverId, directory)
    } catch (error) {
      logger.warn(`remote replay: failed for ${buildServerDirectoryKey(serverId, directory)}: ${String(error)}`)
    }
  }

  /**
   * Replays pending permission and form events for each of the client's directories, settling every
   * directory independently so one failed lookup does not block the rest.
   */
  private async replayPendingActionsForClient(clientId: string, directories: string[]): Promise<void> {
    const client = this.openCodeClient
    if (!client) return

    await Promise.allSettled(directories.map(directory =>
      this.replayPendingActionsForDirectory(clientId, directory, client)
    ))
  }

  private async replayPendingActionsForDirectory(
    clientId: string,
    directory: string,
    client: Pick<OpenCodeClient, 'api'>,
  ): Promise<void> {
    const events = await collectPendingReplayEvents({
      api: client.api,
      directory,
      buildEvent: this.buildReplayEvent,
      logScope: 'replay',
      logTarget: directory,
    })

    this.emitReplayEventsToClient(clientId, directory, events.permissions)
    this.emitReplayEventsToClient(clientId, directory, events.forms)
  }

  /**
   * Writes replayed events to a client only while it is still registered and subscribed to the directory;
   * delivery stops at the first write error, leaving the remaining events unsent.
   */
  private emitReplayEventsToClient(clientId: string, directory: string, events: V2Event[]): void {
    if (events.length === 0) return

    const client = this.clients.get(clientId)
    if (!client || !client.directories.has(directory)) return

    for (const event of events) {
      try {
        client.callback('message', serializeEnvelope(directory, JSON.stringify(event)))
      } catch (error) {
        logger.error(`replay: failed to deliver ${event.type} to client ${clientId}:`, error)
        return
      }
    }

    logger.info(`replay: sent ${events.length} pending action(s) for ${directory} to client ${clientId}`)
  }

  /**
   * Re-emits idle and busy status events for sessions the aggregator already tracks, so clients recover
   * transitions missed while disconnected. Busy sessions with an unknown directory are resolved through
   * the API and skipped when that lookup fails.
   */
  private async replaySessionStatusesForTrackedDirectories(): Promise<void> {
    const client = this.openCodeClient
    if (!client) return

    let running: Record<string, { type: string }>
    try {
      running = await client.api.session.active()
    } catch (error) {
      logger.warn(`replay: failed to fetch active sessions: ${String(error)}`)
      return
    }

    const tracked = this.getTrackedSessions()
    const plan = planSessionStatusReplay(running, tracked)

    let replayed = 0

    for (const { sessionID, directory } of plan.idle) {
      this.deliverEvent(directory, buildSessionStatusReplayEvent(this.buildReplayEvent, directory, sessionID, 'idle'))
      replayed++
    }

    const runningDirectories = await Promise.all(plan.busy.map(async (sessionID) => ({
      sessionID,
      directory: tracked.get(sessionID) ?? await this.resolveSessionDirectory(client, sessionID),
    })))

    for (const { sessionID, directory } of runningDirectories) {
      if (!directory) continue
      this.deliverEvent(directory, buildSessionStatusReplayEvent(this.buildReplayEvent, directory, sessionID, 'busy'))
      replayed++
    }

    if (replayed > 0) {
      logger.info(`replay: re-emitted ${replayed} session status(es) after upstream reconnect`)
    }
  }

  /**
   * Collects every session currently active or scheduled, keyed by session id, and records the owning
   * directory for each so a later replay can address it.
   */
  private getTrackedSessions(): Map<string, string> {
    const tracked = new Map<string, string>()
    this.activeSessions.forEach((sessionIDs, directory) => {
      sessionIDs.forEach(sessionID => tracked.set(sessionID, directory))
    })
    for (const ref of this.getScheduledSessions()) {
      tracked.set(ref.sessionID, ref.directory)
    }
    tracked.forEach((directory, sessionID) => this.sessionDirectories.set(sessionID, directory))
    return tracked
  }

  /**
   * Resolves a session's directory through the API and caches it for later event routing, returning
   * `null` and logging a warning when the lookup fails.
   */
  private async resolveSessionDirectory(client: Pick<OpenCodeClient, 'api'>, sessionID: string): Promise<string | null> {
    try {
      const session = await client.api.session.get({ sessionID })
      this.sessionDirectories.set(sessionID, session.location.directory)
      return session.location.directory
    } catch (error) {
      logger.warn(`replay: failed to resolve directory for session ${sessionID}: ${String(error)}`)
      return null
    }
  }

  /**
   * Handles a (re)connected upstream stream: broadcasts a resync, or defers it as pending while the resync
   * gate is closed, and replays tracked session statuses only on a reconnection rather than the first
   * connect.
   */
  private handleUpstreamOpen(wasConnectedBefore: boolean): void {
    logger.info('SSE global stream connected')
    this.upstreamConnected = true
    this.everConnected = true
    this.notifyUpstreamConnected()
    if (this.isResyncGateOpen()) {
      this.broadcastResync()
    } else {
      this.resyncPending = true
    }
    if (wasConnectedBefore) {
      void this.replaySessionStatusesForTrackedDirectories()
    }
  }

  /**
   * Announces a fresh upstream connection to the connected-listeners and to clients subscribed to the
   * local OpenCode server, isolating any listener that throws.
   */
  private notifyUpstreamConnected(): void {
    this.upstreamConnectedListeners.forEach(listener => {
      try { listener() } catch { /* ignore listener errors */ }
    })
    this.notifyServerConnected(LOCAL_OPENCODE_SERVER_ID)
  }

  private broadcastResync(): void {
    this.broadcastToAll('resync', JSON.stringify({ timestamp: Date.now() }))
  }

  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  onServerEvent(listener: ServerEventListener): () => void {
    this.serverEventListeners.add(listener)
    return () => { this.serverEventListeners.delete(listener) }
  }

  onUpstreamConnected(listener: () => void): () => void {
    this.upstreamConnectedListeners.add(listener)
    return () => { this.upstreamConnectedListeners.delete(listener) }
  }

  onServerConnected(listener: ServerConnectedListener): () => void {
    this.serverConnectedListeners.add(listener)
    return () => { this.serverConnectedListeners.delete(listener) }
  }

  /**
   * Fans an event out to every server-event listener, isolating each listener so a throwing one cannot
   * block the others or the dispatch caller.
   */
  notifyServerEvent(serverId: string, directory: string | null, event: SSEEvent): void {
    this.serverEventListeners.forEach(listener => {
      try { listener(serverId, directory, event) } catch { /* ignore listener errors */ }
    })
  }

  /**
   * Notifies server-connected listeners that a server's stream is available, swallowing per-listener
   * errors so one failure does not interrupt the notification of the rest.
   */
  notifyServerConnected(serverId: string): void {
    this.serverConnectedListeners.forEach(listener => {
      try { listener(serverId) } catch { /* ignore listener errors */ }
    })
  }

  setRemoteSubagentResolver(resolver: RemoteSubagentResolver | null): void {
    this.remoteSubagentResolver = resolver
  }

  /**
   * Dispatches one local upstream event: directory-scoped events go to that directory's subscribers,
   * catalog updates go to every client, and events without a resolvable directory go to all listeners
   * unscoped.
   */
  private handleUpstreamEvent(event: V2Event): void {
    const { directory, resolvedDirectory } = routeOpenCodeEvent(event, this.sessionDirectories)

    if (directory) {
      if (LOCATION_CATALOG_EVENT_TYPES.has(event.type)) {
        this.deliverResolvedEvent(directory, event)
      } else {
        this.deliverEvent(directory, event)
      }
      return
    }

    if (resolvedDirectory) {
      this.deliverResolvedEvent(resolvedDirectory, event)
      return
    }

    this.notifyListeners(null, event)
    this.writeEnvelopeToClients(this.clients.keys(), null, event)
  }

  /**
   * Delivers an event to listeners and to the clients subscribed to its directory, writing no client
   * frames when no client watches that directory.
   */
  private deliverEvent(directory: string, event: SSEEvent): void {
    this.notifyEvent(directory, event)

    const subscriberIds = this.directoryClients.get(directory)
    if (!subscriberIds || subscriberIds.size === 0) return

    this.writeEnvelopeToClients(subscriberIds, directory, event)
  }

  private deliverResolvedEvent(directory: string, event: SSEEvent): void {
    this.notifyEvent(directory, event)
    this.writeEnvelopeToClients(this.clients.keys(), null, event)
  }

  private notifyEvent(directory: string, event: SSEEvent): void {
    this.handleEvent(directory, event)
    this.notifyListeners(directory, event)
  }

  /**
   * Fans an event out to local listeners with its directory scope and reports it as a local-server event,
   * swallowing individual listener failures.
   */
  private notifyListeners(directory: string | null, event: SSEEvent): void {
    this.eventListeners.forEach(listener => {
      try { listener(directory, event) } catch { /* ignore listener errors */ }
    })
    this.notifyServerEvent(LOCAL_OPENCODE_SERVER_ID, directory, event)
  }

  private writeEnvelopeToClients(
    clientIds: Iterable<string>,
    directory: string | null,
    event: SSEEvent,
    serverId?: string,
  ): void {
    let frame: Uint8Array | null = null
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (!client) continue
      frame ??= encodeSSEFrame('message', serializeEnvelope(directory, JSON.stringify(event), serverId))
      this.writeFrame(client, frame, 'Failed to send to client')
    }
  }

  /**
   * Writes one already-encoded frame to a client, logging the labeled error instead of propagating a
   * failure so one broken connection cannot interrupt a broadcast.
   */
  private writeFrame(client: SSEClient, frame: Uint8Array, errorLabel: string): void {
    try {
      client.writeFrame(frame)
    } catch (error) {
      logger.error(`${errorLabel} ${client.id}:`, error)
    }
  }

  hasClientDirectory(clientId: string, key: string): boolean {
    return this.clients.get(clientId)?.directories.has(key) ?? false
  }

  deliverRemoteEnvelope(serverId: string, directory: string | null, event: SSEEvent): void {
    this.writeEnvelopeToClients(this.clients.keys(), directory, event, serverId)
  }

  /**
   * Sends a remote server event to a single client, but only when that client is subscribed to the
   * server and directory the event belongs to.
   */
  deliverRemoteEnvelopeToClient(clientId: string, serverId: string, directory: string, event: SSEEvent): void {
    if (!this.hasClientDirectory(clientId, buildServerDirectoryKey(serverId, directory))) return
    const client = this.clients.get(clientId)
    if (!client) return
    const frame = encodeSSEFrame('message', serializeEnvelope(directory, JSON.stringify(event), serverId))
    this.writeFrame(client, frame, 'Failed to send remote event to client')
  }

  sendRemoteResync(serverId: string): void {
    const data = JSON.stringify({ timestamp: Date.now(), serverId })
    for (const clientId of this.clientIdsForServer(serverId)) {
      const client = this.clients.get(clientId)
      if (!client) continue
      try {
        client.callback('resync', data)
      } catch { /* ignore resync errors */ }
    }
  }

  /**
   * Collects the IDs of clients subscribed to at least one directory of the given server, each client
   * listed once regardless of how many of its directories match.
   */
  private clientIdsForServer(serverId: string): string[] {
    const clientIds: string[] = []
    for (const client of this.clients.values()) {
      for (const key of client.directories) {
        if (parseServerDirectoryKey(key).serverId === serverId) {
          clientIds.push(client.id)
          break
        }
      }
    }
    return clientIds
  }

  /**
   * Updates active-session and subagent bookkeeping from local events before any listener sees them, so
   * status queries reflect the event being dispatched: status and execution events move sessions between
   * active and idle, deleted sessions are dropped, and sessions with a parent are marked as subagents.
   */
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
        this.markSessionIdle(directory, event.data.sessionID)
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

  /**
   * Drops a session from the active set of its directory, forgetting the directory once it has no
   * active sessions left.
   */
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

  /**
   * Records whether a client is in the foreground and which session and server it is viewing, clearing
   * both view fields when it is not visible and defaulting the server to the local one. Returns false
   * when the client is unknown, leaving stored visibility untouched.
   */
  setClientVisibility(
    id: string,
    visible: boolean,
    activeSessionId: string | null = null,
    activeServerId: string | null = null
  ): boolean {
    const client = this.clients.get(id)
    if (!client) {
      logger.warn(`setClientVisibility: client ${id} not found`)
      return false
    }
    client.visible = visible
    client.activeSessionId = visible ? activeSessionId : null
    client.activeServerId = visible ? (activeServerId ?? LOCAL_OPENCODE_SERVER_ID) : null
    return true
  }

  isSessionBeingViewed(sessionId: string, serverId: string = LOCAL_OPENCODE_SERVER_ID): boolean {
    for (const client of this.clients.values()) {
      if (client.visible && client.activeSessionId === sessionId && client.activeServerId === serverId) {
        return true
      }
    }
    return false
  }

  isSubagentSession(sessionId: string, serverId: string = LOCAL_OPENCODE_SERVER_ID): boolean {
    if (serverId !== LOCAL_OPENCODE_SERVER_ID) {
      return this.remoteSubagentResolver?.(serverId, sessionId) ?? false
    }
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

  /**
   * Reads scheduled session references from the resolver installed by the scheduler, yielding an empty
   * list when no resolver is set.
   */
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
    this.everConnected = false

    this.subscription?.close()
    this.subscription = null
    this.upstreamConnected = false
    this.resyncPending = false

    this.activeSessions.clear()
    this.sessionDirectories.clear()
    this.subagentSessions.clear()
    this.directoryClients.clear()
    this.clients.clear()
    this.eventListeners.clear()
    this.serverEventListeners.clear()
    this.upstreamConnectedListeners.clear()
    this.serverConnectedListeners.clear()
    this.remoteSubagentResolver = null
    this.remoteReplayHandler = null
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
