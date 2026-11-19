import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { cloneRawRequest } from 'hono/request'
import { parseJsonText } from '@opencode-manager/shared/utils'
import { z } from 'zod'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeClient } from '../services/opencode/client'

export type OpenCodeProxyClient = Pick<OpenCodeClient, 'forwardRaw'>

export type OpenCodeLifecycleGate = Pick<typeof opencodeServerManager, 'isLifecycleInitialized'>

const RPC_PATH_SEGMENT = '/rpc/'
const RPC_UNAVAILABLE_TYPE = 'rpc.unavailable'
const RPC_WARMUP_RETRY_DELAY_MS = 300

const rpcErrorSchema = z.object({ type: z.string() })

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function isWarmingRpcUnavailable(response: Response): Promise<boolean> {
  if (response.status !== 400) return false
  const body = await response.clone().text()
  const parsed = rpcErrorSchema.safeParse(parseJsonText(body))
  return parsed.success && parsed.data.type === RPC_UNAVAILABLE_TYPE
}

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

    if (!c.req.path.includes(RPC_PATH_SEGMENT)) {
      return openCodeClient.forwardRaw(c.req.raw)
    }

    const retryRequest = await cloneRawRequest(c.req)
    const response = await openCodeClient.forwardRaw(c.req.raw)
    if (!(await isWarmingRpcUnavailable(response))) return response
    await delay(RPC_WARMUP_RETRY_DELAY_MS)
    return openCodeClient.forwardRaw(retryRequest)
  })

  return app
}
