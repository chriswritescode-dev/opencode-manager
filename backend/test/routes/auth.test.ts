import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ENV } from '@opencode-manager/shared/config/env'
import { createAuthInfoRoutes, createAuthRoutes, syncAdminFromEnv } from '../../src/routes/auth'
import type { AuthInfoProvider, AuthRouteHandler } from '../../src/routes/auth'
import { createAuth } from '../../src/auth'
import type { AuthEnv, AuthInstance, Session } from '../../src/auth'
import { registerSessionConnection } from '../../src/services/session-connections'
import { selectRows } from '../../src/db/rows'
import { createTestDatabase } from '../helpers/test-database'
import { expectLoggedMessage, testLogEntries } from '../helpers/log-assertions'
import { readJson } from '../helpers/read-json'

const ORIGIN = 'http://localhost:5173'
const SIGN_IN_URL = `${ORIGIN}/api/auth/sign-in/email`

const AuthConfigSchema = z.object({
  enabledProviders: z.array(z.string()),
  registrationEnabled: z.boolean(),
  isFirstUser: z.boolean(),
  adminConfigured: z.boolean(),
})

const CurrentUserSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    role: z.string().nullable().optional(),
  }).nullable(),
  session: z.object({
    id: z.string(),
    expiresAt: z.string(),
  }).nullable(),
})

const EndpointRowSchema = z.object({ endpoint: z.string() })

function createAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    ...ENV.AUTH,
    ADMIN_EMAIL: undefined,
    ADMIN_PASSWORD: undefined,
    ADMIN_PASSWORD_RESET: false,
    GITHUB_CLIENT_ID: undefined,
    GITHUB_CLIENT_SECRET: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    DISCORD_CLIENT_ID: undefined,
    DISCORD_CLIENT_SECRET: undefined,
    ...overrides,
  }
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

async function findSignedInSession(
  auth: AuthInstance,
  headers: Headers,
): Promise<{ userId: string; sessionId: string }> {
  const session = await auth.api.getSession({ headers })
  if (!session) throw new Error('expected a signed-in session')
  return { userId: session.user.id, sessionId: session.session.id }
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
  return account?.password ?? ''
}

function insertPushSubscription(db: ReturnType<typeof createTestDatabase>, endpoint: string, sessionId: string | null): void {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('default', endpoint, 'p256dh-key', 'auth-key', sessionId, Date.now())
}

function adminLogMessages(): string[] {
  return testLogEntries()
    .map((entry) => entry.message)
    .filter((message) => message.toLowerCase().includes('admin'))
}

function pushSubscriptionEndpoints(db: ReturnType<typeof createTestDatabase>): string[] {
  return selectRows(db, EndpointRowSchema, 'SELECT endpoint FROM push_subscriptions ORDER BY endpoint')
    .map((row) => row.endpoint)
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
  it('proxies GET requests and preserves the status, body and headers', async () => {
    const request = new Request('http://localhost/api/auth/session')
    const handler = vi.fn<AuthRouteHandler['handler']>(async () => new Response('proxied', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=1' },
    }))
    const app = createAuthRoutes({ handler })

    const res = await app.fetch(request)

    expect(handler).toHaveBeenCalledWith(request)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('proxied')
    expect(res.headers.get('set-cookie')).toBe('opencode.session=1')
  })

  it('proxies POST requests and preserves the status', async () => {
    const handler = vi.fn<AuthRouteHandler['handler']>(async () => new Response('created', { status: 201 }))
    const app = createAuthRoutes({ handler })

    const res = await app.fetch(new Request('http://localhost/api/auth/sign-up/email', { method: 'POST', body: '{}' }))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('created')
  })

  it('does not log sign-in response headers', async () => {
    const handler = vi.fn<AuthRouteHandler['handler']>(async () => new Response('ok', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=abc; Path=/; HttpOnly' },
    }))
    const app = createAuthRoutes({ handler })

    await app.fetch(new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}' }))

    expect(testLogEntries()).toHaveLength(0)
  })
})

describe('syncAdminFromEnv', () => {
  let db: ReturnType<typeof createTestDatabase>
  let auth: AuthInstance
  let env: AuthEnv

  beforeEach(() => {
    db = createTestDatabase()
    env = createAuthEnv()
    auth = createAuth(db, env)
  })

  afterEach(async () => {
    await (await auth.$context).checkSchema?.()
    db.close()
  })

  it.each([
    { label: 'no admin credentials', email: undefined, password: undefined },
    { label: 'only the admin email', email: 'admin@example.com', password: undefined },
    { label: 'only the admin password', email: undefined, password: 'admin-password' },
  ])('does nothing when $label are configured', async ({ email, password }) => {
    env.ADMIN_EMAIL = email
    env.ADMIN_PASSWORD = password

    await syncAdminFromEnv(auth, db, env)

    expect(await countRows(auth, 'user')).toBe(0)
    expect(adminLogMessages()).toHaveLength(0)
  })

  it('returns without resetting when an existing user has no password reset flag', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'old-password')
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'

    await syncAdminFromEnv(auth, db, env)

    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'new-password')).status).toBe(401)
    expect(await auth.api.getSession({ headers: cookies })).not.toBeNull()
  }, 30000)

  it('finds the existing admin user when ADMIN_EMAIL differs only by case', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    env.ADMIN_EMAIL = 'Admin@Example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expect(await countRows(auth, 'user')).toBe(1)
    expect((await signInRequest(auth, 'Admin@Example.com', 'new-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(401)
  }, 30000)

  it('finds the existing admin user when the stored email differs only by case', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'old-password')
    const { userId } = await findSignedInSession(auth, cookies)
    db.prepare('UPDATE "user" SET email = ? WHERE id = ?').run('Admin@Example.com', userId)
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    const ctx = await auth.$context
    expect(await countRows(auth, 'user')).toBe(1)
    expect(await ctx.password.verify({
      password: 'new-password',
      hash: await findPasswordHash(auth, userId),
    })).toBe(true)
  }, 30000)

  it('resets the credential account password for an existing user', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expect((await signInRequest(auth, 'admin@example.com', 'new-password')).status).toBe(200)
    expect((await signInRequest(auth, 'admin@example.com', 'old-password')).status).toBe(401)
    expectLoggedMessage('Admin password reset')
    expectLoggedMessage('ADMIN_PASSWORD_RESET', 'warn')
  }, 30000)

  it('revokes every session of the admin whose password was reset', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    await auth.api.signUpEmail({ body: { email: 'other@example.com', password: 'other-password', name: 'Other' } })
    const firstAdminCookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    await createUserSession(auth, 'admin@example.com', 'admin-password')
    const otherCookies = await createUserSession(auth, 'other@example.com', 'other-password')
    const admin = await findSignedInSession(auth, firstAdminCookies)
    const other = await findSignedInSession(auth, otherCookies)
    const otherSessionsBefore = await countRows(auth, 'session', other.userId)
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expect(await countRows(auth, 'session', admin.userId)).toBe(0)
    expect(await countRows(auth, 'session', other.userId)).toBe(otherSessionsBefore)
  }, 30000)

  it('deletes the push subscriptions of the revoked admin sessions and keeps the others', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    await auth.api.signUpEmail({ body: { email: 'other@example.com', password: 'other-password', name: 'Other' } })
    const adminCookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    const otherCookies = await createUserSession(auth, 'other@example.com', 'other-password')
    const admin = await findSignedInSession(auth, adminCookies)
    const other = await findSignedInSession(auth, otherCookies)
    insertPushSubscription(db, 'https://push.example.com/phone', admin.sessionId)
    insertPushSubscription(db, 'https://push.example.com/tablet', other.sessionId)
    insertPushSubscription(db, 'https://push.example.com/legacy', null)
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expect(pushSubscriptionEndpoints(db)).toEqual([
      'https://push.example.com/legacy',
      'https://push.example.com/tablet',
    ])
  }, 30000)

  it('runs the session delete hook for every revoked admin session', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    const { sessionId } = await findSignedInSession(auth, cookies)
    const close = vi.fn()
    registerSessionConnection(sessionId, close)
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expect(close).toHaveBeenCalledTimes(1)
  }, 30000)

  it('warns and still revokes the sessions when the admin has no credential account', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'admin-password')
    const { userId } = await findSignedInSession(auth, cookies)
    const ctx = await auth.$context
    await ctx.adapter.deleteMany({ model: 'account', where: [{ field: 'userId', value: userId }] })
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await syncAdminFromEnv(auth, db, env)

    expectLoggedMessage('No credential account found', 'warn')
    expectLoggedMessage('Admin password reset')
    expect(await countRows(auth, 'session', userId)).toBe(0)
  }, 30000)

  it('keeps the new password when revoking the sessions fails', async () => {
    await auth.api.signUpEmail({ body: { email: 'admin@example.com', password: 'old-password', name: 'Admin' } })
    const cookies = await createUserSession(auth, 'admin@example.com', 'old-password')
    const { userId } = await findSignedInSession(auth, cookies)
    db.exec('DROP TABLE "session"')
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'new-password'
    env.ADMIN_PASSWORD_RESET = true

    await expect(syncAdminFromEnv(auth, db, env)).rejects.toThrow()

    const ctx = await auth.$context
    expect(await ctx.password.verify({
      password: 'new-password',
      hash: await findPasswordHash(auth, userId),
    })).toBe(true)
  }, 30000)

  it('creates a new admin user when none exists', async () => {
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'admin-password'

    await syncAdminFromEnv(auth, db, env)

    expect(await countRows(auth, 'user')).toBe(1)
    expect((await signInRequest(auth, 'admin@example.com', 'admin-password')).status).toBe(200)
    expectLoggedMessage('Admin user created')
  }, 30000)

  it('logs and swallows sign-up failures', async () => {
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'short'

    await expect(syncAdminFromEnv(auth, db, env)).resolves.toBeUndefined()

    expect(await countRows(auth, 'user')).toBe(0)
    expectLoggedMessage('Failed to create admin user from environment', 'error')
  }, 30000)
})

describe('createAuthInfoRoutes /config', () => {
  let db: ReturnType<typeof createTestDatabase>
  let auth: AuthInstance
  let env: AuthEnv
  let app: ReturnType<typeof createAuthInfoRoutes>

  beforeEach(() => {
    db = createTestDatabase()
    env = createAuthEnv()
    auth = createAuth(db, env)
    app = createAuthInfoRoutes(auth, env)
  })

  afterEach(async () => {
    await (await auth.$context).checkSchema?.()
    db.close()
  })

  it('returns the default config for an empty database with no providers', async () => {
    const res = await app.fetch(new Request('http://localhost/config'))
    const body = await readJson(res, AuthConfigSchema)

    expect(res.status).toBe(200)
    expect(body).toEqual({
      enabledProviders: ['credentials', 'passkey'],
      registrationEnabled: true,
      isFirstUser: true,
      adminConfigured: false,
    })
  })

  it('lists every configured social provider', async () => {
    env.GITHUB_CLIENT_ID = 'github-id'
    env.GITHUB_CLIENT_SECRET = 'github-secret'
    env.GOOGLE_CLIENT_ID = 'google-id'
    env.GOOGLE_CLIENT_SECRET = 'google-secret'
    env.DISCORD_CLIENT_ID = 'discord-id'
    env.DISCORD_CLIENT_SECRET = 'discord-secret'

    const res = await app.fetch(new Request('http://localhost/config'))
    const body = await readJson(res, AuthConfigSchema)

    expect(body.enabledProviders).toEqual(['credentials', 'github', 'google', 'discord', 'passkey'])
  })

  it('omits social providers with only one credential half configured', async () => {
    env.GITHUB_CLIENT_ID = 'github-id'
    env.GOOGLE_CLIENT_SECRET = 'google-secret'
    env.DISCORD_CLIENT_ID = 'discord-id'

    const res = await app.fetch(new Request('http://localhost/config'))
    const body = await readJson(res, AuthConfigSchema)

    expect(body.enabledProviders).toEqual(['credentials', 'passkey'])
  })

  it('disables registration when admin credentials are configured', async () => {
    env.ADMIN_EMAIL = 'admin@example.com'
    env.ADMIN_PASSWORD = 'admin-password'

    const res = await app.fetch(new Request('http://localhost/config'))
    const body = await readJson(res, AuthConfigSchema)

    expect(body.registrationEnabled).toBe(false)
    expect(body.adminConfigured).toBe(true)
  })

  it('reports that it is not the first user once a user exists', async () => {
    await auth.api.signUpEmail({ body: { email: 'user@example.com', password: 'user-password', name: 'User' } })

    const res = await app.fetch(new Request('http://localhost/config'))
    const body = await readJson(res, AuthConfigSchema)

    expect(body.isFirstUser).toBe(false)
  }, 30000)
})

describe('createAuthInfoRoutes /me', () => {
  let db: ReturnType<typeof createTestDatabase>
  let auth: AuthInstance

  beforeEach(() => {
    db = createTestDatabase()
    auth = createAuth(db, createAuthEnv())
  })

  afterEach(async () => {
    await (await auth.$context).checkSchema?.()
    db.close()
  })

  it('returns the session and user from GET /me', async () => {
    const session = createSession()
    const getSession = vi.fn<AuthInfoProvider['api']['getSession']>(async () => session)
    const app = createAuthInfoRoutes({ api: { getSession }, $context: auth.$context })

    const res = await app.fetch(new Request('http://localhost/me'))
    const body = await readJson(res, CurrentUserSchema)

    expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) })
    expect(body.user).toEqual({
      ...session.user,
      createdAt: session.user.createdAt.toISOString(),
      updatedAt: session.user.updatedAt.toISOString(),
    })
    expect(body.session).toEqual({
      id: 'session-1',
      expiresAt: session.session.expiresAt.toISOString(),
    })
  })

  it('returns nulls from GET /me when no session is found', async () => {
    const getSession = vi.fn<AuthInfoProvider['api']['getSession']>(async () => null)
    const app = createAuthInfoRoutes({ api: { getSession }, $context: auth.$context })

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })

  it('returns nulls from GET /me when the session lookup throws', async () => {
    const getSession = vi.fn<AuthInfoProvider['api']['getSession']>(async () => {
      throw new Error('database unavailable')
    })
    const app = createAuthInfoRoutes({ api: { getSession }, $context: auth.$context })

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })
})
