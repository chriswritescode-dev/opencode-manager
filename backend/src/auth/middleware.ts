import { createMiddleware } from 'hono/factory'
import { getTrustedOrigins, isTrustedOrigin } from '@opencode-manager/shared/config/env'
import type { AuthInstance, Session } from './index'
import { logger } from '../utils/logger'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const UNTRUSTED_FETCH_SITES = new Set(['same-site', 'cross-site'])

export function createAuthMiddleware(
  auth: AuthInstance,
  resolveTrustedOrigins: () => string[] = getTrustedOrigins,
) {
  return createMiddleware<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>(async (c, next) => {
    const origin = c.req.header('origin')

    const fetchSite = c.req.header('sec-fetch-site')
    if (
      UNSAFE_METHODS.has(c.req.method) &&
      fetchSite !== undefined &&
      UNTRUSTED_FETCH_SITES.has(fetchSite) &&
      !isTrustedOrigin(origin, { requireOrigin: true }, resolveTrustedOrigins())
    ) {
      logger.warn(`Rejected cross-site request - Path: ${c.req.path}, Method: ${c.req.method}, Origin: ${origin ?? 'none'}`)
      return c.json({ error: 'Cross-site request rejected' }, 403)
    }
    
    logger.debug(`Auth check - Path: ${c.req.path}, Origin: ${origin}`)
    
    let session
    try {
      session = await auth.api.getSession({
        headers: c.req.raw.headers,
      })
    } catch (error) {
      logger.error('Session lookup failed', { error })
      return c.json({ error: 'Internal Server Error' }, 500)
    }

    logger.debug(`Session result: ${session ? 'found' : 'not found'}`)

    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('session', session.session as Session['session'])
    c.set('user', session.user as Session['user'])
    await next()
  })
}


