import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { CredentialProvider } from '../../services/credential-provider'
import { getDevServerPort } from '../../services/dev-server/manager'

export function createInternalShellEnvRoutes(db: Database) {
  const app = new Hono()

  app.get('/', (c) => {
    const provider = new CredentialProvider(db)
    return c.json({
      ...provider.getGhCliEnv({ cwd: c.req.query('cwd') }),
      OCM_DEV_SERVER_PORT: String(getDevServerPort(db)),
    })
  })

  return app
}
