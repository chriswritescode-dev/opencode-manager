import { Server } from 'node:http'
import { z } from 'zod'
import type { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import type { ServerType } from '@hono/node-server'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'

const BoundPortSchema = z.object({ port: z.number() })

export interface StartWebSocketServerOptions {
  app: Hono<any, any, any>
  register?: (app: Hono, upgradeWebSocket: UpgradeWebSocket) => void
  injectWebSocket?: (server: Server) => void
}

export interface WebSocketTestServer {
  server: Server
  port: number
  close: () => Promise<void>
}

export async function startWebSocketServer(options: StartWebSocketServerOptions): Promise<WebSocketTestServer> {
  const owned = options.injectWebSocket ? undefined : createNodeWebSocket({ app: options.app })
  if (owned && options.register) {
    options.register(options.app, owned.upgradeWebSocket)
  }
  const started = await new Promise<ServerType>((resolve) => {
    const serving = serve({ fetch: options.app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(serving))
  })
  const server = z.instanceof(Server).parse(started)
  const injectWebSocket = options.injectWebSocket ?? owned?.injectWebSocket
  if (!injectWebSocket) throw new Error('startWebSocketServer could not resolve an injectWebSocket')
  injectWebSocket(server)
  return {
    server,
    port: BoundPortSchema.parse(server.address()).port,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
