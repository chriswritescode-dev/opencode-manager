import { Hono } from 'hono'
import type { OpenCodeClient } from '../../services/opencode/client'
import { getAssistantModeDirectory } from '../../services/assistant-mode'
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

    const directory = getAssistantModeDirectory()
    const response = await openCodeClient.forward({ method: 'POST', path: '/instance/dispose', directory })
    if (!response.ok) {
      return c.json({ error: 'Failed to reload assistant workspace' }, 502)
    }

    return c.json({ success: true })
  })

  return app
}
