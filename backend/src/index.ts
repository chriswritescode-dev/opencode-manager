import { serve } from '@hono/node-server'
import { ENV } from '@opencode-manager/shared/config/env'
import { createBackendApp, startPreviewGateway } from './backend-app'
import { logger } from './utils/logger'

const { PORT, HOST } = ENV.SERVER

const backend = createBackendApp()
await backend.initialize()

let isShuttingDown = false

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info(`${signal} received, shutting down gracefully...`)
  await backend.shutdown()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

const server = serve({
  fetch: backend.app.fetch,
  port: PORT,
  hostname: HOST,
})

backend.injectWebSocket(server)

if (ENV.PREVIEW.PORT > 0) {
  startPreviewGateway({ preview: backend.preview, port: ENV.PREVIEW.PORT, hostname: HOST })
}

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`)
