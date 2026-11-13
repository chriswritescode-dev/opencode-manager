import { Hono, type Context } from 'hono'
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
  OpenCodeConfigValidationError,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  withOpenCodeConfigLock,
} from '../services/opencode-config-file'
import { readManagedOpenCodeConfig } from '../services/opencode-config-effective'
import { applyOpenCodeConfigUpdate, toOpenCodeConfigApplyResponse } from '../services/opencode-config-apply'
import { redactOpenCodeConfigContent, redactOpenCodeConfigFile } from '../services/opencode-config-redact'
import { patchNamesOpenCodeConfigEntities } from '../services/opencode-config-references'
import { opencodeServerManager } from '../services/opencode-single-server'
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
    const merged = { ...view, status: live.status }
    return 'error' in live && live.error ? { ...merged, error: live.error } : merged
  })
}

function toClientReadErrorResponse(c: Context, cause: unknown, message: string) {
  if (cause instanceof ClientError) {
    if (cause.reason === 'Transport') {
      return c.json({ error: 'OpenCode server unavailable' }, 503)
    }
    return c.json({ error: message }, 502)
  }
  return c.json({ error: message }, 500)
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
                    info: redactOpenCodeConfigContent(entry.info).content,
                  }
                : entry,
            )
          : entries,
      })
    } catch (error) {
      logger.error('Failed to get effective OpenCode config:', error)
      return toClientReadErrorResponse(c, error, 'Failed to get effective OpenCode config')
    }
  })

  app.get('/managed', async (c) => {
    try {
      const snapshot = await withOpenCodeConfigLock(readOpenCodeConfigSnapshot)
      const info = await readManagedOpenCodeConfig(openCodeClient.api, snapshot.sources)
      return c.json({
        info: options.redactSecrets
          ? redactOpenCodeConfigContent(info).content
          : info,
      })
    } catch (error) {
      logger.error('Failed to get managed OpenCode config:', error)
      return toClientReadErrorResponse(c, error, 'Failed to get managed OpenCode config')
    }
  })

  app.get('/mcp', async (c) => {
    try {
      const snapshot = await withOpenCodeConfigLock(readOpenCodeConfigSnapshot)
      const [info, status] = await Promise.all([
        readManagedOpenCodeConfig(openCodeClient.api, snapshot.sources),
        readMcpStatus(openCodeClient),
      ])
      const views = mcpServerViewsFromConfig(info.mcp)
      return c.json({
        revision: snapshot.revision,
        servers: mergeMcpServerStatus(views, status),
      })
    } catch (error) {
      logger.error('Failed to get OpenCode MCP servers:', error)
      return toClientReadErrorResponse(c, error, 'Failed to get OpenCode MCP servers')
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

    if (opencodeServerManager.isRestartPending() && patchNamesOpenCodeConfigEntities(parsed.data.patch)) {
      return c.json({
        error: 'OpenCode has not loaded the saved configuration yet. Restart OpenCode before editing entries.',
      }, 409)
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
    const redactedConfig = redactOpenCodeConfigFile(result.config)
    return c.json(
      result.status === 'restart_pending' ? { ...redactedConfig, restartRequired: true } : redactedConfig,
      response.status,
    )
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
    if (error instanceof OpenCodeConfigValidationError) {
      return c.json({ error: 'Invalid config data', validationIssues: error.issues }, 400)
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Invalid config data', details: error.message }, 400)
    }
    return toClientReadErrorResponse(c, error, 'Failed to update OpenCode config')
  }
}
