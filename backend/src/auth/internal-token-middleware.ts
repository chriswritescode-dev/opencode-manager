import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { getOrCreateInternalToken } from '../services/internal-token'

export function createInternalTokenMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const provided = Buffer.from(header.slice(7))
    const expected = Buffer.from(getOrCreateInternalToken(db))
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })
}
