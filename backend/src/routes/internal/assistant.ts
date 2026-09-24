import { Hono } from 'hono'
import type { OpenCodeClient } from '../../services/opencode/client'
import { logger } from '../../utils/logger'
import { TokenBucketRateLimiter } from '../../utils/rate-limit'

export function createInternalAssistantRoutes(openCodeClient: OpenCodeClient) {
  const app = new Hono()
  const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerMs: 60_000 })

  app.post('/reload', async (c) => {
    const token = (c.req.header('authorization') ?? '').slice('Bearer '.length)
    const limit = limiter.tryConsume(token || 'anon')
    if (!limit.allowed) {
      c.header('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)))
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    try {
      await openCodeClient.api.location.reload()
    } catch (error) {
      logger.error('Failed to reload assistant workspace:', error)
      return c.json({ error: 'Failed to reload assistant workspace' }, 502)
    }

    return c.json({ success: true })
  })

  return app
}
