import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { MiddlewareHandler } from 'hono'
import {
  OpenCodeServerError,
  type OpenCodeServerConnection,
  type OpenCodeServerRegistry,
} from '../services/opencode-server-registry'
import { filterProxyHeaders } from '../utils/proxy-headers'
import { logger } from '../utils/logger'

const MOUNT_PREFIX = '/api/opencode/servers/'
const REQUEST_EXCLUDED_HEADERS = new Set(['cookie', 'origin', 'referer'])
const RESPONSE_EXCLUDED_HEADERS = new Set(['set-cookie'])
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

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

function buildUpstreamUrl(connection: OpenCodeServerConnection, path: string, search: string): URL {
  const url = new URL(connection.baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  url.search = search
  return url
}

export function createOpenCodeServerProxyRoutes(
  registry: OpenCodeServerRegistry,
  requireAuth: MiddlewareHandler,
  fetchFn: typeof fetch = fetch,
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

    const headers = filterProxyHeaders(c.req.raw.headers, REQUEST_EXCLUDED_HEADERS)
    if (connection.authorization) {
      headers.Authorization = connection.authorization
    }

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    const upstreamUrl = buildUpstreamUrl(connection, upstreamPath.path, url.search)

    try {
      const upstreamResponse = await fetchFn(upstreamUrl.toString(), {
        method: c.req.method,
        headers,
        body: hasBody ? c.req.raw.body : undefined,
        redirect: 'manual',
        signal: c.req.raw.signal,
        duplex: 'half',
      })

      const responseHeaders = new Headers(
        filterProxyHeaders(upstreamResponse.headers, RESPONSE_EXCLUDED_HEADERS),
      )
      const responseBody = NULL_BODY_STATUSES.has(upstreamResponse.status)
        ? null
        : upstreamResponse.body

      return new Response(responseBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      logger.warn(`OpenCode server proxy request failed: ${c.req.method} ${upstreamUrl.host}${upstreamPath.path}`, error)
      return c.json({ error: 'Remote OpenCode server unreachable' }, 502)
    }
  })

  return app
}
