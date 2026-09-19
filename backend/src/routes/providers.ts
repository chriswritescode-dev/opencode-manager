import { Hono } from 'hono'
import { z } from 'zod'
import { AuthService } from '../services/auth'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import type { OpenCodeClient } from '../services/opencode/client'
import { reloadOpenCodeConfig } from '../services/opencode-restart'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import {
  addRecentModel,
  ModelSelectionSchema,
  readOpenCodeModelState,
  removeRecentModel,
  toggleFavoriteModel,
  updateOpenCodeModelState,
} from '../services/opencode-model-state'

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
  removeRecent: ModelSelectionSchema.optional(),
}).strict()

export function createProvidersRoutes(openCodeClient: OpenCodeClient, openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()
  const authService = new AuthService()

  app.get('/model-state', async (c) => {
    try {
      const state = await readOpenCodeModelState()
      return c.json(state)
    } catch (error) {
      logger.error('Failed to read OpenCode model state:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)

      const nextState = await updateOpenCodeModelState((state) => {
        if (validated.favorite) {
          return toggleFavoriteModel(state, validated.favorite)
        }
        if (validated.recent) {
          return addRecentModel(state, validated.recent)
        }
        if (validated.removeRecent) {
          return removeRecentModel(state, validated.removeRecent)
        }
        return state
      })

      return c.json(nextState)
    } catch (error) {
      logger.error('Failed to update OpenCode model state:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode model state' }, 500)
    }
  })

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
      
      const openCodeSuccess = await openCodeClient.setProviderAuth(providerId, validated.apiKey)
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
      
      const openCodeSuccess = await openCodeClient.deleteProviderAuth(providerId)
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
