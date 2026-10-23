import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { SetSessionSandboxRequestSchema } from '@opencode-manager/shared/schemas'
import { openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { SessionSandboxError, type SessionSandboxService } from '../services/session-sandbox'
import { getErrorMessage } from '../utils/error-utils'
import { handleServiceError, parseJsonBody } from '../utils/route-helpers'

/**
 * Maps both sandbox errors and the OpenCode errors raised while resolving a session (for example
 * `SessionNotFoundError` or `InvalidRequestError` for a malformed id) to their real status codes.
 */
function handleSessionSandboxError(c: Context, error: unknown, fallback: string) {
  const status = openCodeErrorStatus(error)
  if (status !== undefined) {
    return c.json({ error: getErrorMessage(error) || fallback }, status as ContentfulStatusCode)
  }
  return handleServiceError(c, error, fallback, SessionSandboxError)
}

export function createSessionSandboxRoutes(service: SessionSandboxService) {
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
