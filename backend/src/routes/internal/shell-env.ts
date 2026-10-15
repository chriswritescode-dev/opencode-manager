import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { CredentialProvider } from '../../services/credential-provider'
import type { RepoEnvService } from '../../services/repo-env'

export function createInternalShellEnvRoutes(db: Database, repoEnvService: RepoEnvService) {
  const app = new Hono()

  app.get('/', async (c) => {
    const provider = new CredentialProvider(db)
    const cwd = c.req.query('cwd')
    const ghEnv = provider.getGhCliEnv({ cwd })
    if (!cwd) {
      return c.json({ env: ghEnv, mask: [] })
    }

    const repoEnv = await repoEnvService.resolveForDirectory(cwd)
    return c.json({ env: { ...ghEnv, ...repoEnv.env }, mask: repoEnv.maskValues })
  })

  return app
}
