import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { sseAggregator } from '../services/sse-aggregator'
import { SSESubscribeSchema } from '@opencode-manager/shared/schemas'
import { logger } from '../utils/logger'
import { DEFAULTS } from '@opencode-manager/shared/config'

const { HEARTBEAT_INTERVAL_MS } = DEFAULTS.SSE

export function createSSERoutes() {
  const app = new Hono()

  app.get('/stream', async (c) => {
    const directoriesParam = c.req.query('directories')
    const directories = directoriesParam ? directoriesParam.split(',').filter(Boolean) : []
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2)}`

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache, no-store, no-transform')
    c.header('Connection', 'keep-alive')
    c.header('X-Accel-Buffering', 'no')

    return stream(c, async (writer) => {
      const encoder = new TextEncoder()
      const writeSSE = (event: string, data: string) => {
        const lines = []
        if (event) lines.push(`event: ${event}`)
        lines.push(`data: ${data}`)
        lines.push('')
        lines.push('')
        writer.write(encoder.encode(lines.join('\n')))
      }

      const cleanup = sseAggregator.addClient(
        clientId,
        (event, data) => {
          writeSSE(event, data)
        },
        directories
      )

      const heartbeatInterval = setInterval(() => {
        try {
          writeSSE('heartbeat', JSON.stringify({ timestamp: Date.now() }))
        } catch {
          clearInterval(heartbeatInterval)
        }
      }, HEARTBEAT_INTERVAL_MS)

      writer.onAbort(() => {
        clearInterval(heartbeatInterval)
        cleanup()
      })

      try {
        writeSSE('connected', JSON.stringify({ clientId, directories, ...sseAggregator.getConnectionStatus() }))
      } catch (err) {
        logger.error(`Failed to send SSE connected event for ${clientId}:`, err)
      }

      await new Promise(() => {})
    })
  })

  app.post('/subscribe', async (c) => {
    const body = await c.req.json()
    const result = SSESubscribeSchema.safeParse(body)
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid request', details: result.error.issues }, 400)
    }
    const success = sseAggregator.addDirectories(result.data.clientId, result.data.directories)
    if (!success) {
      return c.json({ success: false, error: 'Client not found' }, 404)
    }
    return c.json({ success: true })
  })

  app.post('/unsubscribe', async (c) => {
    const body = await c.req.json()
    const result = SSESubscribeSchema.safeParse(body)
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid request', details: result.error.issues }, 400)
    }
    const success = sseAggregator.removeDirectories(result.data.clientId, result.data.directories)
    if (!success) {
      return c.json({ success: false, error: 'Client not found' }, 404)
    }
    return c.json({ success: true })
  })

  app.get('/status', (c) => {
    return c.json({
      ...sseAggregator.getConnectionStatus(),
      clients: sseAggregator.getClientCount(),
      directories: sseAggregator.getActiveDirectories(),
      activeSessions: sseAggregator.getActiveSessions()
    })
  })

  return app
}
