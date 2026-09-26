import { Hono } from 'hono'
import type { Context } from 'hono'
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

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
  'authorization',
])

interface ProxyRequestParts {
  method: string
  path: string
  headers: Record<string, string>
  searchParams: URLSearchParams
}

type ProxyRewrite = (parts: ProxyRequestParts) => void

type ProxyBodyRewrite = (bodyText: string) => string | undefined

function isJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? '').toLowerCase().includes('application/json')
}

function rewriteRepoLocation(parts: ProxyRequestParts, directory: string): void {
  parts.headers[OPENCODE_DIRECTORY_HEADER] = encodeURIComponent(directory)

  if (parts.searchParams.has('location[directory]')) {
    parts.searchParams.set('location[directory]', directory)
  }

  if (parts.method === 'GET' && parts.path === '/api/session') {
    parts.searchParams.set('directory', directory)
  }
}

function rewriteRepoLocationBody(bodyText: string, directory: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined

  const location = (parsed as { location?: unknown }).location
  if (!location || typeof location !== 'object' || Array.isArray(location)) return undefined

  ;(parsed as { location: Record<string, unknown> }).location = { ...location, directory }
  return JSON.stringify(parsed)
}

export function createOpenCodeProxyRoutes(db: Database, settingsService: SettingsService) {
  const app = new Hono()

  app.use('/*', createInternalTokenMiddleware(db))

  async function forwardToOpenCode(
    c: Context,
    pathSuffix: string,
    rewrite?: ProxyRewrite,
    rewriteBody?: ProxyBodyRewrite,
  ): Promise<Response> {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    const connectionHeader = c.req.header('connection')?.toLowerCase() ?? ''
    const upgradeHeader = c.req.header('upgrade')?.toLowerCase() ?? ''
    if (connectionHeader.includes('upgrade') && upgradeHeader === 'websocket') {
      return c.json({ error: 'WebSocket proxying is not supported' }, 501)
    }

    const url = new URL(c.req.url)
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'

    const forwardedHeaders: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
        forwardedHeaders[key] = value
      }
    })
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

      const responseHeaders: Record<string, string> = {}
      upstreamResponse.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase()
        if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
          responseHeaders[key] = value
        }
      })

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

    return forwardToOpenCode(
      c,
      pathSuffix,
      (parts) => rewriteRepoLocation(parts, repo.fullPath),
      (bodyText) => rewriteRepoLocationBody(bodyText, repo.fullPath),
    )
  })

  app.all('/*', async (c) => {
    const url = new URL(c.req.url)
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy/, '') || '/'

    return forwardToOpenCode(c, pathSuffix)
  })

  return app
}
