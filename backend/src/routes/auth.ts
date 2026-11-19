import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { isAdminConfigured, type AuthEnv, type AuthInstance, type Session } from '../auth'
import { applyClientIpHeaders, resolveSocketIp } from '../auth/client-ip'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { deletePushSubscriptionsForSessions } from '../db/push-subscriptions'

export type AuthRouteHandler = Pick<AuthInstance, 'handler'>

export interface AuthSessionReader {
  getSession(context: { headers: Headers }): Promise<Session | null>
}

export interface AuthInfoProvider {
  api: AuthSessionReader
  $context: AuthInstance['$context']
}

export function createAuthRoutes(auth: AuthRouteHandler): Hono {
  const app = new Hono()

  app.all('/*', (c) => {
    applyClientIpHeaders(c.req.raw.headers, resolveSocketIp(c))
    return auth.handler(c.req.raw)
  })

  return app
}

export async function syncAdminFromEnv(auth: AuthInstance, db: Database, env: AuthEnv = ENV.AUTH): Promise<void> {
  if (!isAdminConfigured(env)) return

  const adminEmail = env.ADMIN_EMAIL ?? ''
  const adminPassword = env.ADMIN_PASSWORD ?? ''

  const ctx = await auth.$context
  const existingAdmin = await ctx.adapter.findOne<{ id: string }>({
    model: 'user',
    where: [{ field: 'email', value: adminEmail, mode: 'insensitive' }],
  })

  if (existingAdmin) {
    if (env.ADMIN_PASSWORD_RESET) {
      const credentialAccount = (await ctx.internalAdapter.findAccounts(existingAdmin.id))
        .find((account) => account.providerId === 'credential')

      if (credentialAccount) {
        await ctx.internalAdapter.updateAccount(credentialAccount.id, {
          password: await ctx.password.hash(adminPassword),
        })
      } else {
        logger.warn(`No credential account found for ${adminEmail}; skipped the password reset`)
      }

      const sessions = await ctx.internalAdapter.listSessions(existingAdmin.id)
      await ctx.internalAdapter.deleteUserSessions(existingAdmin.id)
      deletePushSubscriptionsForSessions(db, sessions.map((session) => session.id))
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

export function createAuthInfoRoutes(auth: AuthInfoProvider, env: AuthEnv = ENV.AUTH) {
  const app = new Hono()

  app.get('/config', async (c) => {
    const enabledProviders: string[] = ['credentials']
    
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
      enabledProviders.push('github')
    }
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      enabledProviders.push('google')
    }
    if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
      enabledProviders.push('discord')
    }

    enabledProviders.push('passkey')

    const userCount = await (await auth.$context).adapter.count({ model: 'user' })
    const adminConfigured = isAdminConfigured(env)
    
    return c.json({
      enabledProviders,
      registrationEnabled: !adminConfigured,
      isFirstUser: userCount === 0,
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
