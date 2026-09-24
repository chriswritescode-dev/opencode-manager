import { Hono } from 'hono'
import { z } from 'zod'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import { handleOpenCodeError } from '../utils/route-helpers'
import type { IntegrationInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../services/opencode/client'
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

function credentialConnections(integration: IntegrationInfo) {
  return integration.connections.filter((connection) => connection.type === 'credential')
}

export function createProvidersRoutes(openCodeClient: OpenCodeClient) {
  const app = new Hono()

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
      const integrations = await openCodeClient.api.integration.list()
      const providers = integrations.data
        .filter((integration) => credentialConnections(integration).length > 0)
        .map((integration) => integration.id)
      return c.json({ providers })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to list provider credentials')
    }
  })

  app.get('/:id/credentials/status', async (c) => {
    try {
      const integration = await openCodeClient.api.integration.get({ integrationID: c.req.param('id') })
      return c.json({ hasCredentials: credentialConnections(integration.data).length > 0 })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to check credential status')
    }
  })

  app.post('/:id/credentials', async (c) => {
    try {
      const body = await c.req.json()
      const validated = SetCredentialRequestSchema.parse(body)

      await openCodeClient.api.integration.connect.key({
        integrationID: c.req.param('id'),
        key: validated.apiKey,
        ...(validated.answer ? { answer: validated.answer } : {}),
      })

      return c.json({ success: true })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return handleOpenCodeError(c, error, 'Failed to set provider credentials')
    }
  })

  app.delete('/:id/credentials', async (c) => {
    try {
      const integration = await openCodeClient.api.integration.get({ integrationID: c.req.param('id') })

      for (const connection of credentialConnections(integration.data)) {
        await openCodeClient.api.credential.remove({ credentialID: connection.id })
      }

      return c.json({ success: true })
    } catch (error) {
      return handleOpenCodeError(c, error, 'Failed to delete provider credentials')
    }
  })

  return app
}
