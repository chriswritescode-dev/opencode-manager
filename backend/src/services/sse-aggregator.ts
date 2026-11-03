import { logger } from '../utils/logger'
import { buildServerDirectoryKey, LOCAL_OPENCODE_SERVER_ID, parseServerDirectoryKey } from '@opencode-manager/shared/schemas'
import { type V2Event } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './opencode/client'
import { encodeSSEFrame } from '../utils/sse-frame'
import {
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

  reconnect(): void {
    if (!this.started) return
    logger.info('SSE forcing upstream reconnect (auth changed)')
    this.subscription?.reconnect()
  }

  static getInstance(): SSEAggregator {
    if (!SSEAggregator.instance) {
      SSEAggregator.instance = new SSEAggregator()
    }
    return SSEAggregator.instance
  }

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
      this.deliverEvent(directory, this.buildReplayEvent('session.status', directory, { sessionID, status: { type: 'idle' } }))
      replayed++
    }

    const runningDirectories = await Promise.all(plan.busy.map(async (sessionID) => ({
      sessionID,
      directory: tracked.get(sessionID) ?? await this.resolveSessionDirectory(client, sessionID),
    })))

    for (const { sessionID, directory } of runningDirectories) {
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
    tracked.forEach((directory, sessionID) => this.sessionDirectories.set(sessionID, directory))
    return tracked
  }

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

  private handleUpstreamOpen(wasConnectedBefore: boolean): void {
    logger.info('SSE global stream connected')
    this.upstreamConnected = true
    this.everConnected = true
    this.notifyUpstreamConnected()
    this.broadcastResync()
    if (wasConnectedBefore) {
      void this.replaySessionStatusesForTrackedDirectories()
    }
  }

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

  notifyServerEvent(serverId: string, directory: string | null, event: SSEEvent): void {
    this.serverEventListeners.forEach(listener => {
      try { listener(serverId, directory, event) } catch { /* ignore listener errors */ }
    })
  }

  notifyServerConnected(serverId: string): void {
    this.serverConnectedListeners.forEach(listener => {
      try { listener(serverId) } catch { /* ignore listener errors */ }
    })
  }

  setRemoteSubagentResolver(resolver: RemoteSubagentResolver | null): void {
    this.remoteSubagentResolver = resolver
  }

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
