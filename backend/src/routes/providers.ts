import { Hono } from 'hono'
import { z } from 'zod'
import path from 'path'
import { AuthService } from '../services/auth'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import { setOpenCodeAuth, deleteOpenCodeAuth } from '../services/proxy'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import type { Database } from 'bun:sqlite'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  addRecentOpenCodeModel,
  getOpenCodeModelState as readModelStateFromDb,
  toggleFavoriteOpenCodeModel,
  type OpenCodeModelStateRecord,
} from '../db/model-state'
import { writeJsonAtomic, withFileLock } from '../utils/atomic-json'

export const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

export const ModelStateSchema = z.object({
  recent: z.array(ModelSelectionSchema).default([]),
  favorite: z.array(ModelSelectionSchema).default([]),
  variant: z.record(z.string(), z.string().optional()).default({}),
})

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
}).strict()

export function getModelStatePath(): string {
  return path.join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'model.json')
}

async function mirrorModelStateToFile(state: OpenCodeModelStateRecord): Promise<void> {
  const modelStatePath = getModelStatePath()
  try {
    await withFileLock(modelStatePath, async () => {
      await writeJsonAtomic(modelStatePath, {
        recent: state.recent,
        favorite: state.favorite,
        variant: state.variant,
      })
    })
  } catch (error) {
    logger.warn(`Failed to mirror model state to file ${modelStatePath}:`, error)
  }
}

async function reloadOpenCodeConfig(openCodeSupervisor?: OpenCodeSupervisor): Promise<void> {
  if (openCodeSupervisor) {
    await openCodeSupervisor.reloadConfig('settings_reload')
    return
  }

  await opencodeServerManager.reloadConfig()
}

export function createProvidersRoutes(db: Database, openCodeSupervisor?: OpenCodeSupervisor) {
  const app = new Hono()
  const authService = new AuthService()

  app.get('/model-state', async (c) => {
    try {
      const state = readModelStateFromDb(db)
      return c.json(state)
    } catch (error) {
      logger.error('Failed to read OpenCode model state from DB:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)
      
      let nextState: OpenCodeModelStateRecord
      
      if (validated.favorite) {
        nextState = toggleFavoriteOpenCodeModel(db, validated.favorite)
      } else if (validated.recent) {
        nextState = addRecentOpenCodeModel(db, validated.recent)
      } else {
        nextState = readModelStateFromDb(db)
      }
      
      await mirrorModelStateToFile(nextState)
      
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
