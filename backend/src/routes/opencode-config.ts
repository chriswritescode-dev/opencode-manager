import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  UpdateOpenCodeConfigPatchRequestSchema,
  UpdateOpenCodeConfigRequestSchema,
} from '@opencode-manager/shared/schemas'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import {
  ClientError,
  mcpServerViewsFromConfig,
  mcpStatusByName,
  openCodeLocation,
  type McpServerView,
  type McpStatusMap,
} from '@opencode-manager/shared/opencode'
import type { SettingsService } from '../services/settings'
import type { OpenCodeClient } from '../services/opencode/client'
import {
  OpenCodeConfigConflictError,
  OpenCodeConfigRedactedValueError,
  OpenCodeConfigShadowedRemovalError,
  OpenCodeConfigSourceInvalidError,
  readOpenCodeConfigFile,
  withOpenCodeConfigLock,
} from '../services/opencode-config-file'
import { applyOpenCodeConfigUpdate, toOpenCodeConfigApplyResponse } from '../services/opencode-config-apply'
import { redactOpenCodeConfigContent, redactOpenCodeConfigFile } from '../services/opencode-config-redact'
import { logger } from '../utils/logger'

interface OpenCodeConfigRoutesOptions {
  redactSecrets?: boolean
}

async function readMcpStatus(openCodeClient: OpenCodeClient): Promise<McpStatusMap> {
  try {
    const servers = await openCodeClient.api.mcp.list(openCodeLocation(getWorkspacePath()))
    return mcpStatusByName(servers.data)
  } catch (error) {
    logger.warn('Failed to read live MCP server status:', error)
    return {}
  }
}

function mergeMcpServerStatus(views: McpServerView[], status: McpStatusMap) {
  return views.map((view) => {
    const live = status[view.name]
    if (!live) return view
    return {
      ...view,
      status: live.status,
      ...('error' in live && live.error ? { error: live.error } : {}),
    }
  })
}

export function createOpenCodeConfigRoutes(
  settingsService: SettingsService,
  openCodeClient: OpenCodeClient,
  options: OpenCodeConfigRoutesOptions = {},
) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const config = await withOpenCodeConfigLock(readOpenCodeConfigFile)
      if (!config) {
        return c.json({ error: 'No OpenCode config file found' }, 404)
      }
      return c.json(options.redactSecrets ? redactOpenCodeConfigFile(config) : config)
    } catch (error) {
      logger.error('Failed to get OpenCode config:', error)
      return c.json({ error: 'Failed to get OpenCode config' }, 500)
    }
  })

  app.get('/effective', async (c) => {
    try {
      const entries = await openCodeClient.api.config.get(openCodeLocation(getWorkspacePath()))
      return c.json({
        entries: options.redactSecrets
          ? entries.map((entry) =>
              entry.type === 'document'
                ? {
                    ...entry,
                    info: redactOpenCodeConfigContent(entry.info).content as typeof entry.info,
                  }
                : entry,
            )
          : entries,
      })
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

  app.get('/mcp', async (c) => {
    try {
      const [config, status] = await Promise.all([
        withOpenCodeConfigLock(readOpenCodeConfigFile),
        readMcpStatus(openCodeClient),
      ])
      const views = mcpServerViewsFromConfig(config?.content.mcp)
      return c.json({
        revision: config?.revision ?? null,
        servers: mergeMcpServerStatus(views, status),
      })
    } catch (error) {
      logger.error('Failed to get OpenCode MCP servers:', error)
      return c.json({ error: 'Failed to get OpenCode MCP servers' }, 500)
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

    return applyUpdate(c, {
      content: parsed.data.content,
      source: parsed.data.source,
      expectedRevision: parsed.data.expectedRevision,
      settingsService,
      openCodeClient,
    }, options.redactSecrets)
  })

  app.patch('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = UpdateOpenCodeConfigPatchRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid config data', details: parsed.error.issues }, 400)
    }

    return applyUpdate(c, {
      content: parsed.data.patch,
      source: parsed.data.source,
      expectedRevision: parsed.data.expectedRevision,
      mode: 'merge',
      settingsService,
      openCodeClient,
    }, options.redactSecrets)
  })

  return app
}

async function applyUpdate(
  c: Context,
  input: Parameters<typeof applyOpenCodeConfigUpdate>[0],
  redactSecrets = false,
) {
  try {
    const result = await applyOpenCodeConfigUpdate(input)
    const response = toOpenCodeConfigApplyResponse(result)
    if (!redactSecrets) {
      return c.json(response.body, response.status)
    }
    return c.json({
      ...redactOpenCodeConfigFile(result.config),
      ...(result.status === 'restart_pending' ? { restartRequired: true } : {}),
    }, response.status)
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
    if (error instanceof OpenCodeConfigRedactedValueError) {
      return c.json({ error: error.message, paths: error.paths }, 400)
    }
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid config data', details: error.issues }, 400)
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Invalid config data', details: error.message }, 400)
    }
    return c.json({ error: 'Failed to update OpenCode config' }, 500)
  }
}
