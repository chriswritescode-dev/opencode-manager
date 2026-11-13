import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'

export type OpenCodeProxyClient = Pick<OpenCodeClient, 'forwardRaw'>

export type OpenCodeLifecycleGate = Pick<typeof opencodeServerManager, 'isLifecycleInitialized'>

export function createAuthenticatedOpenCodeProxyRoutes(
  openCodeClient: OpenCodeProxyClient,
  requireAuth: MiddlewareHandler,
  lifecycleGate: OpenCodeLifecycleGate = opencodeServerManager,
): Hono {
  const app = new Hono()

  app.all('/*', requireAuth, async (c) => {
    if (!lifecycleGate.isLifecycleInitialized()) {
      return c.json({ error: 'OpenCode lifecycle initialization is incomplete; refusing to proxy to an unmanaged server' }, 503)
    }

    return openCodeClient.forwardRaw(c.req.raw)
  })

  return app
}
