import { Hono, type Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { SessionManager } from '../services/session-manager'
import { DockerOrchestrator } from '../services/docker-orchestrator'
import { DevcontainerManager } from '../services/devcontainer-manager'
import { DevcontainerRequestManager } from '../services/devcontainer-request-manager'
import type { CreateSessionInput } from '@opencode-manager/shared'
import { logger } from '../utils/logger'
import { proxyRequestToTarget } from '../services/proxy'
import { GitService } from '../services/git/GitService'
import { SettingsService } from '../services/settings'
import type { GitAuthService } from '../services/git-auth'
import type { GitStatusResponse } from '../types/git'
import { getContainerWorkspacesPath } from '@opencode-manager/shared/config/env'
import path from 'path'

export function createSessionRoutes(db: Database, gitAuthService: GitAuthService) {
  const app = new Hono()
  const dockerOrchestrator = new DockerOrchestrator()
  const sessionManager = new SessionManager(db, dockerOrchestrator)
  const devcontainerManager = new DevcontainerManager(db)
  const requestManager = new DevcontainerRequestManager(db, devcontainerManager, sessionManager)
  const settingsService = new SettingsService(db)
  const git = new GitService(gitAuthService, settingsService)

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
      
      const sessions = await sessionManager.listSessionDetails(
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
      const session = await sessionManager.getSessionDetail(id)
      
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      return c.json(session)
    } catch (error) {
      logger.error('Failed to get session:', error)
      return c.json({ 
        error: 'Failed to get session',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/:id/worktree-status', async (c) => {
    try {
      const id = c.req.param('id')
      const session = await sessionManager.getSession(id)

      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      const repoMappings = session.repoMappings || []
      const statusMap: Record<number, GitStatusResponse> = {}

      for (const repo of repoMappings) {
        try {
          statusMap[repo.repoId] = await git.getStatusForPath(repo.worktreePath)
        } catch (error) {
          logger.warn(`Failed to get worktree status for repo ${repo.repoId}:`, error)
        }
      }

      return c.json(statusMap)
    } catch (error) {
      logger.error('Failed to get worktree statuses:', error)
      return c.json({
        error: 'Failed to get worktree statuses',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/opencode-session', async (c) => {
    try {
      const id = c.req.param('id')
      const session = await sessionManager.getSession(id)

      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      if (session.status !== 'running') {
        return c.json({ error: 'Session is not running' }, 409)
      }

      const baseUrl = `http://${session.name}-opencode.localhost`
      const directory = path.posix.join(getContainerWorkspacesPath(), session.name)
      const existingId = (session.metadata?.opencodeSessionId as string | undefined) || undefined

      if (existingId) {
        const existingResponse = await fetch(`${baseUrl}/session/${existingId}?directory=${encodeURIComponent(directory)}`)
        if (existingResponse.ok) {
          return c.json(await existingResponse.json())
        }
      }

      const createResponse = await fetch(`${baseUrl}/session?directory=${encodeURIComponent(directory)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!createResponse.ok) {
        const text = await createResponse.text()
        return c.json({ error: 'Failed to create OpenCode session', message: text }, 502)
      }

      const created = await createResponse.json()
      const nextMetadata = { ...(session.metadata || {}), opencodeSessionId: created.id }
      await sessionManager.updateSessionMetadata(session.id, nextMetadata)

      return c.json(created)
    } catch (error) {
      logger.error('Failed to get or create OpenCode session:', error)
      return c.json({
        error: 'Failed to get or create OpenCode session',
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

  app.post('/:id/public', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json() as { enabled?: boolean }
      const enabled = body.enabled === true

      const session = await sessionManager.setPublicAccess(id, enabled)
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }

      return c.json({ success: true, publicOpencodeUrl: session.publicOpencodeUrl })
    } catch (error) {
      logger.error('Failed to update public access:', error)
      return c.json({
        error: 'Failed to update public access',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.get('/:id/devcontainer-requests', async (c) => {
    try {
      const id = c.req.param('id')
      return c.json(requestManager.listRequests(id))
    } catch (error) {
      logger.error('Failed to list devcontainer requests:', error)
      return c.json({
        error: 'Failed to list devcontainer requests',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/devcontainer-requests', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json() as {
        templateName?: string
        requestedBy: string
        changes: Record<string, unknown>
        reason?: string
        action?: 'modify' | 'fork'
      }

      const request = await requestManager.createRequest({
        sessionId: id,
        templateName: body.templateName,
        requestedBy: body.requestedBy,
        changes: body.changes as any,
        reason: body.reason,
        action: body.action,
      })

      return c.json(request, 201)
    } catch (error) {
      logger.error('Failed to create devcontainer request:', error)
      return c.json({
        error: 'Failed to create devcontainer request',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  const proxySessionOpenCode = async (c: Context) => {
    try {
      const id = c.req.param('id')
      const session = await sessionManager.getSession(id)
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }
      if (session.status !== 'running') {
        return c.json({ error: 'Session is not running' }, 409)
      }

      const prefix = `/api/sessions/${id}/opencode`
      const targetBaseUrl = `http://${session.name}-opencode.localhost`
      return proxyRequestToTarget(c.req.raw, targetBaseUrl, prefix)
    } catch (error) {
      logger.error('Failed to proxy OpenCode session request:', error)
      return c.json({
        error: 'Failed to proxy OpenCode session request',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 502)
    }
  }

  app.all('/:id/opencode', proxySessionOpenCode)
  app.all('/:id/opencode/*', proxySessionOpenCode)

  app.post('/:id/devcontainer-requests/:requestId/approve', async (c) => {
    try {
      const requestId = Number(c.req.param('requestId'))
      await requestManager.approveRequest(requestId)
      return c.json({ success: true, status: 'approved' })
    } catch (error) {
      logger.error('Failed to approve devcontainer request:', error)
      return c.json({
        error: 'Failed to approve devcontainer request',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/devcontainer-requests/:requestId/reject', async (c) => {
    try {
      const requestId = Number(c.req.param('requestId'))
      await requestManager.rejectRequest(requestId)
      return c.json({ success: true, status: 'rejected' })
    } catch (error) {
      logger.error('Failed to reject devcontainer request:', error)
      return c.json({
        error: 'Failed to reject devcontainer request',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/:id/devcontainer-requests/:requestId/apply', async (c) => {
    try {
      const requestId = Number(c.req.param('requestId'))
      const updated = await requestManager.applyRequest(requestId)
      return c.json(updated)
    } catch (error) {
      logger.error('Failed to apply devcontainer request:', error)
      return c.json({
        error: 'Failed to apply devcontainer request',
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
