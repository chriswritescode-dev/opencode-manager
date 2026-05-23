import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import type { RepoOpenCodeTargetManager } from '../services/opencode/repo-target-manager'
import { verifyRepoTargetToken } from '../services/opencode/repo-target-token'

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
])

export function createOpenCodeTargetProxyRoutes(db: Database, targetManager: RepoOpenCodeTargetManager) {
  const app = new Hono()

  app.all('/repo/:repoId/*', async (c) => {
    const repoIdParam = c.req.param('repoId')
    const repoId = Number(repoIdParam)

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    const authHeader = c.req.header('Authorization') ?? c.req.header('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice(7)
    const verified = verifyRepoTargetToken(token)
    if (!verified || verified.repoId !== repoId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const connectionHeader = c.req.header('connection')?.toLowerCase() ?? ''
    const upgradeHeader = c.req.header('upgrade')?.toLowerCase() ?? ''
    if (connectionHeader.includes('upgrade') && upgradeHeader === 'websocket') {
      return c.json({ error: 'WebSocket proxying is not supported' }, 501)
    }

    let target = targetManager.getTarget(repoId)
    if (!target) {
      return c.json({ error: 'Target not started' }, 503)
    }

    if (target.state !== 'healthy') {
      const ready = await targetManager.awaitReady(repoId)
      if (!ready) {
        return c.json({ error: 'Target not available' }, 503)
      }
      target = targetManager.getTarget(repoId)
      if (!target || target.state !== 'healthy' || !target.process) {
        return c.json({ error: 'Target not available' }, 503)
      }
    }

    const url = new URL(c.req.url)
    const pathAfterRepo = url.pathname.replace(`/api/opencode-targets/repo/${repoId}`, '') || '/'

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!HOP_BY_HOP_HEADERS.has(lowerKey) && lowerKey !== 'authorization') {
        headers[key] = value
      }
    })

    headers['Authorization'] = `Basic ${Buffer.from(`opencode:${target.token}`).toString('base64')}`

    const upstreamUrl = `http://127.0.0.1:${target.port}${pathAfterRepo}${url.search}`

    const requestBody = c.req.method !== 'GET' && c.req.method !== 'HEAD'
      ? await c.req.raw.text()
      : undefined

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body: requestBody,
      })

      const responseHeaders: Record<string, string> = {}
      upstreamResponse.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase()
        if (!HOP_BY_HOP_HEADERS.has(lowerKey)) {
          responseHeaders[key] = value
        }
      })

      const noBodyStatuses = new Set([101, 204, 205, 304])
      if (noBodyStatuses.has(upstreamResponse.status)) {
        return new Response(null, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        })
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      logger.error(`Proxy request failed for repo ${repoId}:`, error)
      return c.json({ error: 'Proxy request failed' }, 502)
    }
  })

  return app
}
