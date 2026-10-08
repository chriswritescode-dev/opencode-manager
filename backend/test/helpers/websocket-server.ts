import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'

export interface StartWebSocketServerOptions {
  app: Hono
  register?: (app: Hono, upgradeWebSocket: UpgradeWebSocket) => void
  injectWebSocket?: (server: Server) => void
}

export interface WebSocketTestServer {
  server: Server
  port: number
  close: () => Promise<void>
}

/**
 * Starts a Hono app on an ephemeral loopback port with WebSocket upgrades wired in.
 * Creates its own node WebSocket binding unless the caller passes an existing `injectWebSocket`.
 */
export async function startWebSocketServer(options: StartWebSocketServerOptions): Promise<WebSocketTestServer> {
  const owned = options.injectWebSocket ? undefined : createNodeWebSocket({ app: options.app })
  if (owned && options.register) {
    options.register(options.app, owned.upgradeWebSocket)
  }
  const server = await new Promise<Server>((resolve) => {
    const started = serve({ fetch: options.app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(started)) as unknown as Server
  })
  const injectWebSocket = options.injectWebSocket ?? owned?.injectWebSocket
  if (!injectWebSocket) throw new Error('startWebSocketServer could not resolve an injectWebSocket')
  injectWebSocket(server)
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
