import { Hono } from 'hono'
import type { Context } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import type { Database } from 'bun:sqlite'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import type { SettingsService } from '../services/settings'
import { opencodeServerManager } from '../services/opencode-single-server'
import {
  getOpenCodeUpstreamBaseUrl,
  OPENCODE_DIRECTORY_HEADER,
  toWebSocketUrl,
  withDefaultOpenCodeDirectory,
} from '../services/opencode/upstream'
import { getRepoById } from '../db/queries'
import { getTrustedOrigins, getWorkspacePath } from '@opencode-manager/shared/config/env'
import { isPathWithinRoot } from '../services/sandbox/command'
import { buildProxyResponseHeaders, filterProxyHeaders } from '../utils/proxy-headers'
import {
  connectUpstreamWebSocket,
  createBridgedSocketEvents,
  isAllowedUpgradeOrigin,
  type PendingUpstream,
} from '../utils/websocket-bridge'

const PROXY_PREFIX = /^\/api\/opencode-proxy(?:\/repos\/[^/]+)?/
const PERSISTENT_PTY_CONNECT_PATH = /^\/api\/experimental\/persistent-pty\/[^/]+\/connect$/

interface ProxyRequestParts {
  method: string
  path: string
  headers: Record<string, string>
  searchParams: URLSearchParams
}

type ProxyRewrite = (parts: ProxyRequestParts) => void

type ProxyBodyRewrite = (bodyText: string) => string | undefined

type RepoDirectoryResolver = (directory: string | null | undefined) => string

function isJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? '').toLowerCase().includes('application/json')
}

function stripProxyPrefix(pathname: string): string {
  return pathname.replace(PROXY_PREFIX, '') || '/'
}

function isWebSocketUpgrade(c: Context): boolean {
  return (c.req.header('connection')?.toLowerCase() ?? '').includes('upgrade')
    && c.req.header('upgrade')?.toLowerCase() === 'websocket'
}

/**
 * Matches OpenCode's ticketed persistent PTY socket connects. WebSocket clients cannot
 * send an Authorization header, so these rely on the single-use ticket minted through the
 * authenticated proxy and validated by the upstream server. Only persistent PTY connects
 * are ticketed; OpenCode's /api/pty route builds per-directory services before it can
 * validate a ticket, so it must never bypass the internal token.
 */
function isTicketedPersistentPtyConnect(pathSuffix: string, searchParams: URLSearchParams): boolean {
  return PERSISTENT_PTY_CONNECT_PATH.test(pathSuffix) && !!searchParams.get('ticket')
}

function decodeDirectoryHeader(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Keeps a directory the Manager's OpenCode server owns (repos, OpenCode and schedule
 * worktrees, all under the workspace) and maps anything else, such as the attaching
 * client's local cwd, to the bound repo.
 */
function createRepoDirectoryResolver(repoPath: string): RepoDirectoryResolver {
  return (directory) => (directory && isPathWithinRoot(getWorkspacePath(), directory) ? directory : repoPath)
}

function rewriteRepoLocation(parts: ProxyRequestParts, directory: string, resolveDirectory: RepoDirectoryResolver): void {
  parts.headers[OPENCODE_DIRECTORY_HEADER] = encodeURIComponent(directory)

  if (parts.searchParams.has('location[directory]')) {
    parts.searchParams.set('location[directory]', directory)
  }

  if (parts.method === 'GET' && parts.path === '/api/session' && parts.searchParams.has('directory')) {
    parts.searchParams.set('directory', resolveDirectory(parts.searchParams.get('directory')))
  }
}

function rewriteRepoLocationBody(bodyText: string, resolveDirectory: RepoDirectoryResolver): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined

  const location = (parsed as { location?: unknown }).location
  if (!location || typeof location !== 'object' || Array.isArray(location)) return undefined

  const requested = (location as { directory?: unknown }).directory
  const directory = resolveDirectory(typeof requested === 'string' ? requested : undefined)
  ;(parsed as { location: Record<string, unknown> }).location = { ...location, directory }
  return JSON.stringify(parsed)
}

export function createOpenCodeProxyRoutes(db: Database, settingsService: SettingsService, upgradeWebSocket: UpgradeWebSocket) {
  const app = new Hono()
  const requireInternalToken = createInternalTokenMiddleware(db)

  app.use('/*', (c, next) => {
    const url = new URL(c.req.url)
    const isTicketedSocket = isWebSocketUpgrade(c)
      && isTicketedPersistentPtyConnect(stripProxyPrefix(url.pathname), url.searchParams)
    return isTicketedSocket ? proxyTicketedPtySocket(c, url) : requireInternalToken(c, next)
  })

  async function proxyTicketedPtySocket(c: Context, url: URL): Promise<Response> {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    if (!isAllowedUpgradeOrigin(c.req.header('origin'), getTrustedOrigins())) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    const pathSuffix = stripProxyPrefix(url.pathname)
    let pending: PendingUpstream
    try {
      pending = await connectUpstreamWebSocket(toWebSocketUrl(`${getOpenCodeUpstreamBaseUrl()}${pathSuffix}${url.search}`))
    } catch {
      return c.json({ error: 'PTY connection rejected' }, 403)
    }

    const upgrade = upgradeWebSocket(() => createBridgedSocketEvents((peer) => pending.attach(peer)))
    return (await upgrade(c, async () => {})) ?? c.body(null)
  }

  async function forwardToOpenCode(
    c: Context,
    pathSuffix: string,
    rewrite?: ProxyRewrite,
    rewriteBody?: ProxyBodyRewrite,
  ): Promise<Response> {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    if (isWebSocketUpgrade(c)) {
      return c.json({ error: 'WebSocket proxying is only supported for ticketed persistent PTY connects' }, 501)
    }

    const url = new URL(c.req.url)
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'

    const forwardedHeaders = filterProxyHeaders(c.req.raw.headers)
    const headers = withDefaultOpenCodeDirectory(forwardedHeaders)

    headers['Authorization'] = buildOpenCodeBasicAuth(settingsService.getOpenCodeServerPassword())

    const isJson = isJsonContentType(headers['content-type'] ?? headers['Content-Type'])
    const shouldBufferBody = rewriteBody !== undefined && hasBody && isJson
    const rawBody = shouldBufferBody ? await c.req.arrayBuffer() : undefined

    let requestBody: RequestInit['body'] = hasBody ? c.req.raw.body : undefined

    if (rewrite) {
      const parts: ProxyRequestParts = {
        method: c.req.method,
        path: pathSuffix,
        headers,
        searchParams: url.searchParams,
      }
      rewrite(parts)
      url.search = parts.searchParams.toString()
    }

    if (rewriteBody && rawBody !== undefined) {
      const bodyText = rawBody.byteLength > 0 ? new TextDecoder().decode(rawBody) : undefined
      const rewrittenBody = bodyText === undefined ? undefined : rewriteBody(bodyText)
      requestBody = rewrittenBody === undefined ? rawBody : rewrittenBody
    }

    const upstreamUrl = `${getOpenCodeUpstreamBaseUrl()}${pathSuffix}${url.search}`

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body: requestBody,
        redirect: 'manual',
        duplex: 'half',
      })

      const responseHeaders = buildProxyResponseHeaders(upstreamResponse.headers)

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch {
      return c.json({ error: 'Proxy request failed' }, 502)
    }
  }

  app.all('/repos/:repoId/*', async (c) => {
    const repoId = Number(c.req.param('repoId'))
    const repo = Number.isInteger(repoId) ? getRepoById(db, repoId) : null
    if (!repo || repo.cloneStatus !== 'ready') {
      return c.json({ error: 'Repo not found' }, 404)
    }

    const url = new URL(c.req.url)
    const pathSuffix = stripProxyPrefix(url.pathname)
    const resolveDirectory = createRepoDirectoryResolver(repo.fullPath)
    const directory = resolveDirectory(
      url.searchParams.get('location[directory]') || decodeDirectoryHeader(c.req.header(OPENCODE_DIRECTORY_HEADER)),
    )

    return forwardToOpenCode(
      c,
      pathSuffix,
      (parts) => rewriteRepoLocation(parts, directory, resolveDirectory),
      (bodyText) => rewriteRepoLocationBody(bodyText, resolveDirectory),
    )
  })

  app.all('/*', async (c) => {
    const url = new URL(c.req.url)
    const pathSuffix = stripProxyPrefix(url.pathname)

    return forwardToOpenCode(c, pathSuffix)
  })

  return app
}
