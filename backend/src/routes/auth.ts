import { Hono } from 'hono'
import type { AuthInstance } from '../auth'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { hashPassword } from 'better-auth/crypto'

type PasskeyRow = {
  credentialID: string
  transports: string | null
}

function withAllowCredentials(body: string, passkeys: PasskeyRow[]): string {
  try {
    const options = JSON.parse(body) as {
      allowCredentials?: Array<{ id: string; type?: string; transports?: string[] }>
      [key: string]: unknown
    }
    if (options.allowCredentials?.length) {
      return body
    }
    if (!passkeys.length) {
      return body
    }
    options.allowCredentials = passkeys.map((pk) => ({
      id: pk.credentialID,
      type: 'public-key',
      transports: pk.transports
        ? pk.transports.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
    }))
    return JSON.stringify(options)
  } catch {
    return body
  }
}

export function createAuthRoutes(auth: AuthInstance, db?: Database): Hono {
  const app = new Hono()

  app.all('/*', async (c) => {
    const response = await auth.handler(c.req.raw)

    const setCookie = response.headers.get('set-cookie')
    if (c.req.path.includes('sign-in')) {
      logger.info(`Sign-in response - Status: ${response.status}, Set-Cookie: ${setCookie ? 'present' : 'missing'}`)
      if (setCookie) {
        logger.debug(`Set-Cookie header: ${setCookie.substring(0, 100)}...`)
      }
    }

    // better-auth only includes allowCredentials when a session exists.
    // Discoverable (empty) options often make Windows Hello cancel immediately.
    // Inject stored credential IDs so the authenticator can match the passkey.
    if (
      db &&
      response.ok &&
      c.req.method === 'GET' &&
      c.req.path.includes('generate-authenticate-options')
    ) {
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const passkeys = db
          .prepare('SELECT credentialID, transports FROM passkey')
          .all() as PasskeyRow[]
        const body = await response.text()
        const nextBody = withAllowCredentials(body, passkeys)
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        return new Response(nextBody, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }
    }

    return response
  })

  return app
}

const isAdminConfigured = (): boolean => {
  return !!(ENV.AUTH.ADMIN_EMAIL && ENV.AUTH.ADMIN_PASSWORD)
}

export async function syncAdminFromEnv(auth: AuthInstance, db: Database): Promise<void> {
  if (!isAdminConfigured()) return

  const adminEmail = ENV.AUTH.ADMIN_EMAIL!
  const adminPassword = ENV.AUTH.ADMIN_PASSWORD!

  const existingUser = db.prepare('SELECT id, email FROM "user" WHERE email = ?').get(adminEmail) as { id: string; email: string } | undefined

  if (existingUser) {
    if (ENV.AUTH.ADMIN_PASSWORD_RESET) {
      const hashedPassword = await hashPassword(adminPassword)
      db.prepare('UPDATE "account" SET password = ? WHERE "userId" = ? AND "providerId" = ?').run(
        hashedPassword,
        existingUser.id,
        'credential'
      )
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
      passkeyRpId: ENV.AUTH.PASSKEY_RP_ID,
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
