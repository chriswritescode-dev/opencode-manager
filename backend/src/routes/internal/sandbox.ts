import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { SandboxRuntimeService } from '../../services/sandbox/runtime'
import type { SessionSandboxRoutesService } from '../session-sandbox'
import type { RepoEnvResolver } from '../../services/repo-env'
import { logger } from '../../utils/logger'

const SandboxShellRequestSchema = z.object({
  directory: z.string().min(1),
  sessionId: z.string().min(1),
  locationDirectory: z.string().min(1),
  enforced: z.boolean().optional(),
})

export function createInternalSandboxRoutes(
  db: Database,
  sessionSandbox: SessionSandboxRoutesService,
  repoEnvService: RepoEnvResolver,
) {
  const app = new Hono()

  app.get('/sessions/:sessionId', async (c) => {
    try {
      return c.json(await sessionSandbox.getClaim(c.req.param('sessionId')))
    } catch (error) {
      logger.error('Failed to read session sandbox state', error)
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.get('/sessions/:sessionId/environment', async (c) => {
    const directory = c.req.query('directory')?.trim() ?? ''
    if (directory === '') {
      return c.json({ error: 'Invalid request' }, 400)
    }
    try {
      const target = await sessionSandbox.resolveShellTarget(c.req.param('sessionId'))
      if (!target.sandboxed) {
        return c.json({ sandboxed: false })
      }
      const environment = await new SandboxRuntimeService(db, repoEnvService).describeCheckoutEnvironment(directory)
      if (environment === null) {
        return c.json({ error: `could not resolve the checkout for ${directory}` }, 400)
      }
      return c.json({ sandboxed: true, ...environment })
    } catch (error) {
      logger.error('Failed to describe the sandbox environment', error)
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  app.post('/shell', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid request' }, 400)
    }

    const parsed = SandboxShellRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    try {
      const target = await sessionSandbox.resolveShellTarget(parsed.data.sessionId)
      if (!target.sandboxed) {
        return c.json({ mode: 'blocked', reason: 'Sandboxing is off for this session' }, 409)
      }
      return c.json(
        await new SandboxRuntimeService(db, repoEnvService).planShell(
          parsed.data.directory,
          { locationDirectory: parsed.data.locationDirectory },
          parsed.data.enforced === true,
        ),
      )
    } catch (error) {
      logger.error('Failed to plan the sandbox shell', error)
      return c.json({ mode: 'blocked', reason: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  return app
}
