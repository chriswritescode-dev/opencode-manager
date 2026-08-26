import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { SandboxRuntimeService } from '../../services/sandbox/runtime'
import { logger } from '../../utils/logger'

const SandboxShellRequestSchema = z.object({
  directory: z.string().min(1),
  enforced: z.boolean().optional(),
})

export function createInternalSandboxRoutes(db: Database) {
  const app = new Hono()

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
      return c.json(
        await new SandboxRuntimeService(db).planShell(parsed.data.directory, parsed.data.enforced === true),
      )
    } catch (error) {
      logger.error('Failed to plan the sandbox shell', error)
      return c.json({ mode: 'blocked', reason: error instanceof Error ? error.message : String(error) }, 500)
    }
  })

  return app
}
