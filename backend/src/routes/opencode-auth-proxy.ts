import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import {
  decideSandboxMutationBody,
  decideSandboxProxyBlock,
  isSandboxAuthWrite,
  isSandboxConfigMutation,
  isSandboxMcpAdd,
} from '../services/opencode/proxy-policy'
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

    const enforced = opencodeServerManager.isSandboxEnforced()
    const pathSuffix = new URL(c.req.url).pathname.replace(/^\/api\/opencode/, '') || '/'
    const decision = decideSandboxProxyBlock(enforced, c.req.method, pathSuffix)
    if (decision.blocked) {
      return c.json({ error: decision.reason }, 403)
    }
    if (isSandboxConfigMutation(enforced, c.req.method, pathSuffix) || isSandboxMcpAdd(enforced, c.req.method, pathSuffix) || isSandboxAuthWrite(enforced, c.req.method, pathSuffix)) {
      const rawBody = await c.req.text()
      const bodyDecision = decideSandboxMutationBody(enforced, c.req.method, pathSuffix, rawBody)
      if (bodyDecision.kind === 'reject') {
        return c.json({ error: bodyDecision.reason }, 403)
      }
      const headers = new Headers(c.req.raw.headers)
      headers.delete('content-length')
      return openCodeClient.forwardRaw(new Request(c.req.url, {
        method: c.req.method,
        headers,
        body: bodyDecision.kind === 'sanitized' ? bodyDecision.body : rawBody,
      }))
    }
    return openCodeClient.forwardRaw(c.req.raw)
  })

  return app
}
