import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import {
  CreateOpenCodeServerRequestSchema,
  LOCAL_OPENCODE_SERVER_ID,
  TestOpenCodeServerRequestSchema,
  UpdateOpenCodeServerRequestSchema,
  type CreateOpenCodeServerRequest,
  type OpenCodeServer,
  type OpenCodeServerPairing,
  type OpenCodeServerTestResult,
  type TestOpenCodeServerRequest,
  type UpdateOpenCodeServerRequest,
} from '@opencode-manager/shared/schemas'
import { isSupportedOpenCodeVersion } from '@opencode-manager/shared/opencode'
import {
  deleteOpenCodeServer,
  getOpenCodeServer,
  insertOpenCodeServer,
  listOpenCodeServers,
  normalizeOpenCodeServerBaseUrl,
  readOpenCodeServerPassword,
  updateOpenCodeServer,
} from '../db/opencode-servers'
import { logger } from '../utils/logger'
import { ServiceError } from '../utils/service-error'
import { getOpenCodeServerBasicAuthHeader } from './opencode/auth'
import { FetchOpenCodeClient, type OpenCodeClient } from './opencode/client'

const PAIRING_TIMEOUT_MS = 10_000
const TEST_TIMEOUT_MS = 5_000

const PairingRedeemResponseSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

type TestServerInput = z.output<typeof TestOpenCodeServerRequestSchema>

interface TestTarget {
  baseUrl: string
  username: string
  password: string | null
}

export interface OpenCodeServerChange {
  type: 'upserted' | 'deleted'
  serverId: string
}

export interface OpenCodeServerConnection {
  baseUrl: string
  authorization: string | null
}

export type OpenCodeServerChangeListener = (change: OpenCodeServerChange) => void

export class OpenCodeServerError extends ServiceError {}

export class OpenCodeServerNotFoundError extends OpenCodeServerError {
  constructor(serverId: string, reason: 'unknown' | 'disabled' = 'unknown') {
    super(
      reason === 'disabled' ? `OpenCode server is disabled: ${serverId}` : `OpenCode server not found: ${serverId}`,
      404,
    )
    this.name = 'OpenCodeServerNotFoundError'
  }
}

export class OpenCodeServerValidationError extends OpenCodeServerError {
  constructor(message: string, details?: unknown) {
    super(message, 400, { details })
    this.name = 'OpenCodeServerValidationError'
  }
}

export class OpenCodeServerPairingError extends OpenCodeServerError {
  constructor(message: string) {
    super(message, 502)
    this.name = 'OpenCodeServerPairingError'
  }
}

export class OpenCodeServerRegistry {
  private readonly clients = new Map<string, OpenCodeClient>()
  private readonly listeners = new Set<OpenCodeServerChangeListener>()

  constructor(
    private readonly db: Database,
    private readonly localClient: OpenCodeClient,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  list(): OpenCodeServer[] {
    return listOpenCodeServers(this.db)
  }

  get(serverId: string): OpenCodeServer | null {
    return getOpenCodeServer(this.db, serverId)
  }

  async create(input: CreateOpenCodeServerRequest): Promise<OpenCodeServer> {
    const request = this.parse(CreateOpenCodeServerRequestSchema, input)
    const pairing = request.pairing ? await this.redeemPairing(request.pairing) : null

    const server = insertOpenCodeServer(this.db, {
      name: request.name,
      baseUrl: request.baseUrl,
      username: pairing?.username ?? request.username,
      enabled: request.enabled,
      password: pairing?.password ?? request.password ?? null,
    })

    this.emit({ type: 'upserted', serverId: server.id })
    return server
  }

  async update(serverId: string, input: UpdateOpenCodeServerRequest): Promise<OpenCodeServer> {
    this.requireServer(serverId)
    const request = this.parse(UpdateOpenCodeServerRequestSchema, input)
    const pairing = request.pairing ? await this.redeemPairing(request.pairing) : null

    const server = updateOpenCodeServer(this.db, serverId, {
      name: request.name,
      baseUrl: request.baseUrl,
      username: pairing?.username ?? request.username,
      enabled: request.enabled,
      password: pairing?.password ?? request.password,
    })
    if (!server) throw new OpenCodeServerNotFoundError(serverId)

    this.invalidateClient(serverId)
    this.emit({ type: 'upserted', serverId })
    return server
  }

  delete(serverId: string): void {
    if (!deleteOpenCodeServer(this.db, serverId)) {
      throw new OpenCodeServerNotFoundError(serverId)
    }

    this.invalidateClient(serverId)
    this.emit({ type: 'deleted', serverId })
  }

  getClient(serverId: string): OpenCodeClient {
    if (serverId === LOCAL_OPENCODE_SERVER_ID) return this.localClient

    const cached = this.clients.get(serverId)
    if (cached) return cached

    const server = this.requireServer(serverId)
    if (!server.enabled) throw new OpenCodeServerNotFoundError(serverId, 'disabled')

    const password = readOpenCodeServerPassword(this.db, serverId)
    const client = new FetchOpenCodeClient({
      baseUrl: server.baseUrl,
      basicAuth: password === null ? null : getOpenCodeServerBasicAuthHeader(server.username, password),
      defaultDirectory: false,
      fetchFn: this.fetchFn,
    })

    this.clients.set(serverId, client)
    return client
  }

  getConnection(serverId: string): OpenCodeServerConnection {
    if (serverId === LOCAL_OPENCODE_SERVER_ID) {
      throw new OpenCodeServerError('The local OpenCode server has no remote connection', 400)
    }

    const server = this.requireServer(serverId)
    if (!server.enabled) throw new OpenCodeServerNotFoundError(serverId, 'disabled')

    const password = readOpenCodeServerPassword(this.db, serverId)
    return {
      baseUrl: server.baseUrl,
      authorization: password === null ? null : getOpenCodeServerBasicAuthHeader(server.username, password),
    }
  }

  async test(input: TestOpenCodeServerRequest | { serverId: string }): Promise<OpenCodeServerTestResult> {
    const target = this.resolveTestTarget(input)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (target.password !== null) {
      headers.Authorization = getOpenCodeServerBasicAuthHeader(target.username, target.password)
    }

    let response: Response
    try {
      response = await this.fetchFn(`${target.baseUrl}/api/info`, {
        headers,
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      })
    } catch {
      return {
        ok: false,
        version: null,
        versionSupported: false,
        error: 'Could not reach the OpenCode server',
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        version: null,
        versionSupported: false,
        error: `OpenCode server responded with status ${response.status}`,
      }
    }

    const version = await this.readServerVersion(response)
    if (version === null) {
      return {
        ok: false,
        version: null,
        versionSupported: false,
        error: 'OpenCode server returned an invalid response',
      }
    }

    return {
      ok: true,
      version,
      versionSupported: isSupportedOpenCodeVersion(version),
      error: null,
    }
  }

  onChange(listener: OpenCodeServerChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private resolveTestTarget(input: TestOpenCodeServerRequest | { serverId: string }): TestTarget {
    if ('serverId' in input) {
      const server = this.requireServer(input.serverId)
      return {
        baseUrl: server.baseUrl,
        username: server.username,
        password: readOpenCodeServerPassword(this.db, input.serverId),
      }
    }

    const request: TestServerInput = this.parse(TestOpenCodeServerRequestSchema, input)
    return {
      baseUrl: normalizeOpenCodeServerBaseUrl(request.baseUrl),
      username: request.username,
      password: request.password ?? null,
    }
  }

  private async readServerVersion(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as { version?: unknown }
      return typeof body.version === 'string' && body.version.length > 0 ? body.version : null
    } catch {
      return null
    }
  }

  private async redeemPairing(pairing: OpenCodeServerPairing): Promise<{ username: string; password: string }> {
    let response: Response
    try {
      response = await this.fetchFn(pairing.pairUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairing.code }),
        signal: AbortSignal.timeout(PAIRING_TIMEOUT_MS),
      })
    } catch {
      throw new OpenCodeServerPairingError('Could not reach the pairing endpoint')
    }

    if (response.status !== 200) {
      throw new OpenCodeServerPairingError(`Pairing was rejected with status ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new OpenCodeServerPairingError('Pairing returned an invalid response')
    }

    const parsed = PairingRedeemResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new OpenCodeServerPairingError('Pairing returned an invalid response')
    }
    return parsed.data
  }

  private requireServer(serverId: string): OpenCodeServer {
    const server = getOpenCodeServer(this.db, serverId)
    if (!server) throw new OpenCodeServerNotFoundError(serverId)
    return server
  }

  private invalidateClient(serverId: string): void {
    this.clients.delete(serverId)
  }

  private emit(change: OpenCodeServerChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch (error) {
        logger.error('OpenCode server change listener failed', error)
      }
    }
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      throw new OpenCodeServerValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid OpenCode server request',
        parsed.error.issues,
      )
    }
    return parsed.data
  }
}
