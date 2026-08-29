import { Hono } from 'hono'
import { ManagerLogQuerySchema } from '@opencode-manager/shared/schemas'
import { readManagerLogEntries } from '../utils/log-buffer'

export function createLogRoutes() {
  const app = new Hono()

  app.get('/', (c) => {
    const result = ManagerLogQuerySchema.safeParse(c.req.query())
    if (!result.success) {
      return c.json({ error: 'Invalid request', details: result.error.issues }, 400)
    }
    return c.json(readManagerLogEntries(result.data))
  })

  return app
}
