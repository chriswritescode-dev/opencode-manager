import { Hono } from 'hono'
import { z } from 'zod'
import { proxyRequest } from '../services/proxy'
import { logger } from '../utils/logger'
import { ENV } from '@opencode-webui/shared'
import { 
  OAuthAuthorizeRequestSchema, 
  OAuthAuthorizeResponseSchema,
  OAuthCallbackRequestSchema
} from '../../../shared/src/schemas/auth'

const OPENCODE_SERVER_URL = `http://${ENV.OPENCODE.HOST}:${ENV.OPENCODE.PORT}`

export function createOAuthRoutes() {
  const app = new Hono()

  app.post('/:id/oauth/authorize', async (c) => {
    try {
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = OAuthAuthorizeRequestSchema.parse(body)
      
      // Proxy to OpenCode server
      const response = await proxyRequest(
        new Request(
          `${OPENCODE_SERVER_URL}/provider/${providerId}/oauth/authorize`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validated)
          }
        )
      )

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
      
      // Proxy to OpenCode server
      const response = await proxyRequest(
        new Request(
          `${OPENCODE_SERVER_URL}/provider/${providerId}/oauth/callback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validated)
          }
        )
      )

      if (!response.ok) {
        const error = await response.text()
        logger.error(`OAuth callback failed for ${providerId}:`, error)
        return c.json({ error: 'OAuth callback failed' }, 500)
      }

      const data = await response.json()
      
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
      // Proxy to OpenCode server
      const response = await proxyRequest(
        new Request(`${OPENCODE_SERVER_URL}/provider/auth`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      )

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
