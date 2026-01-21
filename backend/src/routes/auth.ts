import { Hono } from 'hono'
import type { AuthInstance } from '../auth'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'

export function createAuthRoutes(auth: AuthInstance, _db: Database) {
  const app = new Hono()

  app.all('/*', async (c) => {
    return auth.handler(c.req.raw)
  })

  return app
}

export function createAuthInfoRoutes(auth: AuthInstance, db: Database) {
  const app = new Hono()

  app.get('/config', async (c) => {
    const enabledProviders: string[] = ['credentials']
    
    if (ENV.AUTH.GITHUB_CLIENT_ID && ENV.AUTH.GITHUB_CLIENT_SECRET) {
      enabledProviders.push('github')
    }
    if (ENV.AUTH.GOOGLE_CLIENT_ID && ENV.AUTH.GOOGLE_CLIENT_SECRET) {
      enabledProviders.push('google')
    }
    if (ENV.AUTH.DISCORD_CLIENT_ID && ENV.AUTH.DISCORD_CLIENT_SECRET) {
      enabledProviders.push('discord')
    }

    enabledProviders.push('passkey')

    const hasUsers = db.prepare('SELECT COUNT(*) as count FROM "user"').get() as { count: number }
    
    return c.json({
      enabledProviders,
      registrationEnabled: true,
      isFirstUser: hasUsers.count === 0,
    })
  })

  app.get('/me', async (c) => {
    try {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      })

      if (!session) {
        return c.json({ user: null, session: null })
      }

      return c.json({
        user: session.user,
        session: {
          id: session.session.id,
          expiresAt: session.session.expiresAt,
        },
      })
    } catch {
      return c.json({ user: null, session: null })
    }
  })

  return app
}
