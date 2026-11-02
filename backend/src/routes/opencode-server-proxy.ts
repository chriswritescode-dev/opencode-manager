import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { MiddlewareHandler } from 'hono'
import {
  OpenCodeServerError,
  type OpenCodeServerConnection,
  type OpenCodeServerRegistry,
} from '../services/opencode-server-registry'
import { filterProxyHeaders } from '../utils/proxy-headers'
import { forwardProxyRequest, ProxyHeadersTimeoutError } from '../utils/proxy-forward'
import { logger } from '../utils/logger'

const MOUNT_PREFIX = '/api/opencode/servers/'
const REQUEST_EXCLUDED_HEADERS = new Set(['cookie', 'origin', 'referer'])
const RESPONSE_EXCLUDED_HEADERS = new Set(['set-cookie'])
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000

type UpstreamPath = { ok: true; path: string } | { ok: false; status: 400 | 404 }

function decodeSegment(segment: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return null
  }
  try {
    return decodeURIComponent(decoded)
  } catch {
    return decoded
  }
}

function decodePathSegments(path: string): string[] | null {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    const decoded = decodeSegment(segment)
    if (decoded === null) return null
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return null
    segments.push(decoded)
  }
  return segments
}

/**
 * Resolves the upstream path for a request mounted at `/api/opencode/servers`.
 * Only OpenCode API paths are forwardable, and encoded traversal segments are refused.
 */
function resolveUpstreamPath(pathname: string): UpstreamPath {
  const remainder = pathname.slice(MOUNT_PREFIX.length)
  const separator = remainder.indexOf('/')
  const encodedPath = separator === -1 ? '/' : remainder.slice(separator)
  const segments = decodePathSegments(encodedPath)
  if (!segments) return { ok: false, status: 400 }

  const path = segments.join('/')
  return path.startsWith('/api/') ? { ok: true, path } : { ok: false, status: 404 }
}

type UpstreamTarget = { basePath: string; url: URL }

/**
 * Builds the upstream URL for a resolved API path. The returned `basePath` is the
 * connection base path without trailing slashes and is used to bound the final,
 * URL-normalized pathname to the connection's own `/api/` space.
 */
function resolveUpstreamTarget(
  connection: OpenCodeServerConnection,
  path: string,
  search: string,
): UpstreamTarget {
  const url = new URL(connection.baseUrl)
  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}${path}`
  url.search = search
  return { basePath, url }
}

function isWithinUpstreamApiPath(basePath: string, pathname: string): boolean {
  return pathname.startsWith(`${basePath}/api/`)
}

export function createOpenCodeServerProxyRoutes(
  registry: OpenCodeServerRegistry,
  requireAuth: MiddlewareHandler,
  fetchFn: typeof fetch = fetch,
  upstreamHeadersTimeoutMs: number = UPSTREAM_HEADERS_TIMEOUT_MS,
): Hono {
  const app = new Hono()

  app.all('/:serverId/*', requireAuth, async (c) => {
    const url = new URL(c.req.url)
    const upstreamPath = resolveUpstreamPath(url.pathname)
    if (!upstreamPath.ok) {
      return upstreamPath.status === 400
        ? c.json({ error: 'Invalid proxy path' }, 400)
        : c.json({ error: 'Not found' }, 404)
    }

    let connection: OpenCodeServerConnection
    try {
      connection = registry.getConnection(c.req.param('serverId'))
    } catch (error) {
      if (error instanceof OpenCodeServerError) {
        return c.json({ error: error.message }, error.status as ContentfulStatusCode)
      }
      logger.error('Failed to resolve OpenCode server connection', error)
      return c.json({ error: 'Failed to proxy request' }, 500)
    }

    const upstream = resolveUpstreamTarget(connection, upstreamPath.path, url.search)
    if (!isWithinUpstreamApiPath(upstream.basePath, upstream.url.pathname)) {
      return c.json({ error: 'Invalid proxy path' }, 400)
    }

    const headers = filterProxyHeaders(c.req.raw.headers, REQUEST_EXCLUDED_HEADERS)
    if (connection.authorization) {
      headers.Authorization = connection.authorization
    }

    const requestBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
      ? c.req.raw.body
      : null

    try {
      return await forwardProxyRequest({
        url: upstream.url.toString(),
        method: c.req.method,
        headers,
        body: requestBody,
        signal: c.req.raw.signal,
        headersTimeoutMs: requestBody === null ? upstreamHeadersTimeoutMs : undefined,
        fetchFn,
        buildResponseHeaders: (upstreamHeaders) => new Headers(
          filterProxyHeaders(upstreamHeaders, RESPONSE_EXCLUDED_HEADERS),
        ),
      })
    } catch (error) {
      if (error instanceof ProxyHeadersTimeoutError) {
        logger.warn(`OpenCode server proxy timed out waiting for headers: ${c.req.method} ${upstream.url.host}${upstreamPath.path}`, error)
        return c.json({ error: 'Remote OpenCode server timed out' }, 504)
      }
      logger.warn(`OpenCode server proxy request failed: ${c.req.method} ${upstream.url.host}${upstreamPath.path}`, error)
      return c.json({ error: 'Remote OpenCode server unreachable' }, 502)
    }
  })

  return app
}
