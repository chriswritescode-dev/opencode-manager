import { createMiddleware } from 'hono/factory'
import type { AuthInstance, Session } from './index'
import { logger } from '../utils/logger'

export function createAuthMiddleware(auth: AuthInstance) {
  return createMiddleware<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>(async (c, next) => {
    const cookies = c.req.header('cookie')
    const origin = c.req.header('origin')
    
    logger.debug(`Auth check - Path: ${c.req.path}, Origin: ${origin}, Has cookies: ${!!cookies}`)
    if (cookies) {
      const cookieNames = cookies.split(';').map(c => c.trim().split('=')[0]).join(', ')
      logger.debug(`Cookie names: ${cookieNames}`)
    }
    
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


