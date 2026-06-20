import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { CredentialProvider } from '../../services/credential-provider'

export function createInternalGitCredentialsRoutes(db: Database) {
  const app = new Hono()

  app.get('/gh-env', (c) => {
    const provider = new CredentialProvider(db)
    return c.json(provider.getGhCliEnv())
  })

  return app
}
