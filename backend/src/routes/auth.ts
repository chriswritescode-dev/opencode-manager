import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { 
  createApiToken, 
  listApiTokens, 
  revokeApiToken, 
  deleteApiToken,
  validateToken,
  hasAnyTokens 
} from '../services/token'
import { logger } from '../utils/logger'

const CreateTokenSchema = z.object({
  comment: z.string().optional(),
})

export function createAuthRoutes(db: Database) {
  const app = new Hono()

  app.get('/verify', async (c) => {
    const authHeader = c.req.header('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ valid: false, needsSetup: !hasAnyTokens(db) })
    }
    
    const token = authHeader.slice(7)
    const validToken = validateToken(db, token)
    
    if (!validToken) {
      return c.json({ valid: false, needsSetup: !hasAnyTokens(db) })
    }
    
    return c.json({ 
      valid: true, 
      tokenId: validToken.id,
      comment: validToken.comment,
      needsSetup: false 
    })
  })

  app.post('/tokens', async (c) => {
    try {
      const body = await c.req.json()
      const parsed = CreateTokenSchema.safeParse(body)
      
      if (!parsed.success) {
        return c.json({ error: 'Invalid request body' }, 400)
      }
      
      const { token, record } = createApiToken(db, parsed.data.comment)
      
      return c.json({
        id: record.id,
        token,
        comment: record.comment,
        createdAt: record.createdAt,
      }, 201)
    } catch (error) {
      logger.error('Failed to create token:', error)
      return c.json({ error: 'Failed to create token' }, 500)
    }
  })

  app.get('/tokens', async (c) => {
    try {
      const tokens = listApiTokens(db)
      
      return c.json(tokens.map(t => ({
        id: t.id,
        comment: t.comment,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        isActive: t.isActive,
      })))
    } catch (error) {
      logger.error('Failed to list tokens:', error)
      return c.json({ error: 'Failed to list tokens' }, 500)
    }
  })

  app.delete('/tokens/:id', async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      
      if (isNaN(id)) {
        return c.json({ error: 'Invalid token ID' }, 400)
      }
      
      const deleted = deleteApiToken(db, id)
      
      if (!deleted) {
        return c.json({ error: 'Token not found' }, 404)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete token:', error)
      return c.json({ error: 'Failed to delete token' }, 500)
    }
  })

  app.post('/tokens/:id/revoke', async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10)
      
      if (isNaN(id)) {
        return c.json({ error: 'Invalid token ID' }, 400)
      }
      
      const revoked = revokeApiToken(db, id)
      
      if (!revoked) {
        return c.json({ error: 'Token not found' }, 404)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to revoke token:', error)
      return c.json({ error: 'Failed to revoke token' }, 500)
    }
  })

  return app
}
