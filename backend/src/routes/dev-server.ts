import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { getRepoById, getDevServerConfig, setDevServerConfig } from '../db/queries'
import { getDevServerState } from '../services/dev-server/manager'

const UpdateConfigSchema = z.object({
  injectBase: z.boolean(),
})

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

    const state = await getDevServerState(db, repo.id)

    return c.json(state)
  })

  app.get('/:repoId/config', async (c) => {
    const repoId = parseInt(c.req.param('repoId'), 10)
    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    const config = getDevServerConfig(db, repoId)
    return c.json(config)
  })

  app.put('/:repoId/config', async (c) => {
    const repoId = parseInt(c.req.param('repoId'), 10)
    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repoId' }, 400)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = UpdateConfigSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400)
    }

    setDevServerConfig(db, repoId, parsed.data)
    const saved = getDevServerConfig(db, repoId)
    return c.json(saved)
  })

  return app
}
