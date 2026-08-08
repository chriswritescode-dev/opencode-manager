import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getRepoById } from '../db/queries'
import { getDevServerState } from '../services/dev-server/manager'
import { resolveDevPreviewUrl } from '../services/dev-server/proxy-utils'

export function createDevServerRoutes(db: Database): Hono {
  const app = new Hono()

  app.get('/:repoId/status', async (c) => {
    const repoId = parseInt(c.req.param('repoId'), 10)
    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    const repo = getRepoById(db, repoId)
    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404)
    }

    const previewUrl = resolveDevPreviewUrl(c.req.header('host'), c.req.header('x-forwarded-proto'))
    const state = await getDevServerState(db, repo.id, previewUrl)

    return c.json(state)
  })

  return app
}
