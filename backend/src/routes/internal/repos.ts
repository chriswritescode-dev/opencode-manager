import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { InternalCloneRepoRequestSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../../services/settings'
import type { GitAuthService } from '../../services/git-auth'
import { listRepos } from '../../db/queries'
import { cloneRepo } from '../../services/repo'
import { logger } from '../../utils/logger'
import { getErrorMessage, getStatusCode } from '../../utils/error-utils'

export type InternalRepoRoutesSettings = Pick<SettingsService, 'getSettings'>

export function createInternalRepoRoutes(db: Database, settingsService: InternalRepoRoutesSettings, gitAuthService: GitAuthService) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      const settings = settingsService.getSettings()
      const repos = listRepos(db, settings.preferences.repoOrder)
      return c.json({ repos })
    } catch (error) {
      logger.error('Failed to list internal repos:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/', async (c) => {
    const parsed = InternalCloneRepoRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400)
    }
    try {
      const { repoUrl, branch, directoryName } = parsed.data
      const repo = await cloneRepo(db, gitAuthService, repoUrl, { branch, directoryName })
      return c.json(repo)
    } catch (error) {
      logger.error('Failed to clone internal repo:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error))
    }
  })

  return app
}
