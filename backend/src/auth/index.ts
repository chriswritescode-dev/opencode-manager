import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { passkey } from '@better-auth/passkey'
import { Database } from 'bun:sqlite'
import { ENV, getTrustedOrigins } from '@opencode-manager/shared/config/env'
import { AUTH_COOKIE_PREFIX } from './cookies'
import { AUTH_SOCKET_IP_HEADER } from './client-ip'
import { devicePairing } from './device-pairing'
import { closeSessionConnections } from '../services/session-connections'
import { deletePushSubscriptionsForSession } from '../db/push-subscriptions'

export type AuthEnv = { -readonly [Key in keyof typeof ENV.AUTH]: (typeof ENV.AUTH)[Key] }

export type AuthInstance = ReturnType<typeof createAuth>

export interface AuthServerConfig {
  trustedOrigins: string[]
  port: number
}

export function isAdminConfigured(env: AuthEnv = ENV.AUTH): boolean {
  return !!(env.ADMIN_EMAIL && env.ADMIN_PASSWORD)
}

export function createAuth(
  db: Database,
  env: AuthEnv = ENV.AUTH,
  serverConfig: AuthServerConfig = { trustedOrigins: getTrustedOrigins(), port: ENV.SERVER.PORT },
) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }
  }

  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    }
  }

  const { trustedOrigins } = serverConfig
  const baseURL = trustedOrigins[0] || `http://localhost:${serverConfig.port}`
  
  const auth = betterAuth({
    baseURL,
    basePath: '/api/auth',
    database: db,
    secret: env.SECRET,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    databaseHooks: {
      session: {
        delete: {
          after: async (session) => {
            closeSessionConnections(session.id)
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            if (isAdminConfigured(env) && (context?.request || user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? '').toLowerCase())) {
              throw new APIError('FORBIDDEN', { message: 'Registration is disabled' })
            }
          },
        },
      },
    },
    plugins: [
      passkey({
        rpID: env.PASSKEY_RP_ID,
        rpName: env.PASSKEY_RP_NAME,
        origin: env.PASSKEY_ORIGIN,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      }),
      devicePairing({
        onDeviceRevoked: (sessionId) => deletePushSubscriptionsForSession(db, sessionId),
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
      },
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: env.SECURE_COOKIES,
      ipAddress: {
        ipAddressHeaders: [AUTH_SOCKET_IP_HEADER],
      },
    },
  })

  return auth
}

export type Session = {
  session: {
    id: string
    userId: string
    token: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
    ipAddress?: string | null
    userAgent?: string | null
    deviceName?: string | null
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image?: string | null
    createdAt: Date
    updatedAt: Date
    role?: string | null
  }
}
