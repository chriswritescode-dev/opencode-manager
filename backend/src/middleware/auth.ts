import type { Context, Next } from 'hono'
import type { Database } from 'bun:sqlite'
import { validateToken } from '../services/token'
import { ENV } from '@opencode-manager/shared/config/env'

const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/verify',
]

const PUBLIC_PREFIXES = [
  '/assets/',
  '/static/',
]

export function createAuthMiddleware(db: Database) {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    
    if (ENV.SERVER.DISABLE_AUTH === 'true') {
      return next()
    }
    
    if (PUBLIC_PATHS.includes(path)) {
      return next()
    }
    
    for (const prefix of PUBLIC_PREFIXES) {
      if (path.startsWith(prefix)) {
        return next()
      }
    }
    
    if (!path.startsWith('/api/')) {
      return next()
    }
    
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader) {
      return c.json({ error: 'Authorization header required' }, 401)
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Invalid authorization format. Use: Bearer <token>' }, 401)
    }
    
    const token = authHeader.slice(7)
    
    if (!token) {
      return c.json({ error: 'Token required' }, 401)
    }
    
    const validToken = validateToken(db, token)
    
    if (!validToken) {
      return c.json({ error: 'Invalid or expired token' }, 401)
    }
    
    c.set('tokenId', validToken.id)
    c.set('tokenComment', validToken.comment)
    
    return next()
  }
}
