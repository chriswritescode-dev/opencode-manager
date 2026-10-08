import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import type { PreviewPort } from '@opencode-manager/shared/schemas'
import { AUTH_COOKIE_PREFIX } from '../../auth/cookies'
import { buildProxyResponseHeaders, filterProxyHeaders } from '../../utils/proxy-headers'
import { bridgeWebSocket, createBridgedSocketEvents } from '../../utils/websocket-bridge'

export const PREVIEW_COOKIE = 'ocm_preview'

const START_TOKEN_TTL_MS = 60_000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

const MANAGER_COOKIE_PREFIXES = [
  `${AUTH_COOKIE_PREFIX}.`,
  `__Secure-${AUTH_COOKIE_PREFIX}.`,
  `__Host-${AUTH_COOKIE_PREFIX}.`,
]

export type PreviewHost = PreviewPort['host']

export interface PreviewSession {
  id: string
  port: number
  host: PreviewHost
  expiresAt: number
}

interface StartToken {
  port: number
  host: PreviewHost
  expiresAt: number
}

export interface PreviewSessionStoreOptions {
  now?: () => number
  randomToken?: () => string
}

export class PreviewSessionStore {
  private readonly startTokens = new Map<string, StartToken>()
  private readonly sessions = new Map<string, PreviewSession>()
  private readonly now: () => number
  private readonly randomToken: () => string

  constructor(options: PreviewSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
  }

  issueStartToken(target: { port: number; host: PreviewHost }): string {
    this.prune()
    const token = this.randomToken()
    this.startTokens.set(token, { port: target.port, host: target.host, expiresAt: this.now() + START_TOKEN_TTL_MS })
    return token
  }

  consumeStartToken(token: string): string | null {
    this.prune()
    const entry = this.startTokens.get(token)
    if (!entry) return null
    this.startTokens.delete(token)
    const id = this.randomToken()
    this.sessions.set(id, { id, port: entry.port, host: entry.host, expiresAt: this.now() + SESSION_TTL_MS })
    return id
  }

  getSession(id: string): PreviewSession | undefined {
    this.prune()
    return this.sessions.get(id)
  }

  private prune(): void {
    const now = this.now()
    for (const [token, entry] of this.startTokens) {
      if (entry.expiresAt <= now) this.startTokens.delete(token)
    }
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id)
    }
  }
}

function readCookieName(cookie: string): string {
  const separator = cookie.indexOf('=')
  return (separator === -1 ? cookie : cookie.slice(0, separator)).trim()
}

function isManagerCookieName(name: string): boolean {
  return name === PREVIEW_COOKIE || MANAGER_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function stripManagerCookies(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  const kept = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isManagerCookieName(readCookieName(part)))
  return kept.length > 0 ? kept.join('; ') : undefined
}

function stripPreviewSetCookies(headers: Headers): void {
  const kept = headers.getSetCookie().filter((cookie) => !isManagerCookieName(readCookieName(cookie)))
  headers.delete('set-cookie')
  for (const cookie of kept) {
    headers.append('set-cookie', cookie)
  }
}

function readPreviewCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    if (trimmed.slice(0, separator) === PREVIEW_COOKIE) {
      return trimmed.slice(separator + 1)
    }
  }
  return null
}

function htmlResponse(status: number, message: string): Response {
  return new Response(`<!doctype html><html><body><p>${message}</p></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function rewriteLocalLocation(location: string, port: number): string | null {
  let parsed: URL
  try {
    parsed = new URL(location)
  } catch {
    return null
  }
  const isLocalHost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1'
  if (!isLocalHost) return null
  const locationPort = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 80
  if (locationPort !== port) return null
  return `${parsed.pathname}${parsed.search}`
}

export interface PreviewGateway {
  app: Hono
  injectWebSocket: NodeWebSocket['injectWebSocket']
}

function isWebSocketUpgrade(c: Context): boolean {
  return c.req.header('upgrade')?.toLowerCase() === 'websocket'
}

function upstreamWebSocketUrl(session: PreviewSession, requestUrl: URL): string {
  return `${previewUpstreamOrigin(session, 'ws')}${requestUrl.pathname}${requestUrl.search}`
}

function previewUpstreamOrigin(session: PreviewSession, protocol: 'http' | 'ws'): string {
  const targetHost = session.host === '::1' ? '[::1]' : 'localhost'
  return `${protocol}://${targetHost}:${session.port}`
}

function resolveRedirectPath(requestUrl: URL, requestedPath: string): string {
  if (!requestedPath) return '/'
  let resolved: URL
  try {
    resolved = new URL(requestedPath, requestUrl)
  } catch {
    return '/'
  }
  if (resolved.origin !== requestUrl.origin) return '/'
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

function parseProtocols(header: string | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0)
}

export function createPreviewGatewayApp(store: PreviewSessionStore, fetchFn: typeof fetch = fetch): PreviewGateway {
  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.get('/__ocm_preview/start', (c) => {
    const sessionId = store.consumeStartToken(c.req.query('token') ?? '')
    if (!sessionId) {
      return htmlResponse(401, 'Preview session is invalid or expired.')
    }

    const requestedPath = c.req.query('path') ?? ''
    const requestUrl = new URL(c.req.url)
    const location = resolveRedirectPath(requestUrl, requestedPath)

    const forwardedProto = c.req.header('x-forwarded-proto')?.toLowerCase()
    const isSecure = forwardedProto === 'https' || requestUrl.protocol === 'https:'
    const cookie = `${PREVIEW_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/${isSecure ? '; Secure' : ''}`

    return new Response(null, { status: 302, headers: { location, 'set-cookie': cookie } })
  })

  const sessionGuard: MiddlewareHandler = async (c, next) => {
    if (!isWebSocketUpgrade(c)) {
      await next()
      return
    }
    const sessionId = readPreviewCookie(c.req.header('cookie'))
    if (!sessionId || !store.getSession(sessionId)) {
      return htmlResponse(401, 'Preview session expired. Reopen it from OpenCode Manager.')
    }
    await next()
  }

  app.get(
    '/*',
    sessionGuard,
    upgradeWebSocket((c) => {
      const requestUrl = new URL(c.req.url)
      const protocols = parseProtocols(c.req.header('sec-websocket-protocol'))

      return createBridgedSocketEvents((peer) => {
        const sessionId = readPreviewCookie(c.req.header('cookie'))
        const session = sessionId ? store.getSession(sessionId) : undefined
        if (!session) {
          throw new Error('Preview session expired. Reopen it from OpenCode Manager.')
        }

        const upstream = new WebSocket(
          upstreamWebSocketUrl(session, requestUrl),
          protocols.length > 0 ? protocols : undefined,
        )
        return bridgeWebSocket(upstream, peer)
      })
    }),
  )

  app.all('/*', async (c) => {
    const cookieHeader = c.req.header('cookie')
    const sessionId = readPreviewCookie(cookieHeader)
    const session = sessionId ? store.getSession(sessionId) : undefined
    if (!session) {
      return htmlResponse(401, 'Preview session expired. Reopen it from OpenCode Manager.')
    }

    const url = new URL(c.req.url)
    const target = `${previewUpstreamOrigin(session, 'http')}${url.pathname}${url.search}`

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'

    const headers = filterProxyHeaders(c.req.raw.headers)
    const contentEncoding = hasBody ? c.req.header('content-encoding') : undefined
    if (contentEncoding) {
      headers['content-encoding'] = contentEncoding
    }
    headers['host'] = `localhost:${session.port}`
    headers['accept-encoding'] = 'identity'
    const strippedCookies = stripManagerCookies(cookieHeader)
    if (strippedCookies) {
      headers['cookie'] = strippedCookies
    } else {
      delete headers['cookie']
    }
    headers['x-forwarded-host'] = c.req.header('host') ?? ''
    headers['x-forwarded-proto'] = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')

    try {
      const upstreamResponse = await fetchFn(target, {
        method: c.req.method,
        headers,
        body: hasBody ? c.req.raw.body : undefined,
        redirect: 'manual',
        duplex: 'half',
      })

      const responseHeaders = buildProxyResponseHeaders(upstreamResponse.headers)
      stripPreviewSetCookies(responseHeaders)
      const location = responseHeaders.get('location')
      if (location) {
        const rewritten = rewriteLocalLocation(location, session.port)
        if (rewritten) responseHeaders.set('location', rewritten)
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch {
      return htmlResponse(502, `Preview request failed: cannot reach port ${session.port}.`)
    }
  })

  return { app, injectWebSocket }
}
