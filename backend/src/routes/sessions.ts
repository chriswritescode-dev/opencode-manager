import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { SessionManager } from '../services/session-manager'
import { DockerOrchestrator } from '../services/docker-orchestrator'
import type { CreateSessionInput } from '@opencode-manager/shared'
import { logger } from '../utils/logger'

export function createSessionRoutes(db: Database) {
  const app = new Hono()
  const dockerOrchestrator = new DockerOrchestrator()
  const sessionManager = new SessionManager(db, dockerOrchestrator)

  app.post('/', async (c) => {
    try {
      const body = await c.req.json() as CreateSessionInput
      
      const session = await sessionManager.createSession(body)
      
      return c.json(session, 201)
    } catch (error) {
      logger.error('Failed to create session:', error)
      return c.json({ 
        error: 'Failed to create session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/', async (c) => {
    try {
      const status = c.req.query('status')
      
      const sessions = await sessionManager.listSessions(
        status ? { status: status as any } : undefined
      )
      
      return c.json(sessions)
    } catch (error) {
      logger.error('Failed to list sessions:', error)
      return c.json({ 
        error: 'Failed to list sessions',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const session = await sessionManager.getSession(id)
      
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }
      
      const opencodeStatus = await dockerOrchestrator.getContainerStatus(`${session.name}-opencode`)
      const dindStatus = await dockerOrchestrator.getContainerStatus(`${session.name}-dind`)
      const codeServerStatus = await dockerOrchestrator.getContainerStatus(`${session.name}-code`)
      
      return c.json({
        ...session,
        containers: {
          opencode: opencodeStatus || undefined,
          dind: dindStatus || undefined,
          codeServer: codeServerStatus || undefined,
        }
      })
    } catch (error) {
      logger.error('Failed to get session:', error)
      return c.json({ 
        error: 'Failed to get session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/start', async (c) => {
    try {
      const id = c.req.param('id')
      await sessionManager.startSession(id)
      
      return c.json({ success: true, status: 'starting' })
    } catch (error) {
      logger.error('Failed to start session:', error)
      return c.json({ 
        error: 'Failed to start session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/stop', async (c) => {
    try {
      const id = c.req.param('id')
      await sessionManager.stopSession(id)
      
      return c.json({ success: true, status: 'stopped' })
    } catch (error) {
      logger.error('Failed to stop session:', error)
      return c.json({ 
        error: 'Failed to stop session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/restart', async (c) => {
    try {
      const id = c.req.param('id')
      await sessionManager.restartSession(id)
      
      return c.json({ success: true, status: 'restarting' })
    } catch (error) {
      logger.error('Failed to restart session:', error)
      return c.json({ 
        error: 'Failed to restart session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const keepWorktrees = c.req.query('keepWorktrees') === 'true'
      
      await sessionManager.deleteSession(id, keepWorktrees)
      
      return c.json({ success: true, deleted: true, worktreesKept: keepWorktrees })
    } catch (error) {
      logger.error('Failed to delete session:', error)
      return c.json({ 
        error: 'Failed to delete session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  return app
}
