import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { getTrustedOrigins } from '@opencode-manager/shared/config/env'
import {
  CreateTerminalRequestSchema,
  LOCAL_OPENCODE_SERVER_ID,
  ResizeTerminalRequestSchema,
} from '@opencode-manager/shared/schemas'
import { OpenCodeServerError } from '../services/opencode-server-registry'
import { TerminalNotFoundError, type TerminalService } from '../services/terminal'
import { parseTerminalCursor } from '../utils/terminal-cursor'
import { createBridgedSocketEvents, isAllowedUpgradeOrigin } from '../utils/websocket-bridge'
import { handleOpenCodeError, handleServiceError, parseJsonBody } from '../utils/route-helpers'
import type { Session } from '../auth'

export type ServerTerminalServiceResolver = (serverId: string) => TerminalService

interface ServerTerminalSocketVariables {
  terminalService: TerminalService
  terminalDirectory: string
  terminalCursor: number | undefined
  session?: Session['session']
}

function isAbsoluteDirectory(directory: string): boolean {
  return directory.startsWith('/') || /^[A-Za-z]:[\\/]/.test(directory)
}

function readAbsoluteDirectory(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const directory = raw.trim()
  return directory.length > 0 && isAbsoluteDirectory(directory) ? directory : null
}

function rejectLocalServer(c: Context, serverId: string): Response | null {
  if (serverId !== LOCAL_OPENCODE_SERVER_ID) return null
  return c.json({ error: 'Local terminals are served by the repo terminal routes' }, 400)
}

function rejectDirectory(c: Context): Response {
  return c.json({ error: 'An absolute directory is required' }, 400)
}

function handleTerminalError(c: Context, error: unknown) {
  if (error instanceof TerminalNotFoundError) {
    return c.json({ error: error.message }, 404)
  }
  if (error instanceof OpenCodeServerError) {
    return handleServiceError(c, error, 'Terminal request failed', OpenCodeServerError)
  }
  return handleOpenCodeError(c, error, 'Terminal request failed')
}

export function createOpenCodeServerTerminalRoutes(resolveTerminalService: ServerTerminalServiceResolver) {
  const app = new Hono()

  app.get('/:serverId/terminals', async (c) => {
    const serverId = c.req.param('serverId')
    const local = rejectLocalServer(c, serverId)
    if (local) return local

    const directory = readAbsoluteDirectory(c.req.query('directory'))
    if (directory === null) return rejectDirectory(c)

    try {
      const terminals = await resolveTerminalService(serverId).list(directory)
      return c.json({ terminals })
    } catch (error: unknown) {
      return handleTerminalError(c, error)
    }
  })

  app.post('/:serverId/terminals', async (c) => {
    const serverId = c.req.param('serverId')
    const local = rejectLocalServer(c, serverId)
    if (local) return local

    const parsed = await parseJsonBody(c, CreateTerminalRequestSchema, { allowEmpty: true })
    if (!parsed.ok) return parsed.response

    const directory = readAbsoluteDirectory(parsed.data.directory)
    if (directory === null) return rejectDirectory(c)

    try {
      const terminal = await resolveTerminalService(serverId).create(directory, {
        kind: 'shell',
        name: parsed.data.title ?? 'Terminal',
      })
      return c.json(terminal)
    } catch (error: unknown) {
      return handleTerminalError(c, error)
    }
  })

  app.patch('/:serverId/terminals/:ptyID', async (c) => {
    const serverId = c.req.param('serverId')
    const local = rejectLocalServer(c, serverId)
    if (local) return local

    const parsed = await parseJsonBody(c, ResizeTerminalRequestSchema)
    if (!parsed.ok) return parsed.response

    const directory = readAbsoluteDirectory(parsed.data.directory)
    if (directory === null) return rejectDirectory(c)

    const ptyID = c.req.param('ptyID')

    try {
      const terminalService = resolveTerminalService(serverId)
      await terminalService.requireTerminal(directory, ptyID)
      await terminalService.resize(directory, ptyID, { cols: parsed.data.cols, rows: parsed.data.rows })
      return c.json({ success: true })
    } catch (error: unknown) {
      return handleTerminalError(c, error)
    }
  })

  app.delete('/:serverId/terminals/:ptyID', async (c) => {
    const serverId = c.req.param('serverId')
    const local = rejectLocalServer(c, serverId)
    if (local) return local

    const directory = readAbsoluteDirectory(c.req.query('directory'))
    if (directory === null) return rejectDirectory(c)

    const ptyID = c.req.param('ptyID')

    try {
      const terminalService = resolveTerminalService(serverId)
      await terminalService.requireTerminal(directory, ptyID)
      await terminalService.remove(directory, ptyID)
      return c.json({ success: true })
    } catch (error: unknown) {
      return handleTerminalError(c, error)
    }
  })

  return app
}

export function createOpenCodeServerTerminalSocketRoutes(
  resolveTerminalService: ServerTerminalServiceResolver,
  upgradeWebSocket: UpgradeWebSocket,
  trustedOrigins: readonly string[] = getTrustedOrigins(),
) {
  const app = new Hono<{ Variables: ServerTerminalSocketVariables }>()

  const validate: MiddlewareHandler<{ Variables: ServerTerminalSocketVariables }> = async (c, next) => {
    if (!isAllowedUpgradeOrigin(c.req.header('origin'), trustedOrigins)) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    const serverId = c.req.param('serverId') ?? ''
    const local = rejectLocalServer(c, serverId)
    if (local) return local

    const cursor = parseTerminalCursor(c.req.query('cursor'))
    if (cursor === null) {
      return c.json({ error: 'Invalid cursor' }, 400)
    }

    const directory = readAbsoluteDirectory(c.req.query('directory'))
    if (directory === null) return rejectDirectory(c)

    try {
      c.set('terminalService', resolveTerminalService(serverId))
    } catch (error: unknown) {
      return handleTerminalError(c, error)
    }

    c.set('terminalDirectory', directory)
    c.set('terminalCursor', cursor)
    await next()
  }

  app.get(
    '/:serverId/terminals/:ptyID/connect',
    validate,
    upgradeWebSocket((c) => {
      const terminalService = c.get('terminalService')
      const directory = c.get('terminalDirectory')
      const cursor = c.get('terminalCursor')
      const ptyID = c.req.param('ptyID')

      return createBridgedSocketEvents(
        (peer) => terminalService.connect(directory, ptyID, cursor, peer),
        { sessionId: c.get('session')?.id },
      )
    }),
  )

  return app
}
