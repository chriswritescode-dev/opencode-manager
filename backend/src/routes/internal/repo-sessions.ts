import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById } from '../../db/queries'
import { logger } from '../../utils/logger'
import type { RepoOpenCodeTargetManager } from '../../services/opencode/repo-target-manager'
import { RepoSessionSyncService } from '../../services/opencode/repo-session-sync'
import { createOpenCodeClient } from '../../services/opencode/client'

export function createInternalRepoSessionRoutes(db: Database, targetManager: RepoOpenCodeTargetManager) {
  const app = new Hono()
  const syncService = new RepoSessionSyncService(targetManager)

  app.post('/:sessionId/sync', async (c) => {
    try {
      const repoId = Number(c.req.param('id'))
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }

      const sessionId = c.req.param('sessionId')
      if (!sessionId) {
        return c.json({ error: 'Missing sessionId' }, 400)
      }

      const body = await c.req.json<{ reason?: string }>()
      const reason = body.reason || 'manual'
      if (!['idle', 'completed', 'stop', 'manual'].includes(reason)) {
        return c.json({ error: 'Invalid reason' }, 400)
      }

      const repo = getRepoById(db, repoId)
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }

      const runtime = targetManager.getTarget(repoId)
      if (!runtime || runtime.state !== 'healthy') {
        return c.json({ error: 'Target is not healthy' }, 503)
      }

      const sourceBaseUrl = `http://127.0.0.1:${runtime.port}`
      const sourceAuthHeader = `Basic ${Buffer.from(`opencode:${runtime.token}`).toString('base64')}`
      const targetClient = createOpenCodeClient()

      const result = await syncService.syncSession({
        repoId,
        sessionId,
        sourceBaseUrl,
        sourceAuthHeader,
        targetClient,
        directory: repo.fullPath,
        reason: reason as 'idle' | 'completed' | 'stop' | 'manual',
      })

      return c.json({
        repoId,
        sessionId,
        replayedEvents: result.replayedEvents,
      })
    } catch (error) {
      logger.error('Failed to sync session:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  })

  return app
}
