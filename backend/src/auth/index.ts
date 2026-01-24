import { betterAuth } from 'better-auth'
import { passkey } from '@better-auth/passkey'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'

export type AuthInstance = ReturnType<typeof createAuth>

export function createAuth(db: Database) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}

  if (ENV.AUTH.GITHUB_CLIENT_ID && ENV.AUTH.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: ENV.AUTH.GITHUB_CLIENT_ID,
      clientSecret: ENV.AUTH.GITHUB_CLIENT_SECRET,
    }
  }

  if (ENV.AUTH.GOOGLE_CLIENT_ID && ENV.AUTH.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: ENV.AUTH.GOOGLE_CLIENT_ID,
      clientSecret: ENV.AUTH.GOOGLE_CLIENT_SECRET,
    }
  }

  if (ENV.AUTH.DISCORD_CLIENT_ID && ENV.AUTH.DISCORD_CLIENT_SECRET) {
    socialProviders.discord = {
      clientId: ENV.AUTH.DISCORD_CLIENT_ID,
      clientSecret: ENV.AUTH.DISCORD_CLIENT_SECRET,
    }
  }

  const auth = betterAuth({
    database: db,
    secret: ENV.AUTH.SECRET,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    plugins: [
      passkey({
        rpID: ENV.AUTH.PASSKEY_RP_ID,
        rpName: ENV.AUTH.PASSKEY_RP_NAME,
        origin: ENV.AUTH.PASSKEY_ORIGIN,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
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
      cookiePrefix: 'opencode',
      useSecureCookies: ENV.SERVER.NODE_ENV === 'production',
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
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image?: string | null
    createdAt: Date
    updatedAt: Date
    role?: string
  }
}
