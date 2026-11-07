import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { getTrustedOrigins } from '@opencode-manager/shared/config/env'
import { CreateTerminalRequestSchema, ResizeTerminalRequestSchema } from '@opencode-manager/shared/schemas'
import type { ChatService } from '../services/chats'
import { TerminalNotFoundError, type TerminalService } from '../services/terminal'
import { createBridgedSocketEvents, isAllowedUpgradeOrigin } from '../utils/websocket-bridge'
import { parseTerminalCursor } from '../utils/terminal-cursor'
import { handleOpenCodeError } from '../utils/route-helpers'
import type { Session } from '../auth'

export function createChatTerminalRoutes(chatService: ChatService, terminalService: TerminalService) {
  const app = new Hono()

  app.get('/:chatId/terminals', async (c) => {
    const chat = await chatService.resolve(c.req.param('chatId'))
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    try {
      const terminals = await terminalService.list(chat.directory)
      return c.json({ terminals })
    } catch (error: unknown) {
      return handleOpenCodeError(c, error, 'Terminal request failed')
    }
  })

  app.post('/:chatId/terminals', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = CreateTerminalRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    const chat = await chatService.resolve(c.req.param('chatId'))
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    try {
      const terminal = await terminalService.create(chat.directory, {
        kind: 'shell',
        name: parsed.data.title ?? 'Terminal',
      })
      return c.json(terminal)
    } catch (error: unknown) {
      return handleOpenCodeError(c, error, 'Terminal request failed')
    }
  })

  app.patch('/:chatId/terminals/:ptyID', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = ResizeTerminalRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    const chat = await chatService.resolve(c.req.param('chatId'))
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    const ptyID = c.req.param('ptyID')

    try {
      await terminalService.requireTerminal(chat.directory, ptyID)
      await terminalService.resize(chat.directory, ptyID, { cols: parsed.data.cols, rows: parsed.data.rows })
      return c.json({ success: true })
    } catch (error: unknown) {
      if (error instanceof TerminalNotFoundError) {
        return c.json({ error: error.message }, 404)
      }
      return handleOpenCodeError(c, error, 'Terminal request failed')
    }
  })

  app.delete('/:chatId/terminals/:ptyID', async (c) => {
    const chat = await chatService.resolve(c.req.param('chatId'))
    if (!chat) return c.json({ error: 'Chat not found' }, 404)

    const ptyID = c.req.param('ptyID')

    try {
      await terminalService.requireTerminal(chat.directory, ptyID)
      await terminalService.remove(chat.directory, ptyID)
      return c.json({ success: true })
    } catch (error: unknown) {
      if (error instanceof TerminalNotFoundError) {
        return c.json({ error: error.message }, 404)
      }
      return handleOpenCodeError(c, error, 'Terminal request failed')
    }
  })

  return app
}

interface ChatTerminalSocketVariables {
  terminalDirectory: string
  terminalCursor: number | undefined
  session?: Session['session']
}

export function createChatTerminalSocketRoutes(
  chatService: ChatService,
  terminalService: TerminalService,
  upgradeWebSocket: UpgradeWebSocket,
  trustedOrigins: readonly string[] = getTrustedOrigins(),
) {
  const app = new Hono<{ Variables: ChatTerminalSocketVariables }>()

  const validate: MiddlewareHandler<{ Variables: ChatTerminalSocketVariables }> = async (c, next) => {
    if (!isAllowedUpgradeOrigin(c.req.header('origin'), trustedOrigins)) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    const cursor = parseTerminalCursor(c.req.query('cursor'))
    if (cursor === null) {
      return c.json({ error: 'Invalid cursor' }, 400)
    }

    const chat = await chatService.resolve(c.req.param('chatId') ?? '')
    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404)
    }

    c.set('terminalDirectory', chat.directory)
    c.set('terminalCursor', cursor)
    await next()
  }

  app.get(
    '/:chatId/terminals/:ptyID/connect',
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
