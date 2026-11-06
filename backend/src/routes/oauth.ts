import { Hono } from 'hono'
import { z } from 'zod'
import {
  OAuthAuthorizeRequestSchema,
  OAuthCallbackRequestSchema,
} from '../../../shared/src/schemas/auth'
import type { OpenCodeClient } from '../services/opencode/client'
import { runWhenIntegrationReady } from '../services/opencode/integration-ready'
import { handleOpenCodeError } from '../utils/route-helpers'

export function createOAuthRoutes(openCodeClient: OpenCodeClient) {
  const app = new Hono()

  app.get('/auth-methods', async (c) => {
    try {
      const integrations = await openCodeClient.api.integration.list()
      const providers = Object.fromEntries(
        integrations.data.map((integration) => [integration.id, integration.methods]),
      )
      return c.json({ providers })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to get provider auth methods')
    }
  })

  app.post('/:id/oauth/authorize', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OAuthAuthorizeRequestSchema.parse(body)

      const integrationID = c.req.param('id')
      const attempt = await runWhenIntegrationReady(openCodeClient.api, { integrationID }, () =>
        openCodeClient.api.integration.oauth.connect({
          integrationID,
          methodID: validated.methodID,
          answer: validated.answer,
        }),
      )

      return c.json({
        attemptID: attempt.data.attemptID,
        url: attempt.data.url,
        instructions: attempt.data.instructions,
        mode: attempt.data.mode,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return handleOpenCodeError(c, error, 'OAuth authorization failed')
    }
  })

  app.get('/:id/oauth/:attemptID', async (c) => {
    try {
      const attempt = await openCodeClient.api.integration.oauth.status({
        integrationID: c.req.param('id'),
        attemptID: c.req.param('attemptID'),
      })

      const { status } = attempt.data
      return c.json(status === 'failed'
        ? { status, message: attempt.data.message }
        : { status })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to get OAuth status')
    }
  })

  app.post('/:id/oauth/callback', async (c) => {
    try {
      const body = await c.req.json()
      const validated = OAuthCallbackRequestSchema.parse(body)

      await openCodeClient.api.integration.oauth.complete({
        integrationID: c.req.param('id'),
        attemptID: validated.attemptID,
        code: validated.code,
      })

      return c.json({ success: true })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return handleOpenCodeError(c, error, 'OAuth callback failed')
    }
  })

  app.delete('/:id/oauth/:attemptID', async (c) => {
    try {
      await openCodeClient.api.integration.oauth.cancel({
        integrationID: c.req.param('id'),
        attemptID: c.req.param('attemptID'),
      })

      return c.json({ success: true })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to cancel OAuth authorization')
    }
  })

  return app
}
