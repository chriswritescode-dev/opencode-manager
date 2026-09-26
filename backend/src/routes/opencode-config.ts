import { Hono } from 'hono'
import { z } from 'zod'
import { UpdateOpenCodeConfigRequestSchema } from '@opencode-manager/shared/schemas'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { ClientError, openCodeLocation } from '@opencode-manager/shared/opencode'
import type { SettingsService } from '../services/settings'
import type { OpenCodeClient } from '../services/opencode/client'
import {
  OpenCodeConfigConflictError,
  OpenCodeConfigShadowedRemovalError,
  OpenCodeConfigSourceInvalidError,
  readOpenCodeConfigFile,
  withOpenCodeConfigLock,
} from '../services/opencode-config-file'
import { applyOpenCodeConfigUpdate, toOpenCodeConfigApplyResponse } from '../services/opencode-config-apply'
import { logger } from '../utils/logger'

export function createOpenCodeConfigRoutes(settingsService: SettingsService, openCodeClient: OpenCodeClient) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const config = await withOpenCodeConfigLock(readOpenCodeConfigFile)
      if (!config) {
        return c.json({ error: 'No OpenCode config file found' }, 404)
      }
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get OpenCode config:', error)
      return c.json({ error: 'Failed to get OpenCode config' }, 500)
    }
  })

  app.get('/effective', async (c) => {
    try {
      const entries = await openCodeClient.api.config.get(openCodeLocation(getWorkspacePath()))
      return c.json({ entries })
    } catch (error) {
      logger.error('Failed to get effective OpenCode config:', error)
      if (error instanceof ClientError) {
        if (error.reason === 'Transport') {
          return c.json({ error: 'OpenCode server unavailable' }, 503)
        }
        return c.json({ error: 'Failed to get effective OpenCode config' }, 502)
      }
      return c.json({ error: 'Failed to get effective OpenCode config' }, 500)
    }
  })

  app.put('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = UpdateOpenCodeConfigRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid config data', details: parsed.error.issues }, 400)
    }

    try {
      const result = await applyOpenCodeConfigUpdate({
        content: parsed.data.content,
        source: parsed.data.source,
        expectedRevision: parsed.data.expectedRevision,
        settingsService,
        openCodeClient,
      })
      const { status, body: responseBody } = toOpenCodeConfigApplyResponse(result)
      return c.json(responseBody, status)
    } catch (error) {
      logger.error('Failed to update OpenCode config:', error)
      if (error instanceof OpenCodeConfigConflictError) {
        return c.json({
          error: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
        }, 409)
      }
      if (error instanceof OpenCodeConfigSourceInvalidError) {
        return c.json({ error: error.message, sources: error.sources }, 400)
      }
      if (error instanceof OpenCodeConfigShadowedRemovalError) {
        return c.json({ error: error.message, paths: error.paths, sources: error.sources }, 409)
      }
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      if (error instanceof SyntaxError) {
        return c.json({ error: 'Invalid config data', details: error.message }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode config' }, 500)
    }
  })

  return app
}
