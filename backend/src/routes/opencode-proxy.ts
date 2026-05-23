import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import type { SettingsService } from '../services/settings'

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

export function createOpenCodeProxyRoutes(db: Database, settingsService: SettingsService) {
  const app = new Hono()

  app.use('/*', createInternalTokenMiddleware(db))

  app.all('/*', async (c) => {
    const connectionHeader = c.req.header('connection')?.toLowerCase() ?? ''
    const upgradeHeader = c.req.header('upgrade')?.toLowerCase() ?? ''
    if (connectionHeader.includes('upgrade') && upgradeHeader === 'websocket') {
      return c.json({ error: 'WebSocket proxying is not supported' }, 501)
    }

    const url = new URL(c.req.url)
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy/, '') || '/'
    const upstreamUrl = `http://127.0.0.1:${ENV.OPENCODE.PORT}${pathSuffix}${url.search}`

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
        headers[key] = value
      }
    })

    const password = settingsService.getOpenCodeServerPassword()
    const username = ENV.OPENCODE.SERVER_USERNAME
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

    let requestBody: RequestInit['body'] = undefined
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      requestBody = c.req.raw.body
    }

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
  })

  return app
}
