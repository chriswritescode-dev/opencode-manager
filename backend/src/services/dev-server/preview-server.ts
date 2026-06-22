import { serve, type ServerType } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import type { Database } from 'bun:sqlite'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import net from 'net'
import { ENV } from '@opencode-manager/shared/config/env'
import type { AuthInstance } from '../../auth'
import { getDevServerPort } from './manager'
import { buildUpstreamUrl, filterProxyHeaders, sanitizeUpstreamResponseHeaders } from './proxy-utils'
import { logger } from '../../utils/logger'

function getUnauthorizedHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in required</title></head>
<body>
<h1>Sign in required</h1>
<p>Open the preview from an authenticated OpenCode Manager session.</p>
</body>
</html>`
}

function getNotRunningHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Dev Server Not Running</title></head>
<body>
<h1>Dev Server Not Running</h1>
<p>No development server responded on localhost:${port}.</p>
</body>
</html>`
}

async function hasValidSession(auth: AuthInstance, headers: Headers): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers })
    return Boolean(session)
  } catch {
    return false
  }
}

async function handlePreviewRequest(c: Context, auth: AuthInstance, db: Database): Promise<Response> {
  if (!(await hasValidSession(auth, c.req.raw.headers))) {
    return c.html(getUnauthorizedHtml(), 401)
  }

  const port = getDevServerPort(db)
  const url = new URL(c.req.url)
  const upstreamUrl = buildUpstreamUrl(port, url.pathname, url.search)

  const headers = filterProxyHeaders(c.req.raw.headers)
  let body: RequestInit['body'] = undefined
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    body = c.req.raw.body
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body,
      redirect: 'manual',
      duplex: 'half',
    } as RequestInit)
  } catch {
    return c.html(getNotRunningHtml(port), 503)
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: sanitizeUpstreamResponseHeaders(upstreamResponse.headers),
  })
}

export function buildPreviewUpgradeRequest(rawHead: string, port: number): string {
  const lines = rawHead.split('\r\n')
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return rawHead

  const result: string[] = [lines[0]!]
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1 && line.slice(0, colonIdx).trim().toLowerCase() === 'host') continue
    result.push(line)
  }
  result.push(`Host: 127.0.0.1:${port}`)
  return result.join('\r\n')
}

function nodeHeadersToWebHeaders(reqHeaders: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

function rawHeadFromRequest(req: IncomingMessage): string {
  const lines: string[] = [`${req.method} ${req.url} HTTP/1.1`]
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) lines.push(`${key}: ${v}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  return lines.join('\r\n')
}

function createPreviewUpgradeHandler(auth: AuthInstance, db: Database) {
  return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      if (!(await hasValidSession(auth, nodeHeadersToWebHeaders(req.headers)))) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
        socket.destroy()
        return
      }

      const port = getDevServerPort(db)
      const upstreamRequest = buildPreviewUpgradeRequest(rawHeadFromRequest(req), port)
      const upstream = net.connect(port, '127.0.0.1')

      upstream.on('connect', () => {
        upstream.write(`${upstreamRequest}\r\n\r\n`)
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
      })

      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.on('close', () => socket.destroy())
    } catch (error) {
      logger.error('Dev preview upgrade handler error:', error)
      socket.destroy()
    }
  }
}

export function startPreviewServer(auth: AuthInstance, db: Database): ServerType {
  const app = new Hono()
  app.all('/*', (c) => handlePreviewRequest(c, auth, db))

  const server = serve({
    fetch: app.fetch,
    port: ENV.DEV_PREVIEW.PORT,
    hostname: ENV.SERVER.HOST,
  })

  server.on('upgrade', createPreviewUpgradeHandler(auth, db))
  return server
}
