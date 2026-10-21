import { Hono } from 'hono'
import { isAdminConfigured, type AuthInstance } from '../auth'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { hashPassword } from 'better-auth/crypto'

export function createAuthRoutes(auth: AuthInstance): Hono {
  const app = new Hono()

  app.all('/*', (c) => auth.handler(c.req.raw))

  return app
}

export async function syncAdminFromEnv(auth: AuthInstance, db: Database): Promise<void> {
  if (!isAdminConfigured()) return

  const adminEmail = ENV.AUTH.ADMIN_EMAIL!
  const adminPassword = ENV.AUTH.ADMIN_PASSWORD!

  const existingUser = db.prepare('SELECT id, email FROM "user" WHERE lower(email) = lower(?)').get(adminEmail) as { id: string; email: string } | undefined

  if (existingUser) {
    if (ENV.AUTH.ADMIN_PASSWORD_RESET) {
      const hashedPassword = await hashPassword(adminPassword)
      const resetAdminCredentials = db.transaction(() => {
        db.prepare('UPDATE "account" SET password = ? WHERE "userId" = ? AND "providerId" = ?').run(
          hashedPassword,
          existingUser.id,
          'credential'
        )
        db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(existingUser.id)
      })
      resetAdminCredentials()
      logger.info(`Admin password reset from environment for ${adminEmail}`)
      logger.warn('Remove ADMIN_PASSWORD_RESET=true from environment after password reset')
    }
    return
  }

  try {
    await auth.api.signUpEmail({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: 'Admin',
      },
    })
    logger.info(`Admin user created from environment: ${adminEmail}`)
  } catch (error) {
    logger.error('Failed to create admin user from environment:', error)
  }
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
    const adminConfigured = isAdminConfigured()
    
    return c.json({
      enabledProviders,
      registrationEnabled: !adminConfigured,
      isFirstUser: hasUsers.count === 0,
      adminConfigured,
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
