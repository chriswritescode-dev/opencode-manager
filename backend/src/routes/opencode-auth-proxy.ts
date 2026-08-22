import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'

export function createAuthenticatedOpenCodeProxyRoutes(
  openCodeClient: OpenCodeClient,
  requireAuth: MiddlewareHandler,
): Hono {
  const app = new Hono()

  app.all('/*', requireAuth, async (c) => {
    if (!opencodeServerManager.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    return openCodeClient.forwardRaw(c.req.raw)
  })

  return app
}
