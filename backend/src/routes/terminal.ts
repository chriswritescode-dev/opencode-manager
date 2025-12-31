import { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { terminalService } from '../services/terminal'
import { logger } from '../utils/logger'

export function createTerminalRoutes() {
  const app = new Hono()

  app.get('/sessions', (c) => {
    const sessions = terminalService.listSessions()
    return c.json({ sessions })
  })

  app.post('/sessions/:id/resize', async (c) => {
    const id = c.req.param('id')
    const { cols, rows } = await c.req.json<{ cols: number; rows: number }>()
    
    const success = terminalService.resizeSession(id, cols, rows)
    if (!success) {
      return c.json({ error: 'Session not found' }, 404)
    }
    
    return c.json({ success: true })
  })

  app.delete('/sessions/:id', (c) => {
    const id = c.req.param('id')
    const success = terminalService.destroySession(id)
    
    if (!success) {
      return c.json({ error: 'Session not found' }, 404)
    }
    
    return c.json({ success: true })
  })

  return app
}

export function registerTerminalWebSocket(app: Hono, upgradeWebSocket: UpgradeWebSocket) {
  app.get(
    '/api/terminal/ws/:id',
    upgradeWebSocket((c) => {
      const sessionId = c.req.param('id')
      const cwd = c.req.query('cwd') || undefined

      return {
        onOpen(_evt, ws) {
          logger.info(`WebSocket connection opened for terminal: ${sessionId}`)
          
          const session = terminalService.createSession(sessionId, cwd)
          
          session.pty.onData((data: string) => {
            try {
              ws.send(JSON.stringify({ type: 'output', data }))
            } catch (error) {
              logger.error(`Failed to send data to WebSocket:`, error)
            }
          })

          session.pty.onExit(({ exitCode, signal }) => {
            try {
              ws.send(JSON.stringify({ type: 'exit', exitCode, signal }))
              ws.close()
            } catch (error) {
              logger.error(`Failed to send exit event:`, error)
            }
            terminalService.destroySession(sessionId)
          })
        },

        onMessage(evt, ws) {
          try {
            const message = JSON.parse(evt.data.toString())
            
            switch (message.type) {
              case 'input':
                terminalService.writeToSession(sessionId, message.data)
                break
              case 'resize':
                terminalService.resizeSession(sessionId, message.cols, message.rows)
                break
              default:
                logger.warn(`Unknown message type: ${message.type}`)
            }
          } catch (error) {
            logger.error(`Failed to parse WebSocket message:`, error)
          }
        },

        onClose() {
          logger.info(`WebSocket connection closed for terminal: ${sessionId}`)
          terminalService.destroySession(sessionId)
        },

        onError(evt) {
          logger.error(`WebSocket error for terminal ${sessionId}:`, evt)
          terminalService.destroySession(sessionId)
        },
      }
    })
  )
}
