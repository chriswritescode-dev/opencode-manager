import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import type { UpgradeWebSocket } from 'hono/ws'
import { getTrustedOrigins } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeClient } from '../services/opencode/client'
import type { TerminalService } from '../services/terminal'
import { createBridgedSocketEvents, isAllowedUpgradeOrigin } from '../utils/websocket-bridge'
import { resolveRepoRequestDirectory } from './repo-directory'

interface RepoTerminalSocketVariables {
  terminalDirectory: string
  terminalCursor: number | undefined
}

function parseCursor(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined
  if (!/^-?\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < -1) return null
  return parsed
}

export function createRepoTerminalSocketRoutes(
  database: Database,
  gitAuthService: GitAuthService,
  openCodeClient: OpenCodeClient,
  terminalService: TerminalService,
  upgradeWebSocket: UpgradeWebSocket,
  trustedOrigins: readonly string[] = getTrustedOrigins(),
) {
  const app = new Hono<{ Variables: RepoTerminalSocketVariables }>()
  const deps = { database, gitAuthService, openCodeClient }

  const validate: MiddlewareHandler<{ Variables: RepoTerminalSocketVariables }> = async (c, next) => {
    if (!isAllowedUpgradeOrigin(c.req.header('origin'), trustedOrigins)) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    const cursor = parseCursor(c.req.query('cursor'))
    if (cursor === null) {
      return c.json({ error: 'Invalid cursor' }, 400)
    }

    const resolved = await resolveRepoRequestDirectory(c, deps, c.req.param('id') ?? '', c.req.query('directory'), {
      allowAssistant: true,
    })
    if (resolved instanceof Response) return resolved

    c.set('terminalDirectory', resolved.directory)
    c.set('terminalCursor', cursor)
    await next()
  }

  app.get(
    '/:id/terminals/:ptyID/connect',
    validate,
    upgradeWebSocket((c) => {
      const directory = c.get('terminalDirectory')
      const cursor = c.get('terminalCursor')
      const ptyID = c.req.param('ptyID')

      return createBridgedSocketEvents((peer) => terminalService.connect(directory, ptyID, cursor, peer))
    }),
  )

  return app
}
