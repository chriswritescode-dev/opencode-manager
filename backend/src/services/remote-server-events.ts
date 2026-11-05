import {
  buildServerDirectoryKey,
  LOCAL_OPENCODE_SERVER_ID,
  type OpenCodeServer,
  type OpenCodeServerStatus,
} from '@opencode-manager/shared/schemas'
import { sessionIDFromEvent, type OpenCodeApi, type V2Event } from '@opencode-manager/shared/opencode'
import { logger } from '../utils/logger'
import type {
  OpenCodeServerChange,
  OpenCodeServerRegistry,
} from './opencode-server-registry'
import {
  applySessionActivity,
  buildSessionStatusReplayEvent,
  collectPendingReplayEvents,
  createReplayEventBuilder,
  planSessionStatusReplay,
  routeOpenCodeEvent,
  type ReplayEventBuilder,
} from './opencode-event-routing'
import { subscribeOpenCodeEvents, type OpenCodeEventSubscription } from './opencode-event-subscription'
import type { RemoteReplayHandler } from './sse-aggregator'

export interface RemoteEventAggregator {
  deliverRemoteEnvelope(serverId: string, directory: string | null, event: V2Event): void
  deliverRemoteEnvelopeToClient(clientId: string, serverId: string, directory: string, event: V2Event): void
  sendRemoteResync(serverId: string): void
  hasClientDirectory(clientId: string, key: string): boolean
  setRemoteReplayHandler(handler: RemoteReplayHandler | null): void
  notifyServerEvent(serverId: string, directory: string | null, event: V2Event): void
  notifyServerConnected(serverId: string): void
  setRemoteSubagentResolver(resolver: ((serverId: string, sessionId: string) => boolean) | null): void
}

export interface RemoteServerEventHubOptions {
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
}

interface RemoteServerStream {
  subscription: OpenCodeEventSubscription | null
  connected: boolean
  error: string | null
  version: string | null
  versionRequested: boolean
  versionProbeToken: number
  sessionDirectories: Map<string, string>
  busySessions: Set<string>
  subagentSessions: Set<string>
}

function describeStreamError(error: unknown): string {
  if (typeof error === 'string' && error) return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null) {
    const { message, code } = error as { message?: unknown; code?: unknown }
    if (typeof message === 'string' && message) return message
    if (typeof code === 'number' || typeof code === 'string') return `event stream closed (code=${String(code)})`
  }
  return 'event stream disconnected'
}

export class RemoteServerEventHub {
  private readonly streams = new Map<string, RemoteServerStream>()
  private unsubscribeRegistry: (() => void) | null = null
  private started = false
  private versionProbeSequence = 0
  private readonly buildReplayEvent: ReplayEventBuilder = createReplayEventBuilder('ocm_replay_remote_')

  constructor(
    private readonly registry: OpenCodeServerRegistry,
    private readonly aggregator: RemoteEventAggregator,
    private readonly options: RemoteServerEventHubOptions = {},
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.aggregator.setRemoteReplayHandler((clientId, serverId, directory) =>
      this.replayPendingActions(clientId, serverId, directory))
    this.aggregator.setRemoteSubagentResolver((serverId, sessionId) => this.isSubagentSession(serverId, sessionId))
    this.unsubscribeRegistry = this.registry.onChange(change => this.handleRegistryChange(change))
    this.connectAll()
  }

  shutdown(): void {
    this.started = false
    if (this.unsubscribeRegistry) {
      this.unsubscribeRegistry()
      this.unsubscribeRegistry = null
    }
    for (const serverId of Array.from(this.streams.keys())) {
      this.forgetStream(serverId)
    }
    this.aggregator.setRemoteReplayHandler(null)
    this.aggregator.setRemoteSubagentResolver(null)
  }

  isSubagentSession(serverId: string, sessionId: string): boolean {
    return this.streams.get(serverId)?.subagentSessions.has(sessionId) ?? false
  }

  getStatuses(): OpenCodeServerStatus[] {
    let servers: OpenCodeServer[]
    try {
      servers = this.registry.list()
    } catch (error) {
      logger.error('Failed to list OpenCode servers for remote event status', error)
      return []
    }

    return servers.map(server => {
      const stream = this.streams.get(server.id)
      return {
        serverId: server.id,
        connected: stream?.connected ?? false,
        version: stream?.version ?? null,
        error: stream?.error ?? null,
      }
    })
  }

  async replayPendingActions(clientId: string, serverId: string, directory: string): Promise<void> {
    const key = buildServerDirectoryKey(serverId, directory)
    if (!this.aggregator.hasClientDirectory(clientId, key)) return

    const stream = this.streams.get(serverId)
    if (!stream || !this.hasActiveSession(stream, directory)) return

    let api: OpenCodeApi
    try {
      api = this.registry.getClient(serverId).api
    } catch (error) {
      logger.warn(`remote replay: no client for ${serverId}: ${String(error)}`)
      return
    }

    const events = await collectPendingReplayEvents({
      api,
      directory,
      buildEvent: this.buildReplayEvent,
      logScope: 'remote replay',
      logTarget: key,
    })

    this.emitReplayEventsToClient(clientId, serverId, directory, events.permissions)
    this.emitReplayEventsToClient(clientId, serverId, directory, events.forms)
  }

  private hasActiveSession(stream: RemoteServerStream, directory: string): boolean {
    for (const sessionID of stream.busySessions) {
      if (stream.sessionDirectories.get(sessionID) === directory) return true
    }
    return false
  }

  /**
   * Delivers already-built replay events to one client through the aggregator, which drops them unless
   * the client still subscribes to that server and directory.
   */
  private emitReplayEventsToClient(
    clientId: string,
    serverId: string,
    directory: string,
    events: V2Event[],
  ): void {
    for (const event of events) {
      this.aggregator.deliverRemoteEnvelopeToClient(clientId, serverId, directory, event)
    }
  }

  private connectAll(): void {
    let servers: OpenCodeServer[]
    try {
      servers = this.registry.list()
    } catch (error) {
      logger.error('Failed to list OpenCode servers for remote event streams', error)
      return
    }

    for (const server of servers) {
      if (server.id === LOCAL_OPENCODE_SERVER_ID) continue
      if (server.enabled) this.connectServer(server.id)
    }
  }

  /**
   * Replaces the server's event subscription with a fresh one, recording a stream error instead when the
   * registry cannot provide a connection. Does nothing until the hub has started, so stale callbacks from
   * the prior subscription are ignored rather than applied.
   */
  private connectServer(serverId: string): void {
    if (!this.started) return
    this.closeStream(serverId)

    try {
      this.registry.getConnection(serverId)
    } catch (error) {
      this.recordError(serverId, describeStreamError(error))
      logger.warn(`Remote event stream unavailable for ${serverId}: ${describeStreamError(error)}`)
      return
    }

    const stream = this.ensureStream(serverId)
    stream.error = null

    const subscription = subscribeOpenCodeEvents({
      api: () => this.registry.getClient(serverId).api,
      label: serverId,
      onOpen: () => this.handleOpen(serverId, subscription),
      onEvent: (event) => this.handleMessage(serverId, event),
      onDisconnect: (error) => this.handleStreamError(serverId, error),
      reconnectDelayMs: this.options.reconnectDelayMs,
      maxReconnectDelayMs: this.options.maxReconnectDelayMs,
    })

    stream.subscription = subscription
    logger.info(`Remote event stream connecting: ${serverId}`)
  }

  /**
   * Marks the server's stream connected, announces it to the aggregator, and starts version probing
   * and session status replay. A callback from a superseded subscription is ignored.
   */
  private handleOpen(serverId: string, subscription: OpenCodeEventSubscription): void {
    const stream = this.streams.get(serverId)
    if (!stream || stream.subscription !== subscription) return

    stream.connected = true
    stream.error = null
    logger.info(`Remote event stream connected: ${serverId}`)
    this.aggregator.notifyServerConnected(serverId)
    this.aggregator.sendRemoteResync(serverId)
    void this.refreshVersion(serverId)
    void this.replaySessionStatuses(serverId, subscription)
  }

  /**
   * Records a disconnect on the server's stream and clears its connected flag, leaving the
   * subscription itself to keep reconnecting.
   */
  private handleStreamError(serverId: string, error: unknown): void {
    const stream = this.streams.get(serverId)
    if (!stream) return

    stream.connected = false
    stream.error = describeStreamError(error)
    logger.warn(`Remote event stream error for ${serverId}: ${stream.error}`)
  }

  /**
   * Routes one upstream event to the aggregator while maintaining the hub's per-stream bookkeeping:
   * busy-session activity, subagent session ids, and the directory the event resolves to.
   */
  private handleMessage(serverId: string, event: V2Event): void {
    const stream = this.streams.get(serverId)
    if (!stream) return

    const { resolvedDirectory } = routeOpenCodeEvent(event, stream.sessionDirectories)
    const sessionID = sessionIDFromEvent(event)
    if (sessionID) applySessionActivity(stream.busySessions, event)
    if (sessionID && event.type === 'session.deleted') {
      stream.subagentSessions.delete(sessionID)
    } else if (event.type === 'session.created' && event.data.parentID) {
      stream.subagentSessions.add(event.data.sessionID)
    }

    this.aggregator.notifyServerEvent(serverId, resolvedDirectory ?? null, event)
    this.aggregator.deliverRemoteEnvelope(serverId, resolvedDirectory ?? null, event)
  }

  /**
   * Keeps streams aligned with the server registry: deleted, unreadable, or disabled servers have their
   * stream forgotten, while added and updated servers get their cached version state cleared and are
   * reconnected.
   */
  private handleRegistryChange(change: OpenCodeServerChange): void {
    if (!this.started) return

    if (change.type === 'deleted') {
      this.forgetStream(change.serverId)
      return
    }

    let server: OpenCodeServer | null
    try {
      server = this.registry.get(change.serverId)
    } catch (error) {
      logger.warn(`Failed to read OpenCode server ${change.serverId}: ${String(error)}`)
      this.forgetStream(change.serverId)
      return
    }

    if (!server || !server.enabled) {
      this.forgetStream(change.serverId)
      return
    }

    const stream = this.streams.get(change.serverId)
    if (stream) {
      stream.version = null
      stream.versionRequested = false
      stream.versionProbeToken = 0
    }
    this.connectServer(change.serverId)
  }

  /**
   * Reports whether the subscription still owns the server's live stream, so async work started under
   * it does not act on a stream that has since been replaced or disconnected.
   */
  private isStreamCurrent(
    serverId: string,
    stream: RemoteServerStream,
    subscription: OpenCodeEventSubscription,
  ): boolean {
    return this.streams.get(serverId) === stream && stream.subscription === subscription && stream.connected
  }

  /**
   * Re-emits idle and busy status events for the server's active sessions after a reconnect, so
   * clients that missed updates while disconnected resync. Stops quietly at any await once the stream
   * is no longer current.
   */
  private async replaySessionStatuses(serverId: string, subscription: OpenCodeEventSubscription): Promise<void> {
    const stream = this.streams.get(serverId)
    if (!stream || !this.isStreamCurrent(serverId, stream, subscription)) return

    let api: OpenCodeApi
    try {
      api = this.registry.getClient(serverId).api
    } catch (error) {
      logger.warn(`remote status replay: no client for ${serverId}: ${String(error)}`)
      return
    }

    let active: Record<string, unknown>
    try {
      active = await api.session.active()
    } catch (error) {
      logger.warn(`remote status replay: failed to fetch active sessions for ${serverId}: ${String(error)}`)
      return
    }

    if (!this.isStreamCurrent(serverId, stream, subscription)) return

    await this.resolveActiveSessionDirectories(api, serverId, stream, Object.keys(active ?? {}))
    if (!this.isStreamCurrent(serverId, stream, subscription)) return

    const plan = planSessionStatusReplay(active, stream.sessionDirectories)
    let replayed = 0

    for (const { sessionID, directory } of plan.idle) {
      const event = buildSessionStatusReplayEvent(this.buildReplayEvent, directory, sessionID, 'idle')
      this.aggregator.deliverRemoteEnvelope(serverId, directory, event)
      stream.busySessions.delete(sessionID)
      replayed++
    }

    for (const sessionID of plan.busy) {
      const directory = stream.sessionDirectories.get(sessionID) ?? null
      const event = buildSessionStatusReplayEvent(this.buildReplayEvent, directory ?? '', sessionID, 'busy')
      this.aggregator.deliverRemoteEnvelope(serverId, directory, event)
      stream.busySessions.add(sessionID)
      replayed++
    }

    if (replayed > 0) {
      logger.info(`remote status replay: re-emitted ${replayed} session status(es) for ${serverId}`)
    }
  }

  /**
   * Looks up the working directory of active sessions the stream has not mapped yet, caching each result
   * in `sessionDirectories`. Sessions are fetched concurrently and left unresolved when their lookup
   * fails, so replay proceeds with whatever directories are known.
   */
  private async resolveActiveSessionDirectories(
    api: OpenCodeApi,
    serverId: string,
    stream: RemoteServerStream,
    sessionIDs: string[],
  ): Promise<void> {
    const unresolved = sessionIDs.filter((sessionID) => !stream.sessionDirectories.has(sessionID))
    if (unresolved.length === 0) return

    await Promise.allSettled(unresolved.map(async (sessionID) => {
      try {
        const session = await api.session.get({ sessionID })
        const directory = session.location.directory
        if (directory) stream.sessionDirectories.set(sessionID, directory)
      } catch (error) {
        logger.warn(`remote status replay: failed to resolve the directory of ${sessionID} on ${serverId}: ${String(error)}`)
      }
    }))
  }

  /**
   * Probes the server's OpenCode version, skipping when a probe is already pending or the version is
   * known. Results are applied only when the probe token still matches the current stream, and a failed
   * probe reopens the request flag so a later reconnect can retry it.
   */
  private async refreshVersion(serverId: string): Promise<void> {
    const stream = this.streams.get(serverId)
    if (!stream || stream.versionRequested) return

    this.versionProbeSequence += 1
    const token = this.versionProbeSequence
    stream.versionRequested = true
    stream.versionProbeToken = token

    let version: string | null = null
    try {
      const result = await this.registry.test({ serverId })
      version = result.ok && result.version ? result.version : null
    } catch (error) {
      logger.warn(`Failed to read the version of OpenCode server ${serverId}: ${String(error)}`)
    }

    const current = this.streams.get(serverId)
    if (!current || current.versionProbeToken !== token) return
    if (version) {
      current.version = version
      return
    }
    current.versionRequested = false
  }

  /**
   * Returns the server's stream bookkeeping record, creating an empty one on first use so callers can
   * record state before a subscription exists.
   */
  private ensureStream(serverId: string): RemoteServerStream {
    const existing = this.streams.get(serverId)
    if (existing) return existing

    const stream: RemoteServerStream = {
      subscription: null,
      connected: false,
      error: null,
      version: null,
      versionRequested: false,
      versionProbeToken: 0,
      sessionDirectories: new Map(),
      busySessions: new Set(),
      subagentSessions: new Set(),
    }
    this.streams.set(serverId, stream)
    return stream
  }

  private recordError(serverId: string, error: string): void {
    const stream = this.ensureStream(serverId)
    stream.connected = false
    stream.error = error
  }

  /**
   * Closes the stream's subscription and clears the handle, keeping the stream entry itself.
   */
  private closeSubscription(stream: RemoteServerStream): void {
    if (!stream.subscription) return
    stream.subscription.close()
    stream.subscription = null
  }

  private closeStream(serverId: string): void {
    const stream = this.streams.get(serverId)
    if (!stream) return
    this.closeSubscription(stream)
    stream.connected = false
  }

  private forgetStream(serverId: string): void {
    this.closeStream(serverId)
    this.streams.delete(serverId)
  }
}
