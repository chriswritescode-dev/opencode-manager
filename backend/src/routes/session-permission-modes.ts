import { Hono } from 'hono'
import { SetSessionPermissionModeRequestSchema } from '@opencode-manager/shared/schemas'
import { SessionPermissionModeError, type SessionPermissionModeService } from '../services/session-permission-modes'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

export function createSessionPermissionModeRoutes(service: SessionPermissionModeService) {
  const app = new Hono()

  app.get('/:sessionId', async (c) => {
    try {
      const state = await service.getEffectiveMode(
        c.req.param('sessionId'),
        c.req.query('serverId') || undefined,
      )
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to read session permission mode', SessionPermissionModeError)
    }
  })

  app.put('/:sessionId', async (c) => {
    const parsed = await parseJsonBody(c, SetSessionPermissionModeRequestSchema)
    if (!parsed.ok) {
      return parsed.response
    }

    try {
      const state = await service.setMode(
        c.req.param('sessionId'),
        parsed.data.mode,
        parsed.data.directory,
        parsed.data.serverId,
      )
      return c.json(state)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to set session permission mode', SessionPermissionModeError)
    }
  })

  return app
}
