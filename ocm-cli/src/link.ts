import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { renderUnicodeCompact } from 'uqr'

const DEFAULT_OPENCODE_PORT = 4096
const REDEEM_PATH = '/redeem'
const MAX_BODY_BYTES = 4096

export interface PairingCredentials {
  username: string
  password: string
}

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

/** Picks the OpenCode base URL from the first non-internal IPv4 interface, else loopback. */
export function resolveDefaultBaseUrl(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return `http://${entry.address}:${DEFAULT_OPENCODE_PORT}`
      }
    }
  }
  return `http://127.0.0.1:${DEFAULT_OPENCODE_PORT}`
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
  const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/info`, {
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

    const provided = readPairingCode(await readJsonBody(request))
    if (settled) {
      sendJson(response, 404, { error: 'not found' })
      return
    }

    if (provided !== null && codesMatch(provided, code)) {
      sendJson(response, 200, { username: credentials.username, password: credentials.password }, () => {
        settle('linked')
      })
      return
    }

    failures += 1
    sendJson(response, 401, { error: 'invalid pairing code' }, failures >= maxAttempts
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

function codesMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}

function readPairingCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
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
