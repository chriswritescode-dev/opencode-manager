import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById } from '../../db/queries'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { safeGitOut } from './repo-sync-helpers'

export function createInternalRepoSyncRoutes(db: Database) {
  const app = new Hono()

  app.get('/:repoId/git-info', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (repo.cloneStatus !== 'ready') return c.json({ error: 'repo not ready' }, 409)
    const repoPath = repo.fullPath
    try {
      const [originUrl, head, branch, status] = await Promise.all([
        safeGitOut(repoPath, ['remote', 'get-url', 'origin']),
        safeGitOut(repoPath, ['rev-parse', 'HEAD']),
        safeGitOut(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        safeGitOut(repoPath, ['status', '--porcelain']),
      ])
      return c.json({
        repoId,
        repoName: repo.repoUrl?.split('/').slice(-1)[0]?.replace('.git', '') ?? null,
        directory: repoPath,
        originUrl: originUrl?.trim() || null,
        head: head?.trim() || null,
        branch: branch?.trim() || null,
        dirty: Boolean(status && status.trim().length > 0),
      })
    } catch (error) {
      logger.error('git-info failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
