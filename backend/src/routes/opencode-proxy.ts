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
  withDefaultOpenCodeDirectory,
} from '../services/opencode/upstream'
import { getRepoById } from '../db/queries'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { isPathWithinRoot } from '../services/sandbox/command'
import { buildProxyResponseHeaders, filterProxyHeaders } from '../utils/proxy-headers'
import { bridgeWebSocket, forwardPeerMessage, peerBufferedAmount, type WebSocketBridge } from '../utils/websocket-bridge'

const PROXY_PREFIX = /^\/api\/opencode-proxy(?:\/repos\/[^/]+)?/
const PTY_CONNECT_PATH = /^\/api\/(?:pty|experimental\/persistent-pty)\/[^/]+\/connect$/

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

function isWebSocketUpgrade(c: Context): boolean {
  return (c.req.header('connection')?.toLowerCase() ?? '').includes('upgrade')
    && c.req.header('upgrade')?.toLowerCase() === 'websocket'
}

/**
 * Matches OpenCode's ticketed PTY socket connects. WebSocket clients cannot send an
 * Authorization header, so these rely on the single-use ticket minted through the
 * authenticated proxy and validated by the upstream server.
 */
function isTicketedPtyConnect(pathSuffix: string, searchParams: URLSearchParams): boolean {
  return PTY_CONNECT_PATH.test(pathSuffix) && !!searchParams.get('ticket')
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
    const isTicketedSocket = isWebSocketUpgrade(c)
      && isTicketedPtyConnect(c.req.path.replace(PROXY_PREFIX, ''), new URL(c.req.url).searchParams)
    return isTicketedSocket ? next() : requireInternalToken(c, next)
  })

  async function proxyPtySocket(c: Context, pathSuffix: string, search: string): Promise<Response> {
    const upstreamUrl = `${getOpenCodeUpstreamBaseUrl().replace(/^http/, 'ws')}${pathSuffix}${search}`
    let bridge: WebSocketBridge | undefined

    const upgrade = upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        bridge = bridgeWebSocket(new WebSocket(upstreamUrl), {
          send: (data) => ws.send(data),
          close: (code, reason) => ws.close(code, reason),
          bufferedAmount: () => peerBufferedAmount(ws),
        })
      },
      async onMessage(event) {
        if (!bridge) return
        await forwardPeerMessage(bridge, event.data)
      },
      onClose() {
        bridge?.close()
      },
    }))

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

    const url = new URL(c.req.url)
    const isUpgrade = isWebSocketUpgrade(c)
    if (isUpgrade && !isTicketedPtyConnect(pathSuffix, url.searchParams)) {
      return c.json({ error: 'WebSocket proxying is only supported for ticketed PTY connects' }, 501)
    }

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'

    const forwardedHeaders = filterProxyHeaders(c.req.raw.headers)
    const headers = withDefaultOpenCodeDirectory(forwardedHeaders)

    headers['Authorization'] = buildOpenCodeBasicAuth(settingsService.getOpenCodeServerPassword())

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

    if (isUpgrade) {
      if (!url.searchParams.has('location[directory]')) {
        url.searchParams.set('location[directory]', decodeDirectoryHeader(headers[OPENCODE_DIRECTORY_HEADER]) ?? getWorkspacePath())
      }
      return proxyPtySocket(c, pathSuffix, url.search)
    }

    const isJson = isJsonContentType(headers['content-type'] ?? headers['Content-Type'])
    const shouldBufferBody = rewriteBody !== undefined && hasBody && isJson
    const rawBody = shouldBufferBody ? await c.req.arrayBuffer() : undefined

    let requestBody: RequestInit['body'] = hasBody ? c.req.raw.body : undefined

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
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy\/repos\/[^/]+/, '') || '/'
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
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy/, '') || '/'

    return forwardToOpenCode(c, pathSuffix)
  })

  return app
}
