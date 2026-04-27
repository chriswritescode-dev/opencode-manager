import { Hono } from 'hono'
import { z } from 'zod'
import path from 'path'
import { AuthService } from '../services/auth'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { logger } from '../utils/logger'
import { setOpenCodeAuth, deleteOpenCodeAuth } from '../services/proxy'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import { fileExists, readFileContent, writeFileContent } from '../services/file-operations'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const ModelSelectionSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
})

const ModelStateSchema = z.object({
  recent: z.array(ModelSelectionSchema).default([]),
  favorite: z.array(ModelSelectionSchema).default([]),
  variant: z.record(z.string(), z.string().optional()).default({}),
})

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
})

type ModelSelection = z.infer<typeof ModelSelectionSchema>
type ModelState = z.infer<typeof ModelStateSchema>

const MAX_RECENT_MODELS = 10

function getModelStatePath(): string {
  return path.join(getWorkspacePath(), '.opencode', 'state', 'opencode', 'model.json')
}

async function readModelState(): Promise<ModelState> {
  const modelStatePath = getModelStatePath()
  if (!await fileExists(modelStatePath)) {
    return { recent: [], favorite: [], variant: {} }
  }

  return ModelStateSchema.parse(JSON.parse(await readFileContent(modelStatePath)))
}

function uniqueModels(models: ModelSelection[]): ModelSelection[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = `${model.providerID}/${model.modelID}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

async function addRecentModel(model: ModelSelection): Promise<ModelState> {
  const state = await readModelState()
  const recent = uniqueModels([model, ...state.recent]).slice(0, MAX_RECENT_MODELS)
  const nextState = { ...state, recent }
  await writeFileContent(getModelStatePath(), JSON.stringify(nextState, null, 2))
  return nextState
}

async function toggleFavoriteModel(model: ModelSelection): Promise<ModelState> {
  const state = await readModelState()
  const exists = state.favorite.some((favorite) => favorite.providerID === model.providerID && favorite.modelID === model.modelID)
  const favorite = exists
    ? state.favorite.filter((favorite) => favorite.providerID !== model.providerID || favorite.modelID !== model.modelID)
    : uniqueModels([model, ...state.favorite])
  const nextState = { ...state, favorite }
  await writeFileContent(getModelStatePath(), JSON.stringify(nextState, null, 2))
  return nextState
}

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

  app.get('/model-state', async (c) => {
    try {
      return c.json(await readModelState())
    } catch (error) {
      logger.error('Failed to read OpenCode model state:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)
      if (validated.favorite) {
        return c.json(await toggleFavoriteModel(validated.favorite))
      }
      if (!validated.recent) {
        return c.json(await readModelState())
      }
      return c.json(await addRecentModel(validated.recent))
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
