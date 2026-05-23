import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById } from '../../db/queries'
import { logger } from '../../utils/logger'
import type { RepoOpenCodeTargetManager } from '../../services/opencode/repo-target-manager'

export function createInternalOpenCodeTargetRoutes(db: Database, targetManager: RepoOpenCodeTargetManager) {
  const app = new Hono()

  app.post('/', async (c) => {
    try {
      const repoId = Number(c.req.param('id'))
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repoId' }, 400)
      }

      const repo = getRepoById(db, repoId)
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }

      const result = await targetManager.ensureTarget(repo)
      return c.json(result)
    } catch (error) {
      logger.error('Failed to ensure opencode target:', error)
      return c.json({ error: 'Internal server error' }, 500)
    }
  })

  return app
}
