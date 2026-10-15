import { Hono } from 'hono'
import { SetSessionSandboxRequestSchema } from '@opencode-manager/shared/schemas'
import { SessionSandboxError, type SessionSandboxService } from '../services/session-sandbox'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

export function createSessionSandboxRoutes(service: SessionSandboxService) {
  const app = new Hono()

  app.get('/:sessionId', async (c) => {
    try {
      const state = await service.getState(c.req.param('sessionId'))
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read session sandbox state', SessionSandboxError)
    }
  })

  app.put('/:sessionId', async (c) => {
    const parsed = await parseJsonBody(c, SetSessionSandboxRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.update(c.req.param('sessionId'), parsed.data)
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to set session sandbox state', SessionSandboxError)
    }
  })

  return app
}
