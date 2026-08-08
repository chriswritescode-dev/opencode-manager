import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { getOrCreateInternalToken } from '../services/internal-token'

function extractTokenFromBasic(header: string): string | null {
  if (!header.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colonIndex = decoded.indexOf(':')
  if (colonIndex === -1) return null
  return decoded.slice(colonIndex + 1)
}

function tokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createInternalTokenMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!header) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const expected = getOrCreateInternalToken(db)

    if (header.startsWith('Bearer ')) {
      if (!tokenMatch(header.slice(7), expected)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    } else if (header.startsWith('Basic ')) {
      const password = extractTokenFromBasic(header)
      if (!password || !tokenMatch(password, expected)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    } else {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
  })
}
