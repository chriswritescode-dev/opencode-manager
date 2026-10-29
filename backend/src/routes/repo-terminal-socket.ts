import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Database } from 'bun:sqlite'
import type { UpgradeWebSocket } from 'hono/ws'
import { getTrustedOrigins, isTrustedOrigin } from '@opencode-manager/shared/config/env'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeClient } from '../services/opencode/client'
import type { TerminalService } from '../services/terminal'
import { createBridgedSocketEvents } from '../utils/websocket-bridge'
import { parseTerminalCursor } from '../utils/terminal-cursor'
import { resolveRepoRequestDirectory } from './repo-directory'
import type { Session } from '../auth'

interface RepoTerminalSocketVariables {
  terminalDirectory: string
  terminalCursor: number | undefined
  session?: Session['session']
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
    if (!isTrustedOrigin(c.req.header('origin'), {}, trustedOrigins)) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    const cursor = parseTerminalCursor(c.req.query('cursor'))
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
      const ptyID = c.req.param('ptyID') ?? ''

      return createBridgedSocketEvents(
        (peer) => terminalService.connect(directory, ptyID, cursor, peer),
        { sessionId: c.get('session')?.id },
      )
    }),
  )

  return app
}
