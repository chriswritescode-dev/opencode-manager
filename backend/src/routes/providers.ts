import { Hono } from 'hono'
import { z } from 'zod'
import { AuthService } from '../services/auth'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import { setOpenCodeAuth, deleteOpenCodeAuth } from '../services/proxy'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'

async function reloadOpenCodeConfig(openCodeSupervisor?: OpenCodeSupervisor): Promise<void> {
  if (openCodeSupervisor) {
    await openCodeSupervisor.reloadConfig('settings_reload')
    return
  }

  await opencodeServerManager.reloadConfig()
}

export function createProvidersRoutes(openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()
  const authService = new AuthService()

  app.get('/credentials', async (c) => {
    try {
      const providers = await authService.list()
      return c.json({ providers })
    } catch (error) {
      logger.error('Failed to list provider credentials:', error)
      return c.json({ error: 'Failed to list provider credentials' }, 500)
    }
  })

  app.get('/:id/credentials/status', async (c) => {
    try {
      const providerId = c.req.param('id')
      const hasCredentials = await authService.has(providerId)
      return c.json({ hasCredentials })
    } catch (error) {
      logger.error('Failed to check credential status:', error)
      return c.json({ error: 'Failed to check credential status' }, 500)
    }
  })

  app.post('/:id/credentials', async (c) => {
    try {
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = SetCredentialRequestSchema.parse(body)
      
      const openCodeSuccess = await setOpenCodeAuth(providerId, validated.apiKey)
      if (!openCodeSuccess) {
        logger.warn(`Failed to set OpenCode auth for ${providerId}, saving locally only`)
      }
      
      await authService.set(providerId, validated.apiKey)
      
      try {
        await reloadOpenCodeConfig(openCodeSupervisor)
      } catch (reloadError) {
        logger.warn(`Failed to reload OpenCode config after saving credentials for ${providerId}:`, reloadError)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to set provider credentials:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to set provider credentials' }, 500)
    }
  })

  app.delete('/:id/credentials', async (c) => {
    try {
      const providerId = c.req.param('id')
      
      const openCodeSuccess = await deleteOpenCodeAuth(providerId)
      if (!openCodeSuccess) {
        logger.warn(`Failed to delete OpenCode auth for ${providerId}, removing locally only`)
      }
      
      await authService.delete(providerId)
      
      try {
        await reloadOpenCodeConfig(openCodeSupervisor)
      } catch (reloadError) {
        logger.warn(`Failed to reload OpenCode config after deleting credentials for ${providerId}:`, reloadError)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete provider credentials:', error)
      return c.json({ error: 'Failed to delete provider credentials' }, 500)
    }
  })

  return app
}
