import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { createInternalTokenMiddleware } from '../auth/internal-token-middleware'
import type { SettingsService } from '../services/settings'
import { opencodeServerManager } from '../services/opencode-single-server'
import { getOpenCodeUpstreamBaseUrl } from '../services/opencode/upstream'
import {
  decideSandboxMutationBody,
  decideSandboxProxyBlock,
  isSandboxAuthWrite,
  isSandboxConfigMutation,
  isSandboxMcpAdd,
} from '../services/opencode/proxy-policy'

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
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    const connectionHeader = c.req.header('connection')?.toLowerCase() ?? ''
    const upgradeHeader = c.req.header('upgrade')?.toLowerCase() ?? ''
    if (connectionHeader.includes('upgrade') && upgradeHeader === 'websocket') {
      return c.json({ error: 'WebSocket proxying is not supported' }, 501)
    }

    const url = new URL(c.req.url)
    const pathSuffix = url.pathname.replace(/^\/api\/opencode-proxy/, '') || '/'
    const enforced = opencodeServerManager.isSandboxEnforced()
    const decision = decideSandboxProxyBlock(enforced, c.req.method, pathSuffix)
    if (decision.blocked) {
      return c.json({ error: decision.reason }, 403)
    }
    const upstreamUrl = `${getOpenCodeUpstreamBaseUrl(enforced)}${pathSuffix}${url.search}`

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
      if (isSandboxConfigMutation(enforced, c.req.method, pathSuffix) || isSandboxMcpAdd(enforced, c.req.method, pathSuffix) || isSandboxAuthWrite(enforced, c.req.method, pathSuffix)) {
        const rawBody = await c.req.text()
        const bodyDecision = decideSandboxMutationBody(enforced, c.req.method, pathSuffix, rawBody)
        if (bodyDecision.kind === 'reject') {
          return c.json({ error: bodyDecision.reason }, 403)
        }
        requestBody = bodyDecision.kind === 'sanitized' ? bodyDecision.body : rawBody
      } else {
        requestBody = c.req.raw.body
      }
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
