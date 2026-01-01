import { Hono } from 'hono'
import { terminalService } from '../services/terminal'
import { logger } from '../utils/logger'
import { Server, Socket } from 'socket.io'

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

export function registerTerminalSocketIO(io: Server) {
  io.on('connection', (socket: Socket) => {
    const sessionId = socket.handshake.query.sessionId as string
    const cwd = (socket.handshake.query.cwd as string) || undefined
    
    if (!sessionId) {
      logger.error('Socket connection missing sessionId')
      socket.disconnect()
      return
    }

    logger.info(`Socket.IO connection for terminal: ${sessionId}`)
    socket.join(sessionId)

    // Create session if it doesn't exist
    terminalService.createSession(sessionId, cwd)

    // Handle incoming data from client
    socket.on('input', (data: string) => {
      terminalService.writeToSession(sessionId, data)
    })

    socket.on('resize', (size: { cols: number; rows: number }) => {
      terminalService.resizeSession(sessionId, size.cols, size.rows)
    })

    // Setup PTY listeners for this socket
    // We need to be careful not to duplicate listeners if multiple sockets connect to the same session
    // For now, we'll just add new listeners and rely on the service to broadcast to all
    
    terminalService.setOnData(sessionId, (data: string) => {
      io.to(sessionId).emit('output', data)
    })

    terminalService.setOnExit(sessionId, (exitCode: number, signal?: number) => {
      io.to(sessionId).emit('exit', { exitCode, signal })
      terminalService.destroySession(sessionId)
      socket.disconnect()
    })

    socket.on('disconnect', () => {
      logger.info(`Socket.IO disconnected for terminal: ${sessionId}`)
      // We don't destroy the session on disconnect to allow reconnection
      // The session will be destroyed when the PTY exits or manually via API
    })
  })
}
