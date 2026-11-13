import { Hono, type Context } from 'hono'
import { SetSessionSandboxRequestSchema } from '@opencode-manager/shared/schemas'
import { openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { SessionSandboxError, type SessionSandboxService } from '../services/session-sandbox'
import { getErrorMessage, toContentfulStatus } from '../utils/error-utils'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

function handleSessionSandboxError(c: Context, cause: unknown, fallback: string) {
  const status = openCodeErrorStatus(cause)
  if (status !== undefined) {
    return c.json({ error: getErrorMessage(cause) || fallback }, toContentfulStatus(status))
  }
  return handleServiceError(c, cause, fallback, SessionSandboxError)
}

export type SessionSandboxRoutesService = Pick<SessionSandboxService, 'getClaim' | 'getState' | 'resolveShellTarget' | 'update'>

export function createSessionSandboxRoutes(service: SessionSandboxRoutesService) {
  const app = new Hono()

  app.get('/:sessionId', async (c) => {
    try {
      const state = await service.getState(c.req.param('sessionId'))
      return c.json(state)
    } catch (error) {
      return handleSessionSandboxError(c, error, 'Failed to read session sandbox state')
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
      return handleSessionSandboxError(c, error, 'Failed to set session sandbox state')
    }
  })

  return app
}
