import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../helpers/assistant-workspace'
import { createAuthRoutes, createAuthInfoRoutes, syncAdminFromEnv } from '../../src/routes/auth'
import type { AuthInstance, Session } from '../../src/auth'

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

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { hashPasswordMock } = vi.hoisted(() => ({
  hashPasswordMock: vi.fn(),
}))

vi.mock('better-auth/crypto', () => ({ hashPassword: hashPasswordMock }))

import { logger } from '../../src/utils/logger'

const mockLoggerInfo = vi.mocked(logger.info)
const mockLoggerWarn = vi.mocked(logger.warn)
const mockLoggerError = vi.mocked(logger.error)
const mockLoggerDebug = vi.mocked(logger.debug)

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

function insertUser(db: ReturnType<typeof createTestDb>, id: string, email: string): void {
  db.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'Test User', email, 0, Date.now(), Date.now(), 'user')
}

function insertCredentialAccount(db: ReturnType<typeof createTestDb>, id: string, userId: string, password: string): void {
  db.prepare(
    'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, 'credential', userId, password, Date.now(), Date.now())
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

  it('logs sign-in responses when a set-cookie header is present', async () => {
    const handler = vi.fn(async () => new Response('ok', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=abc; Path=/; HttpOnly' },
    }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)

    await app.fetch(new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}' }))

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Sign-in response'))
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('present'))
    expect(mockLoggerDebug).toHaveBeenCalledWith(expect.stringContaining('Set-Cookie header'))
  })

  it('logs sign-in responses when no set-cookie header is present', async () => {
    const handler = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)

    await app.fetch(new Request('http://localhost/api/auth/sign-in/email', { method: 'POST', body: '{}' }))

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('missing'))
    expect(mockLoggerDebug).not.toHaveBeenCalled()
  })

  it('does not log for non sign-in paths', async () => {
    const handler = vi.fn(async () => new Response('ok', {
      status: 200,
      headers: { 'set-cookie': 'opencode.session=abc' },
    }))
    const app = createAuthRoutes({ handler } as unknown as AuthInstance)

    await app.fetch(new Request('http://localhost/api/auth/get-session'))

    expect(mockLoggerInfo).not.toHaveBeenCalled()
    expect(mockLoggerDebug).not.toHaveBeenCalled()
  })
})

describe('syncAdminFromEnv', () => {
  let db: ReturnType<typeof createTestDb>
  let signUpEmail: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetEnv()
    hashPasswordMock.mockImplementation(async (password: string) => `hashed:${password}`)
    db = createTestDb()
    vi.clearAllMocks()
    signUpEmail = vi.fn(async () => ({}))
  })

  afterEach(() => {
    db.close()
  })

  it('does nothing when the admin credentials are not configured', async () => {
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await syncAdminFromEnv(auth, db)

    expect(signUpEmail).not.toHaveBeenCalled()
    expect(mockLoggerInfo).not.toHaveBeenCalled()
  })

  it('does nothing when only one admin credential is configured', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await syncAdminFromEnv(auth, db)

    expect(signUpEmail).not.toHaveBeenCalled()
  })

  it('returns without resetting when an existing user has no password reset flag', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'
    insertUser(db, 'user-1', 'admin@example.com')
    insertCredentialAccount(db, 'account-1', 'user-1', 'old-hash')
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await syncAdminFromEnv(auth, db)

    expect(signUpEmail).not.toHaveBeenCalled()
    expect(hashPasswordMock).not.toHaveBeenCalled()
    const account = db.prepare('SELECT password FROM "account" WHERE "userId" = ?').get('user-1') as { password: string }
    expect(account.password).toBe('old-hash')
  })

  it('resets the credential account password for an existing user', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'new-password'
    ENV.AUTH.ADMIN_PASSWORD_RESET = true
    insertUser(db, 'user-1', 'admin@example.com')
    insertCredentialAccount(db, 'account-1', 'user-1', 'old-hash')
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await syncAdminFromEnv(auth, db)

    expect(hashPasswordMock).toHaveBeenCalledWith('new-password')
    expect(signUpEmail).not.toHaveBeenCalled()
    const account = db.prepare('SELECT password FROM "account" WHERE "userId" = ?').get('user-1') as { password: string }
    expect(account.password).toBe('hashed:new-password')
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Admin password reset'))
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('ADMIN_PASSWORD_RESET'))
  })

  it('creates a new admin user when none exists', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await syncAdminFromEnv(auth, db)

    expect(signUpEmail).toHaveBeenCalledWith({
      body: { email: 'admin@example.com', password: 'admin-password', name: 'Admin' },
    })
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Admin user created'))
  })

  it('logs and swallows sign-up failures', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'
    const failure = new Error('sign up failed')
    signUpEmail.mockRejectedValueOnce(failure)
    const auth = { api: { signUpEmail } } as unknown as AuthInstance

    await expect(syncAdminFromEnv(auth, db)).resolves.toBeUndefined()

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to create admin user from environment:', failure)
  })
})

describe('createAuthInfoRoutes', () => {
  let db: ReturnType<typeof createTestDb>
  let getSession: ReturnType<typeof vi.fn>
  let app: ReturnType<typeof createAuthInfoRoutes>

  beforeEach(() => {
    resetEnv()
    vi.clearAllMocks()
    db = createTestDb()
    getSession = vi.fn()
    app = createAuthInfoRoutes({ api: { getSession } } as unknown as AuthInstance, db)
  })

  afterEach(() => {
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
    insertUser(db, 'user-1', 'user@example.com')

    const res = await app.fetch(new Request('http://localhost/config'))
    const json = await res.json() as { isFirstUser: boolean }

    expect(json.isFirstUser).toBe(false)
  })

  it('returns the session and user from GET /me', async () => {
    const session = createSession()
    getSession.mockResolvedValueOnce(session)

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
    getSession.mockResolvedValueOnce(null)

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })

  it('returns nulls from GET /me when the session lookup throws', async () => {
    getSession.mockRejectedValueOnce(new Error('database unavailable'))

    const res = await app.fetch(new Request('http://localhost/me'))

    expect(await res.json()).toEqual({ user: null, session: null })
  })
})
