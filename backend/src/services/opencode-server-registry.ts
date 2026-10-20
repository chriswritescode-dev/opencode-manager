import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import {
  CreateOpenCodeServerRequestSchema,
  LOCAL_OPENCODE_SERVER_ID,
  TestOpenCodeServerRequestSchema,
  UpdateOpenCodeServerRequestSchema,
  type OpenCodeServer,
  type OpenCodeServerPairing,
  type OpenCodeServerTestResult,
} from '@opencode-manager/shared/schemas'
import {
  buildOpenCodeBasicAuth,
  createOpenCodePairingNonce,
  createOpenCodePairingProof,
  decryptOpenCodePairingCredentials,
  isSupportedOpenCodeVersion,
} from '@opencode-manager/shared/opencode'
import { haveSameUrlOrigin, trimUrlTrailingSlashes } from '@opencode-manager/shared/utils'
import {
  deleteOpenCodeServer,
  getOpenCodeServer,
  insertOpenCodeServer,
  listOpenCodeServers,
  readOpenCodeServerPassword,
  updateOpenCodeServer,
} from '../db/opencode-servers'
import { logger } from '../utils/logger'
import { ServiceError } from '../utils/service-error'
import { FetchOpenCodeClient, type OpenCodeClient } from './opencode/client'

const PAIRING_TIMEOUT_MS = 10_000
const TEST_TIMEOUT_MS = 5_000

const PairingEncryptedPayloadSchema = z.object({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
})

type CreateServerInput = z.output<typeof CreateOpenCodeServerRequestSchema>
type UpdateServerInput = z.output<typeof UpdateOpenCodeServerRequestSchema>
type TestServerInput = z.output<typeof TestOpenCodeServerRequestSchema>
type TestServerSource = TestServerInput | { serverId: string }

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

export class OpenCodeServerPairingError extends OpenCodeServerError {
  constructor(message: string) {
    super(message, 502)
    this.name = 'OpenCodeServerPairingError'
  }
}

/** Raised when a server address change would reuse stored credentials on a different origin. */
export class OpenCodeServerCredentialsRequiredError extends OpenCodeServerError {
  constructor() {
    super('Changing the server address requires re-entering the password or pairing again', 400)
    this.name = 'OpenCodeServerCredentialsRequiredError'
  }
}

function reusesStoredPasswordOnNewOrigin(server: OpenCodeServer, request: UpdateServerInput): boolean {
  if (request.baseUrl === undefined) return false
  if (!server.hasPassword) return false
  if (request.pairing) return false
  if (request.password !== undefined) return false
  return !haveSameUrlOrigin(server.baseUrl, request.baseUrl)
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

  async create(request: CreateServerInput): Promise<OpenCodeServer> {
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

  async update(serverId: string, request: UpdateServerInput): Promise<OpenCodeServer> {
    const existing = this.requireServer(serverId)
    if (reusesStoredPasswordOnNewOrigin(existing, request)) {
      throw new OpenCodeServerCredentialsRequiredError()
    }

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

    const connection = this.getConnection(serverId)
    const client = new FetchOpenCodeClient({
      baseUrl: connection.baseUrl,
      basicAuth: connection.authorization,
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
      authorization: password === null ? null : buildOpenCodeBasicAuth(password, server.username),
    }
  }

  async test(input: TestServerSource): Promise<OpenCodeServerTestResult> {
    const target = this.resolveTestTarget(input)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (target.password !== null) {
      headers.Authorization = buildOpenCodeBasicAuth(target.password, target.username)
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

  private resolveTestTarget(input: TestServerSource): TestTarget {
    if (!('baseUrl' in input)) {
      const server = this.requireServer(input.serverId)
      return {
        baseUrl: server.baseUrl,
        username: server.username,
        password: readOpenCodeServerPassword(this.db, input.serverId),
      }
    }

    const baseUrl = trimUrlTrailingSlashes(input.baseUrl)
    if (input.password !== undefined || input.serverId === undefined) {
      return {
        baseUrl,
        username: input.username,
        password: input.password ?? null,
      }
    }

    const server = this.requireServer(input.serverId)
    return {
      baseUrl,
      username: input.username,
      password: haveSameUrlOrigin(server.baseUrl, baseUrl)
        ? readOpenCodeServerPassword(this.db, input.serverId)
        : null,
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
    const nonce = createOpenCodePairingNonce()
    const proof = await createOpenCodePairingProof(pairing.code, nonce)

    let response: Response
    try {
      response = await this.fetchFn(pairing.pairUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, proof }),
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

    const parsed = PairingEncryptedPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new OpenCodeServerPairingError('Pairing returned an invalid response')
    }

    try {
      return await decryptOpenCodePairingCredentials({
        code: pairing.code,
        nonce,
        iv: parsed.data.iv,
        ciphertext: parsed.data.ciphertext,
      })
    } catch {
      throw new OpenCodeServerPairingError('Pairing returned invalid credentials')
    }
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
}
