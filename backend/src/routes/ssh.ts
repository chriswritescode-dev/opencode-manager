import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../utils/logger'
import { GitAuthService } from '../services/git-auth'

const SSHHostKeyResponseSchema = z.object({
  requestId: z.string(),
  response: z.enum(['accept', 'reject'])
})

interface SSHHostKeyResponse {
  success: boolean
  error?: string
}

export function createSSHRoutes(gitAuthService: GitAuthService) {
  const app = new Hono()

  app.post('/host-key/respond', async (c) => {
    try {
      const body = await c.req.json()
      const validated = SSHHostKeyResponseSchema.parse(body)

      const handler = gitAuthService.sshHostKeyHandler
      if (!handler) {
        return c.json<SSHHostKeyResponse>({ success: false, error: 'SSH host key handler not found' }, 404)
      }

      const result = await handler.respond(validated)
      return c.json<SSHHostKeyResponse>(result)
    } catch (error) {
      logger.error('Error responding to SSH host key request:', error)
      if (error instanceof z.ZodError) {
        return c.json<SSHHostKeyResponse>({ success: false, error: 'Invalid request body' }, 400)
      }
      return c.json<SSHHostKeyResponse>({ success: false, error: 'Internal server error' }, 500)
    }
  })

  app.get('/host-key/status', (c) => {
    try {
      const handler = gitAuthService.sshHostKeyHandler
      if (!handler) {
        return c.json({ success: false, error: 'SSH host key handler not found' }, 404)
      }

      const pendingCount = handler.getPendingCount()
      return c.json({ success: true, pendingCount })
    } catch (error) {
      logger.error('Error getting SSH host key status:', error)
      return c.json({ success: false, error: 'Internal server error' }, 500)
    }
  })

  return app
}
