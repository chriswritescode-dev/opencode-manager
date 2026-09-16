import { Hono } from 'hono'
import { z } from 'zod'
import { UpdateOpenCodeConfigRequestSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import { readOpenCodeConfigFile } from '../../services/opencode-config-file'
import { applyOpenCodeConfigUpdate, toOpenCodeConfigApplyResponse } from '../../services/opencode-config-apply'
import { logger } from '../../utils/logger'

export function createInternalOpenCodeConfigRoutes(settingsService: SettingsService, openCodeClient: OpenCodeClient) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const config = await readOpenCodeConfigFile()
      if (!config) {
        return c.json({ error: 'No OpenCode config file found' }, 404)
      }
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get OpenCode config:', error)
      return c.json({ error: 'Failed to get OpenCode config' }, 500)
    }
  })

  app.put('/', async (c) => {
    const userId = c.req.query('userId') ?? 'default'

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
        openCodeClient,
        settingsService,
        userId,
      })
      const { status, body: responseBody } = toOpenCodeConfigApplyResponse(result)
      return c.json(responseBody, status)
    } catch (error) {
      logger.error('Failed to update OpenCode config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode config' }, 500)
    }
  })

  return app
}
