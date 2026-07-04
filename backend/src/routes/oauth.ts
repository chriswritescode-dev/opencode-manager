import { Hono } from 'hono'
import type { OpenCodeClient } from '../services/opencode/client'
import { z } from 'zod'
import { logger } from '../utils/logger'
import {
  OAuthAuthorizeRequestSchema,
  OAuthAuthorizeResponseSchema,
  OAuthCallbackRequestSchema
} from '../../../shared/src/schemas/auth'
import { reloadOpenCodeConfig } from '../services/opencode-restart'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'

export function createOAuthRoutes(openCodeClient: OpenCodeClient, openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()

  app.post('/:id/oauth/authorize', async (c) => {
    try {
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = OAuthAuthorizeRequestSchema.parse(body)
      
      const response = await openCodeClient.forward({
        method: 'POST',
        path: `/provider/${encodeURIComponent(providerId)}/oauth/authorize`,
        body: JSON.stringify(validated),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.text()
        logger.error(`OAuth authorize failed for ${providerId}:`, error)
        return c.json({ error: 'OAuth authorization failed' }, 500)
      }

      const data = await response.json()
      const validatedResponse = OAuthAuthorizeResponseSchema.parse(data)
      
      return c.json(validatedResponse)
    } catch (error) {
      logger.error('OAuth authorize error:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'OAuth authorization failed' }, 500)
    }
  })

  app.post('/:id/oauth/callback', async (c) => {
    try {
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = OAuthCallbackRequestSchema.parse(body)
      
      const response = await openCodeClient.forward({
        method: 'POST',
        path: `/provider/${encodeURIComponent(providerId)}/oauth/callback`,
        body: JSON.stringify(validated),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.text()
        logger.error(`OAuth callback failed for ${providerId}:`, error)
        return c.json({ error: 'OAuth callback failed' }, 500)
      }

      const data = await response.json()

      try {
        await reloadOpenCodeConfig(openCodeSupervisor)
      } catch (reloadError) {
        logger.warn(`Failed to reload OpenCode config after OAuth callback for ${providerId}:`, reloadError)
      }

      return c.json(data)
    } catch (error) {
      logger.error('OAuth callback error:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'OAuth callback failed' }, 500)
    }
  })

  app.get('/auth-methods', async (c) => {
    try {
      const response = await openCodeClient.forward({
        method: 'GET',
        path: '/provider/auth',
      })

      if (!response.ok) {
        const error = await response.text()
        logger.error('Failed to get provider auth methods:', error)
        return c.json({ error: 'Failed to get provider auth methods' }, 500)
      }

      const data = await response.json()
      
      // The OpenCode server returns the format we need directly
      return c.json({ providers: data })
    } catch (error) {
      logger.error('Provider auth methods error:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid response data', details: error.issues }, 500)
      }
      return c.json({ error: 'Failed to get provider auth methods' }, 500)
    }
  })

  return app
}
