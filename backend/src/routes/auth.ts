import { Hono } from 'hono'
import { isAdminConfigured, type AuthInstance } from '../auth'
import { applyClientIpHeaders, resolveSocketIp } from '../auth/client-ip'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'

export function createAuthRoutes(auth: AuthInstance): Hono {
  const app = new Hono()

  app.all('/*', (c) => {
    applyClientIpHeaders(c.req.raw.headers, resolveSocketIp(c))
    return auth.handler(c.req.raw)
  })

  return app
}

export async function syncAdminFromEnv(auth: AuthInstance): Promise<void> {
  if (!isAdminConfigured()) return

  const adminEmail = ENV.AUTH.ADMIN_EMAIL!
  const adminPassword = ENV.AUTH.ADMIN_PASSWORD!

  const ctx = await auth.$context
  const existingAdmin = await ctx.internalAdapter.findUserByEmail(adminEmail)

  if (existingAdmin) {
    if (ENV.AUTH.ADMIN_PASSWORD_RESET) {
      const credentialAccount = (await ctx.internalAdapter.findAccounts(existingAdmin.user.id))
        .find((account) => account.providerId === 'credential')

      if (credentialAccount) {
        await ctx.internalAdapter.updateAccount(credentialAccount.id, {
          password: await ctx.password.hash(adminPassword),
        })
      } else {
        logger.warn(`No credential account found for ${adminEmail}; skipped the password reset`)
      }

      await ctx.internalAdapter.deleteUserSessions(existingAdmin.user.id)
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

export function createAuthInfoRoutes(auth: AuthInstance) {
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

    const userCount = await (await auth.$context).adapter.count({ model: 'user' })
    const adminConfigured = isAdminConfigured()
    
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
