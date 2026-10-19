import { EventSource } from 'eventsource'
import { DEFAULTS } from '@opencode-manager/shared/config'
import {
  buildServerDirectoryKey,
  LOCAL_OPENCODE_SERVER_ID,
  type OpenCodeServer,
  type OpenCodeServerStatus,
} from '@opencode-manager/shared/schemas'
import { openCodeLocation, sessionIDFromEvent, type OpenCodeApi, type V2Event } from '@opencode-manager/shared/opencode'
import { logger } from '../utils/logger'
import type {
  OpenCodeServerChange,
  OpenCodeServerConnection,
  OpenCodeServerRegistry,
} from './opencode-server-registry'
import type { RemoteReplayHandler } from './sse-aggregator'

const { RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } = DEFAULTS.SSE
const MULTILINE_PATTERN = /[\r\n]/

export interface RemoteEventAggregator {
  deliverRemoteEnvelope(serverId: string, directory: string | null, payloadJson: string): void
  deliverRemoteEnvelopeToClient(clientId: string, serverId: string, directory: string, payloadJson: string): void
  sendRemoteResync(serverId: string, data: string): void
  hasClientDirectory(clientId: string, key: string): boolean
  setRemoteReplayHandler(handler: RemoteReplayHandler | null): void
  notifyServerEvent(serverId: string, directory: string | null, event: V2Event): void
  notifyServerConnected(serverId: string): void
  setRemoteSubagentResolver(resolver: ((serverId: string, sessionId: string) => boolean) | null): void
}

export interface RemoteEventSource {
  onopen: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  close(): void
}

export type RemoteEventSourceInit = ConstructorParameters<typeof EventSource>[1]
export type RemoteEventSourceFactory = (url: string, init?: RemoteEventSourceInit) => RemoteEventSource

export interface RemoteServerEventHubOptions {
  eventSourceFactory?: RemoteEventSourceFactory
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
}

interface RemoteServerStream {
  source: RemoteEventSource | null
  reconnectTimeout: ReturnType<typeof setTimeout> | null
  reconnectDelay: number
  connected: boolean
  error: string | null
  version: string | null
  versionRequested: boolean
  sessionDirectories: Map<string, string>
  subagentSessions: Set<string>
}

type RemoteReplayEventType = 'permission.asked' | 'form.created'

function createDefaultEventSource(url: string, init?: RemoteEventSourceInit): RemoteEventSource {
  return new EventSource(url, init) as unknown as RemoteEventSource
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
  private readonly eventSourceFactory: RemoteEventSourceFactory
  private readonly reconnectDelayMs: number
  private readonly maxReconnectDelayMs: number
  private unsubscribeRegistry: (() => void) | null = null
  private started = false
  private replayEventCount = 0

  constructor(
    private readonly registry: OpenCodeServerRegistry,
    private readonly aggregator: RemoteEventAggregator,
    options: RemoteServerEventHubOptions = {},
  ) {
    this.eventSourceFactory = options.eventSourceFactory ?? createDefaultEventSource
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

    let api: OpenCodeApi
    try {
      api = this.registry.getClient(serverId).api
    } catch (error) {
      logger.warn(`remote replay: no client for ${serverId}: ${String(error)}`)
      return
    }

    const [permissionsResult, formsResult] = await Promise.allSettled([
      api.permission.request.list(openCodeLocation(directory)),
      api.form.list(openCodeLocation(directory)),
    ])

    if (permissionsResult.status === 'rejected') {
      logger.warn(`remote replay: failed to fetch pending permissions for ${key}: ${String(permissionsResult.reason)}`)
    } else {
      this.emitReplayEventsToClient(clientId, serverId, directory, permissionsResult.value.data.map(request =>
        this.buildReplayEvent('permission.asked', directory, request)
      ))
    }

    if (formsResult.status === 'rejected') {
      logger.warn(`remote replay: failed to fetch pending forms for ${key}: ${String(formsResult.reason)}`)
    } else {
      this.emitReplayEventsToClient(clientId, serverId, directory, formsResult.value.data.map(form =>
        this.buildReplayEvent('form.created', directory, { form })
      ))
    }
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

  private buildReplayEvent(type: RemoteReplayEventType, directory: string, data: unknown): V2Event {
    this.replayEventCount += 1
    return {
      id: `ocm_replay_remote_${this.replayEventCount}`,
      created: Date.now(),
      type,
      location: { directory },
      data,
    } as V2Event
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

    let connection: OpenCodeServerConnection
    try {
      connection = this.registry.getConnection(serverId)
    } catch (error) {
      this.recordError(serverId, describeStreamError(error))
      logger.warn(`Remote event stream unavailable for ${serverId}: ${describeStreamError(error)}`)
      return
    }

    const authorization = connection.authorization
    const init: RemoteEventSourceInit | undefined = authorization
      ? {
          fetch: (input, fetchInit) =>
            fetch(input, {
              ...fetchInit,
              headers: {
                ...(fetchInit?.headers ?? {}),
                Authorization: authorization,
              },
            }),
        }
      : undefined

    const stream = this.ensureStream(serverId)
    let source: RemoteEventSource
    try {
      source = this.eventSourceFactory(`${connection.baseUrl}/api/event`, init)
    } catch (error) {
      this.recordError(serverId, describeStreamError(error))
      this.scheduleReconnect(serverId)
      return
    }

    stream.source = source
    stream.error = null
    source.onopen = () => this.handleOpen(serverId, source)
    source.onerror = (event) => this.handleStreamError(serverId, source, event)
    source.onmessage = (event) => this.handleMessage(serverId, event.data)
    logger.info(`Remote event stream connecting: ${serverId}`)
  }

  private handleOpen(serverId: string, source: RemoteEventSource): void {
    const stream = this.streams.get(serverId)
    if (!stream || stream.source !== source) return

    stream.connected = true
    stream.error = null
    stream.reconnectDelay = this.reconnectDelayMs
    logger.info(`Remote event stream connected: ${serverId}`)
    this.aggregator.notifyServerConnected(serverId)
    this.aggregator.sendRemoteResync(serverId, JSON.stringify({ timestamp: Date.now() }))
    void this.refreshVersion(serverId)
  }

  private handleStreamError(serverId: string, source: RemoteEventSource, error: unknown): void {
    const stream = this.streams.get(serverId)
    if (!stream || stream.source !== source) return

    stream.connected = false
    stream.error = describeStreamError(error)
    logger.warn(`Remote event stream error for ${serverId}: ${stream.error}`)
    this.closeSource(stream)
    this.scheduleReconnect(serverId)
  }

  private scheduleReconnect(serverId: string): void {
    const stream = this.streams.get(serverId)
    if (!this.started || !stream || stream.reconnectTimeout) return

    const delay = stream.reconnectDelay
    stream.reconnectTimeout = setTimeout(() => {
      const current = this.streams.get(serverId)
      if (!current) return
      current.reconnectTimeout = null
      current.reconnectDelay = Math.min(current.reconnectDelay * 2, this.maxReconnectDelayMs)
      this.connectServer(serverId)
    }, delay)
  }

  private handleMessage(serverId: string, data: string): void {
    const stream = this.streams.get(serverId)
    if (!stream) return

    let event: V2Event
    try {
      event = JSON.parse(data) as V2Event
    } catch {
      return
    }

    if (!event?.type) return

    const payloadJson = MULTILINE_PATTERN.test(data) ? JSON.stringify(event) : data
    const directory = event.location?.directory
    const sessionID = sessionIDFromEvent(event)
    const forkParentId = event.type === 'session.forked' ? event.data.parentID : undefined
    const inheritedDirectory = forkParentId ? stream.sessionDirectories.get(forkParentId) : undefined

    try {
      const rememberedDirectory = directory ?? inheritedDirectory
      const resolvedDirectory = rememberedDirectory ?? (sessionID ? stream.sessionDirectories.get(sessionID) : undefined)

      if (sessionID && event.type === 'session.deleted') {
        stream.sessionDirectories.delete(sessionID)
        stream.subagentSessions.delete(sessionID)
      } else if (sessionID && rememberedDirectory) {
        stream.sessionDirectories.set(sessionID, rememberedDirectory)
      }

      if (event.type === 'session.created' && event.data.parentID) {
        stream.subagentSessions.add(event.data.sessionID)
      }

      this.aggregator.notifyServerEvent(serverId, resolvedDirectory ?? null, event)
      this.aggregator.deliverRemoteEnvelope(serverId, resolvedDirectory ?? null, payloadJson)
    } catch (error) {
      logger.error(`Remote event stream failed to handle ${event.type} for ${serverId}:`, error)
    }
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
    if (stream) stream.reconnectDelay = this.reconnectDelayMs
    this.connectServer(change.serverId)
  }

  private async refreshVersion(serverId: string): Promise<void> {
    const stream = this.streams.get(serverId)
    if (!stream || stream.versionRequested) return
    const test = this.registry.test
    if (typeof test !== 'function') return

    stream.versionRequested = true
    try {
      const result = await test.call(this.registry, { serverId })
      const current = this.streams.get(serverId)
      if (current && result.ok && result.version) current.version = result.version
    } catch (error) {
      logger.warn(`Failed to read the version of OpenCode server ${serverId}: ${String(error)}`)
    }
  }

  private ensureStream(serverId: string): RemoteServerStream {
    const existing = this.streams.get(serverId)
    if (existing) return existing

    const stream: RemoteServerStream = {
      source: null,
      reconnectTimeout: null,
      reconnectDelay: this.reconnectDelayMs,
      connected: false,
      error: null,
      version: null,
      versionRequested: false,
      sessionDirectories: new Map(),
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

  private closeSource(stream: RemoteServerStream): void {
    if (!stream.source) return
    stream.source.close()
    stream.source = null
  }

  private closeStream(serverId: string): void {
    const stream = this.streams.get(serverId)
    if (!stream) return
    if (stream.reconnectTimeout) {
      clearTimeout(stream.reconnectTimeout)
      stream.reconnectTimeout = null
    }
    this.closeSource(stream)
    stream.connected = false
  }

  private forgetStream(serverId: string): void {
    this.closeStream(serverId)
    this.streams.delete(serverId)
  }
}
