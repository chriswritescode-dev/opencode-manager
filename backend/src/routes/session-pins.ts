import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { ToggleSessionPinRequestSchema } from '@opencode-manager/shared/schemas'
import { listSessionPins, setSessionPin } from '../db/session-pins'
import { getErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

export function createSessionPinRoutes(database: Database) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      return c.json({ pins: listSessionPins(database) })
    } catch (error) {
      logger.error('Failed to list session pins', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.put('/', async (c) => {
    try {
      const body = await c.req.json()
      const input = ToggleSessionPinRequestSchema.parse(body)
      const pins = setSessionPin(database, input.sessionId, input.directory, input.pinned)
      return c.json({ pins })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request' }, 400)
      }
      logger.error('Failed to toggle session pin', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
