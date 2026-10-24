import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { CredentialProvider } from '../../services/credential-provider'

/**
 * Legacy GitHub CLI environment route, kept for one release for OpenCode
 * processes that were adopted before the upgrade: those processes still run the
 * removed gh-env plugin and keep calling this path, so it answers with the same
 * flat env a fresh install fetches from `/shell-env`.
 */
export function createInternalGitCredentialsRoutes(db: Database) {
  const app = new Hono()

  app.get('/gh-env', (c) => {
    const provider = new CredentialProvider(db)
    const cwd = c.req.query('cwd')
    return c.json(provider.getGhCliEnv({ cwd }))
  })

  return app
}
