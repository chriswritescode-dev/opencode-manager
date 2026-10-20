import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir, networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import { renderUnicodeCompact } from 'uqr'
import {
  buildOpenCodeBasicAuth,
  encryptOpenCodePairingCredentials,
  isOpenCodePairingNonce,
  verifyOpenCodePairingProof,
  type OpenCodePairingCredentials,
  type OpenCodePairingEncryptedCredentials,
} from '@opencode-manager/shared/opencode'
import { trimUrlTrailingSlashes } from '@opencode-manager/shared/utils'

const DEFAULT_OPENCODE_PORT = 4096
const DEFAULT_SERVICE_PORT = process.platform === 'win32' ? 45278 : 49374
const DEFAULT_SERVICE_HOSTNAME = '127.0.0.1'
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const REDEEM_PATH = '/redeem'
const MAX_BODY_BYTES = 4096

export type PairingCredentials = OpenCodePairingCredentials

export type PairingOutcome = 'linked' | 'expired' | 'rejected'

export interface PairingServerOptions {
  code: string
  credentials: PairingCredentials
  ttlMs: number
  maxAttempts: number
  port?: number
  hostname?: string
}

export interface PairingServerHandle {
  url: string
  port: number
  done: Promise<PairingOutcome>
  close: () => Promise<void>
}

export type OpenCodeServerProbe =
  | { status: 'ok'; version: string | null }
  | { status: 'unauthorized' }
  | { status: 'unreachable'; message: string }

/** Generates a 32-byte random pairing code encoded as base64url. */
export function generatePairingCode(): string {
  return randomBytes(32).toString('base64url')
}

/** Returns the first non-internal IPv4 address, or null when the machine exposes none. */
export function resolveLanIPv4(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | null {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address
      }
    }
  }
  return null
}

/** Picks the OpenCode base URL from the first non-internal IPv4 interface, else loopback. */
export function resolveDefaultBaseUrl(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  const lanAddress = resolveLanIPv4(interfaces)
  return `http://${lanAddress ?? '127.0.0.1'}:${DEFAULT_OPENCODE_PORT}`
}

export interface OpenCodeServiceDiscovery {
  baseUrl: string
  password: string | null
  source: 'registration' | 'config'
  loopbackOnly: boolean
}

export interface OpenCodeServiceDiscoveryOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>
}

/**
 * Reads the OpenCode background service registration, then its config, and resolves the URL a
 * Manager should pair with. Never throws; returns null when neither file yields a usable service.
 */
export function discoverOpenCodeService(
  options: OpenCodeServiceDiscoveryOptions = {},
): OpenCodeServiceDiscovery | null {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const registration = readServiceFile(join(resolveXdgDir(env.XDG_STATE_HOME, home, '.local', 'state'), 'opencode', 'service.json'))
  const config = readServiceFile(join(resolveXdgDir(env.XDG_CONFIG_HOME, home, '.config'), 'opencode', 'service.json'))
  const configPassword = readString(config?.password)

  const registered = resolveServiceUrl(readString(registration?.url), options.interfaces)
  if (registered) {
    return {
      ...registered,
      password: readString(registration?.password) ?? configPassword ?? null,
      source: 'registration',
    }
  }

  if (!config) return null

  const hostname = readString(config.hostname)
  const port = readPort(config.port)
  if (hostname === null && port === null && configPassword === null) return null

  const configured = resolveServiceUrl(
    `http://${bracketHostname(hostname ?? DEFAULT_SERVICE_HOSTNAME)}:${port ?? DEFAULT_SERVICE_PORT}`,
    options.interfaces,
  )
  if (!configured) return null

  return { ...configured, password: configPassword, source: 'config' }
}

function bracketHostname(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
}

function resolveXdgDir(override: string | undefined, home: string, ...fallback: string[]): string {
  const configured = override?.trim()
  return configured || join(home, ...fallback)
}

function resolveServiceUrl(
  rawUrl: string | null,
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>,
): { baseUrl: string; loopbackOnly: boolean } | null {
  if (rawUrl === null) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  if (WILDCARD_HOSTS.has(parsed.hostname)) {
    parsed.hostname = resolveLanIPv4(interfaces) ?? '127.0.0.1'
  }
  const loopbackOnly = LOOPBACK_HOSTS.has(parsed.hostname)

  return { baseUrl: trimUrlTrailingSlashes(parsed.href), loopbackOnly }
}

function readServiceFile(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readPort(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535 ? value : null
}

/** Renders the pairing link as a half-block QR code for terminals. */
export function renderPairingQr(link: string): string {
  return renderUnicodeCompact(link, { ecc: 'M', border: 2 })
}

/** Probes `<baseUrl>/api/info` with Basic auth to report reachability and credentials validity. */
export async function probeOpenCodeServer(
  baseUrl: string,
  credentials: PairingCredentials,
  timeoutMs = 3000,
): Promise<OpenCodeServerProbe> {
  const authorization = buildOpenCodeBasicAuth(credentials.password, credentials.username)
  try {
    const response = await fetch(`${trimUrlTrailingSlashes(baseUrl)}/api/info`, {
      headers: { authorization },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) return { status: 'unauthorized' }
    if (!response.ok) return { status: 'unreachable', message: `HTTP ${response.status}` }
    const payload: unknown = await response.json().catch(() => null)
    const version = typeof payload === 'object' && payload !== null && typeof (payload as { version?: unknown }).version === 'string'
      ? (payload as { version: string }).version
      : null
    return { status: 'ok', version }
  } catch (error) {
    return { status: 'unreachable', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Serves the one-shot pairing redeem endpoint on `0.0.0.0` and reports how it ended. */
export async function startPairingServer(options: PairingServerOptions): Promise<PairingServerHandle> {
  const { code, credentials, ttlMs, maxAttempts, port = 0, hostname = '0.0.0.0' } = options

  let settled = false
  let failures = 0
  let resolveDone: (outcome: PairingOutcome) => void = () => {}
  const done = new Promise<PairingOutcome>((resolve) => {
    resolveDone = resolve
  })

  let closePromise: Promise<void> | undefined
  const closeServer = (): Promise<void> => {
    closePromise ??= new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(() => resolve())
    })
    return closePromise
  }

  const timer = setTimeout(() => {
    settle('expired')
  }, ttlMs)

  function settle(outcome: PairingOutcome): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveDone(outcome)
    void closeServer()
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://pairing.local').pathname
    if (settled || pathname !== REDEEM_PATH || request.method !== 'POST') {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    const challenge = readPairingChallenge(await readJsonBody(request))
    if (settled) {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    if (challenge === null) {
      rejectRequest(response, 400, 'invalid pairing request')
      return
    }

    if (!(await verifyOpenCodePairingProof(code, challenge.nonce, challenge.proof))) {
      rejectRequest(response, 401, 'invalid pairing proof')
      return
    }

    let encrypted: OpenCodePairingEncryptedCredentials
    try {
      encrypted = await encryptOpenCodePairingCredentials({ code, nonce: challenge.nonce, credentials })
    } catch {
      sendJson(response, 500, { error: 'pairing encryption failed' })
      return
    }

    if (settled) {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    sendJson(response, 200, encrypted, () => {
      settle('linked')
    })
  }

  function rejectRequest(response: ServerResponse, status: number, error: string): void {
    failures += 1
    sendJson(response, status, { error }, failures >= maxAttempts
      ? () => {
          settle('rejected')
        }
      : undefined)
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(error)
      }
      server.once('error', onError)
      server.listen(port, '0.0.0.0', () => {
        server.off('error', onError)
        resolve()
      })
    })
  } catch (error) {
    clearTimeout(timer)
    throw error
  }

  const address = server.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port

  return {
    url: `http://${hostname}:${boundPort}${REDEEM_PATH}`,
    port: boundPort,
    done,
    close: async () => {
      clearTimeout(timer)
      await closeServer()
    },
  }
}

interface PairingChallenge {
  nonce: string
  proof: string
}

function readPairingChallenge(body: unknown): PairingChallenge | null {
  if (typeof body !== 'object' || body === null) return null
  const { nonce, proof } = body as { nonce?: unknown; proof?: unknown }
  if (!isOpenCodePairingNonce(nonce) || typeof proof !== 'string' || proof.length === 0) return null
  return { nonce, proof }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let finished = false
    const finish = (value: unknown) => {
      if (finished) return
      finished = true
      resolve(value)
    }
    request.on('data', (chunk: Buffer) => {
      if (size > MAX_BODY_BYTES) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(null)
      }
    })
    request.on('error', () => finish(null))
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown, onFlushed?: () => void): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    connection: 'close',
  })
  response.end(payload, onFlushed)
}
