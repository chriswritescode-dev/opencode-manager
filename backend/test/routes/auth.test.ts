import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAuthInfoRoutes, createAuthRoutes, syncAdminFromEnv } from '../../src/routes/auth'
import { createAuth, type AuthInstance, type Session } from '../../src/auth'
import { registerSessionConnection } from '../../src/services/session-connections'
import { createAuthDatabase } from '../helpers/auth-database'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: {
      SECRET: 'test-secret-for-encryption-key-32c',
      TRUSTED_ORIGINS: 'http://localhost:5173,http://localhost:5003',
      SECURE_COOKIES: false,
      ADMIN_EMAIL: undefined as string | undefined,
      ADMIN_PASSWORD: undefined as string | undefined,
      ADMIN_PASSWORD_RESET: false,
      GITHUB_CLIENT_ID: undefined as string | undefined,
      GITHUB_CLIENT_SECRET: undefined as string | undefined,
      GOOGLE_CLIENT_ID: undefined as string | undefined,
      GOOGLE_CLIENT_SECRET: undefined as string | undefined,
      DISCORD_CLIENT_ID: undefined as string | undefined,
      DISCORD_CLIENT_SECRET: undefined as string | undefined,
      PASSKEY_RP_ID: 'localhost',
      PASSKEY_RP_NAME: 'OpenCode Manager',
      PASSKEY_ORIGIN: 'http://localhost:5003',
    },
    LOGGING: { DEBUG: false, LOG_LEVEL: 'info' },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV,
  getTrustedOrigins: () => ENV.AUTH.TRUSTED_ORIGINS
    .split(',')
    .map((origin: string) => origin.trim())
    .filter((origin: string) => origin.length > 0),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { logger } from '../../src/utils/logger'

const mockLoggerInfo = vi.mocked(logger.info)
const mockLoggerWarn = vi.mocked(logger.warn)
const mockLoggerError = vi.mocked(logger.error)
const mockLoggerDebug = vi.mocked(logger.debug)

const ORIGIN = 'http://localhost:5173'
const SIGN_IN_URL = `${ORIGIN}/api/auth/sign-in/email`

function resetEnv(): void {
  ENV.AUTH.TRUSTED_ORIGINS = 'http://localhost:5173,http://localhost:5003'
  ENV.AUTH.SECURE_COOKIES = false
  ENV.AUTH.ADMIN_EMAIL = undefined
  ENV.AUTH.ADMIN_PASSWORD = undefined
  ENV.AUTH.ADMIN_PASSWORD_RESET = false
  ENV.AUTH.GITHUB_CLIENT_ID = undefined
  ENV.AUTH.GITHUB_CLIENT_SECRET = undefined
  ENV.AUTH.GOOGLE_CLIENT_ID = undefined
  ENV.AUTH.GOOGLE_CLIENT_SECRET = undefined
  ENV.AUTH.DISCORD_CLIENT_ID = undefined
  ENV.AUTH.DISCORD_CLIENT_SECRET = undefined
}

function cookieHeaders(response: Response): Headers {
  return new Headers({
    cookie: response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; '),
  })
}

function signInRequest(auth: AuthInstance, email: string, password: string): Promise<Response> {
  return auth.handler(new Request(SIGN_IN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  }))
}

async function createUserSession(auth: AuthInstance, email: string, password: string): Promise<Headers> {
  const response = await signInRequest(auth, email, password)
  expect(response.status).toBe(200)
  return cookieHeaders(response)
}

async function countRows(auth: AuthInstance, model: 'user' | 'session', userId?: string): Promise<number> {
  const ctx = await auth.$context
  return ctx.adapter.count({
    model,
    where: userId ? [{ field: 'userId', value: userId }] : undefined,
  })
}

async function findPasswordHash(auth: AuthInstance, userId: string): Promise<string> {
  const ctx = await auth.$context
  const account = await ctx.adapter.findOne<{ password: string }>({
    model: 'account',
    where: [{ field: 'userId', value: userId }],
  })
  expect(account?.password).toBeTypeOf('string')
  return account!.password
}

function createSession(): Session {
  return {
    session: {
      id: 'session-1',
      userId: 'user-1',
      token: 'token-1',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      createdAt: new Date('2029-01-01T00:00:00.000Z'),
      updatedAt: new Date('2029-01-01T00:00:00.000Z'),
    },
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'user@example.com',
      emailVerified: true,
      createdAt: new Date('2029-01-01T00:00:00.000Z'),
      updatedAt: new Date('2029-01-01T00:00:00.000Z'),
      role: 'user',
    },
  }
}

describe('createAuthRoutes', () => {
  beforeEach(() => {
    resetEnv()
    vi.clearAllMocks()
  })

  it('proxies GET requests and preserves the status, body and headers', async () => {
    const handler = vi.fn(async () => new Response('proxied', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=1' },
    }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)
    const request = new Request('http://localhost/api/auth/session')

    const res = await app.fetch(request)

    expect(handler).toHaveBeenCalledWith(request)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('proxied')
    expect(res.headers.get('set-cookie')).toBe('opencode.session=1')
  })

  it('proxies POST requests and preserves the status', async () => {
    const handler = vi.fn(async () => new Response('created', { status: 201 }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)

    const res = await app.fetch(new Request('http://localhost/api/auth/sign-up/email', { method: 'POST', body: '{}' }))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('created')
  })

  it('does not log sign-in response headers', async () => {
    const handler = vi.fn(async () => new Response('ok', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=abc; Path=/; HttpOnly' },
    }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)

    await app.fetch(new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}' }))

    expect(mockLoggerInfo).not.toHaveBeenCalled()
    expect(mockLoggerDebug).not.toHaveBeenCalled()
  })
})

describe('syncAdminFromEnv', () => {
  let db: ReturnType<typeof createAuthDatabase>
  let auth: AuthInstance

  beforeEach(() => {
    resetEnv()
    db = createAuthDatabase()
    auth = createAuth(db)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await (await auth.$context).checkSchema?.()
    db.close()
  })

  it('does nothing when the admin credentials are not configured', async () => {
    await syncAdminFromEnv(auth)

    expect(await countRows(auth, 'user')).toBe(0)
    expect(mockLoggerInfo).not.toHaveBeenCalled()
  })

  it('does nothing when only one admin credential is configured', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'

    await syncAdminFromEnv(auth)

    expect(await countRows(auth, 'user')).toBe(0)
  })

  it('returns without resetting when an existing user has no password reset flag', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'old-password')
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'

    await syncAdminFromEnv(auth)

    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'new-password')).status).toBe(401)
    expect(await auth.api.getSession({ headers: cookies })).not.toBeNull()
  }, 30000)

  it('finds the existing admin user when ADMIN_EMAIL differs only by case', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    ENV.AUTH.ADMIN_EMAIL = 'Admin@Example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth)

    expect(await countRows(auth, 'user')).toBe(1)
    expect((await signInRequest(auth, 'Admin@Example.com', 'new-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(401)
  }, 30000)

  it('resets the credential account password for an existing user', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth)

    expect((await signInRequest(auth, 'admin@example.com', 'new-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(401)
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Admin password reset'))
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('ADMIN_PASSWORD_RESET'))
  }, 30000)

  it('revokes every session of the admin whose password was reset', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    await auth.api.signUpEmail({ body: { email: 'other@example.com', password: 'other-password', name: 'Other' } })
    const firstAdminCookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    await createUserSession(auth, 'admin@example.com', 'admin-password')
    const otherCookies = await createUserSession(auth, 'other@example.com', 'other-password')
    const adminId = (await auth.api.getSession({ headers: firstAdminCookies }))!.user.id
    const otherId = (await auth.api.getSession({ headers: otherCookies }))!.user.id
    const otherSessionsBefore = await countRows(auth, 'session', otherId)
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth)

    expect(await countRows(auth, 'session', adminId)).toBe(0)
    expect(await countRows(auth, 'session', otherId)).toBe(otherSessionsBefore)
  }, 30000)

  it('runs the session delete hook for every revoked admin session', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    const sessionId = (await auth.api.getSession({ headers: cookies }))!.session.id
    const close = vi.fn()
    registerSessionConnection(sessionId, close)
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth)

    expect(close).toHaveBeenCalledTimes(1)
  }, 30000)

  it('warns and still revokes the sessions when the admin has no credential account', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    const adminId = (await auth.api.getSession({ headers: cookies }))!.user.id
    const ctx = await auth.$context
    await ctx.adapter.deleteMany({ model: 'account', where: [{ field: 'userId', value: adminId }] })
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth)

    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('No credential account found'))
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Admin password reset'))
    expect(await countRows(auth, 'session', adminId)).toBe(0)
  }, 30000)

  it('keeps the new password when revoking the sessions fails', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'old-password')
    const adminId = (await auth.api.getSession({ headers: cookies }))!.user.id
    db.exec('DROP TABLE "session"')
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true

    await expect(syncAdminFromEnv(auth)).rejects.toThrow()

    const ctx = await auth.$context
    expect(await ctx.password.verify({
      password: 'new-password',
      hash: await findPasswordHash(auth, adminId),
    })).toBe(true)
  }, 30000)

  it('creates a new admin user when none exists', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'

    await syncAdminFromEnv(auth)

    expect(await countRows(auth, 'user')).toBe(1)
    expect((await signInRequest(auth, 'admin@example.com', 'admin-password')).status).toBe(200)
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Admin user created'))
  }, 30000)

  it('logs and swallows sign-up failures', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'short'

    await expect(syncAdminFromEnv(auth)).resolves.toBeUndefined()

    expect(await countRows(auth, 'user')).toBe(0)
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create admin user from environment:', expect.anything())
  }, 30000)
})

describe('createAuthInfoRoutes /config', () => {
  let db: ReturnType<typeof createAuthDatabase>
  let auth: AuthInstance
  let app: ReturnType<typeof createAuthInfoRoutes>

  beforeEach(() => {
    resetEnv()
    db = createAuthDatabase()
    auth = createAuth(db)
    app = createAuthInfoRoutes(auth)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await (await auth.$context).checkSchema?.()
    db.close()
  })

  it('returns the default config for an empty database with no providers', async () => {
    const res = await app.fetch(new Request('http://localhost/config'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabledProviders: ['credentials', 'passkey'],
      registrationEnabled: true,
      isFirstUser: true,
      adminConfigured: false,
    })
  })

  it('lists every configured social provider', async () => {
    ENV.AUTH.GITHUB_CLIENT_ID = 'github-id'
    ENV.AUTH.GITHUB_CLIENT_SECRET = 'github-secret'
    ENV.AUTH.GOOGLE_CLIENT_ID = 'google-id'
    ENV.AUTH.GOOGLE_CLIENT_SECRET = 'google-secret'
    ENV.AUTH.DISCORD_CLIENT_ID = 'discord-id'
    ENV.AUTH.DISCORD_CLIENT_SECRET = 'discord-secret'

    const res = await app.fetch(new Request('http://localhost/config'))
    const json = await res.json() as { enabledProviders: string[] }

    expect(json.enabledProviders).toEqual(['credentials', 'github', 'google', 'discord', 'passkey'])
  })

  it('omits social providers with only one credential half configured', async () => {
    ENV.AUTH.GITHUB_CLIENT_ID = 'github-id'
    ENV.AUTH.GOOGLE_CLIENT_SECRET = 'google-secret'
    ENV.AUTH.DISCORD_CLIENT_ID = 'discord-id'

    const res = await app.fetch(new Request('http://localhost/config'))
    const json = await res.json() as { enabledProviders: string[] }

    expect(json.enabledProviders).toEqual(['credentials', 'passkey'])
  })

  it('disables registration when admin credentials are configured', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'

    const res = await app.fetch(new Request('http://localhost/config'))
    const json = await res.json() as { registrationEnabled: boolean; adminConfigured: boolean }

    expect(json.registrationEnabled).toBe(false)
    expect(json.adminConfigured).toBe(true)
  })

  it('reports that it is not the first user once a user exists', async () => {
    await auth.api.signUpEmail({ body: { email: 'user@example.com', password: 'user-password', name: 'User' } })

    const res = await app.fetch(new Request('http://localhost/config'))
    const json = await res.json() as { isFirstUser: boolean }

    expect(json.isFirstUser).toBe(false)
  }, 30000)
})

describe('createAuthInfoRoutes /me', () => {
  beforeEach(() => {
    resetEnv()
    vi.clearAllMocks()
  })

  it('returns the session and user from GET /me', async () => {
    const session = createSession()
    const getSession = vi.fn(async () => session)
    const app = createAuthInfoRoutes({ api: { getSession } } as unknown as AuthInstance)

    const res = await app.fetch(new Request('http://localhost/me'))
    const json = await res.json() as { user: unknown; session: { id: string; expiresAt: string } }

    expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) })
    expect(json.user).toEqual({
      ...session.user,
      createdAt: session.user.createdAt.toISOString(),
      updatedAt: session.user.updatedAt.toISOString(),
    })
    expect(json.session).toEqual({
      id: 'session-1',
      expiresAt: session.session.expiresAt.toISOString(),
    })
  })

  it('returns nulls from GET /me when no session is found', async () => {
    const getSession = vi.fn(async () => null)
    const app = createAuthInfoRoutes({ api: { getSession } } as unknown as AuthInstance)

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })

  it('returns nulls from GET /me when the session lookup throws', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const app = createAuthInfoRoutes({ api: { getSession } } as unknown as AuthInstance)

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })
})
