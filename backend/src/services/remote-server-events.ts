import { DEFAULTS } from '@opencode-manager/shared/config'
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
  collectPendingReplayEvents,
  createReplayEventBuilder,
  planSessionStatusReplay,
  routeOpenCodeEvent,
  type ReplayEventBuilder,
} from './opencode-event-routing'
import { subscribeOpenCodeEvents, type OpenCodeEventSubscription } from './opencode-event-subscription'
import type { RemoteReplayHandler } from './sse-aggregator'

const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } = DEFAULTS.SSE

export interface RemoteEventAggregator {
  deliverRemoteEnvelope(serverId: string, directory: string | null, payloadJson: string): void
  deliverRemoteEnvelopeToClient(clientId: string, serverId: string, directory: string, payloadJson: string): void
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
  private readonly reconnectDelayMs: number
  private readonly maxReconnectDelayMs: number
  private unsubscribeRegistry: (() => void) | null = null
  private started = false
  private versionProbeSequence = 0
  private readonly buildReplayEvent: ReplayEventBuilder = createReplayEventBuilder('ocm_replay_remote_')

  constructor(
    private readonly registry: OpenCodeServerRegistry,
    private readonly aggregator: RemoteEventAggregator,
    options: RemoteServerEventHubOptions = {},
  ) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS
  }

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

  private emitReplayEventsToClient(
    clientId: string,
    serverId: string,
    directory: string,
    events: V2Event[],
  ): void {
    for (const event of events) {
      this.aggregator.deliverRemoteEnvelopeToClient(clientId, serverId, directory, JSON.stringify(event))
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
      reconnectDelayMs: this.reconnectDelayMs,
      maxReconnectDelayMs: this.maxReconnectDelayMs,
    })

    stream.subscription = subscription
    logger.info(`Remote event stream connecting: ${serverId}`)
  }

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

  private handleStreamError(serverId: string, error: unknown): void {
    const stream = this.streams.get(serverId)
    if (!stream) return

    stream.connected = false
    stream.error = describeStreamError(error)
    logger.warn(`Remote event stream error for ${serverId}: ${stream.error}`)
  }

  private handleMessage(serverId: string, event: V2Event): void {
    const stream = this.streams.get(serverId)
    if (!stream) return

    const { resolvedDirectory, payloadJson } = routeOpenCodeEvent(event, stream.sessionDirectories)
    const sessionID = sessionIDFromEvent(event)
    if (sessionID) applySessionActivity(stream.busySessions, event)
    if (sessionID && event.type === 'session.deleted') {
      stream.subagentSessions.delete(sessionID)
    } else if (event.type === 'session.created' && event.data.parentID) {
      stream.subagentSessions.add(event.data.sessionID)
    }

    this.aggregator.notifyServerEvent(serverId, resolvedDirectory ?? null, event)
    this.aggregator.deliverRemoteEnvelope(serverId, resolvedDirectory ?? null, payloadJson)
  }

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

  private isStreamCurrent(
    serverId: string,
    stream: RemoteServerStream,
    subscription: OpenCodeEventSubscription,
  ): boolean {
    return this.streams.get(serverId) === stream && stream.subscription === subscription && stream.connected
  }

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
      const event = this.buildReplayEvent('session.status', directory, { sessionID, status: { type: 'idle' } })
      this.aggregator.deliverRemoteEnvelope(serverId, directory, JSON.stringify(event))
      stream.busySessions.delete(sessionID)
      replayed++
    }

    for (const sessionID of plan.busy) {
      const directory = stream.sessionDirectories.get(sessionID) ?? null
      const event = this.buildReplayEvent('session.status', directory ?? '', { sessionID, status: { type: 'busy' } })
      this.aggregator.deliverRemoteEnvelope(serverId, directory, JSON.stringify(event))
      stream.busySessions.add(sessionID)
      replayed++
    }

    if (replayed > 0) {
      logger.info(`remote status replay: re-emitted ${replayed} session status(es) for ${serverId}`)
    }
  }

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
