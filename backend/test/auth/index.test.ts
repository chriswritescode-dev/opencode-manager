import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import { createAuth } from '../../src/auth'
import type { AuthEnv, AuthInstance } from '../../src/auth'
import { syncAdminFromEnv } from '../../src/routes/auth'
import { createTestDatabase } from '../helpers/test-database'
import { createAuthEnv } from '../helpers/auth-env'

const ORIGIN = 'http://localhost:5173'

function signUpRequest(email: string, password: string): Request {
  return new Request(`${ORIGIN}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password, name: 'Test' }),
  })
}

describe('createAuth', () => {
  let db: Database
  let auth: AuthInstance

  beforeEach(() => {
    db = createTestDatabase()
  })

  afterEach(() => {
    db.close()
  })

  it('rejects HTTP signup in admin mode while allowing internal admin provisioning and sign-in', async () => {
    const env = createAuthEnv({ ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin-password' })
    auth = createAuth(db, env)

    for (const email of ['other@example.com', env.ADMIN_EMAIL ?? '']) {
      const response = await auth.handler(signUpRequest(email, 'test-password'))
      expect(response.status).toBe(403)
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM "user"').get()).toEqual({ count: 0 })
    await expect(auth.api.signUpEmail({
      body: { email: 'other@example.com', password: 'test-password', name: 'Other' },
    })).rejects.toThrow('Registration is disabled')

    await syncAdminFromEnv(auth, db, env)
    const response = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
    }))
    expect(response.status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) AS count FROM "user"').get()).toEqual({ count: 1 })
  }, 30000)

  it('allows signup without a complete preconfigured admin', async () => {
    auth = createAuth(db, createAuthEnv({ ADMIN_EMAIL: 'admin@example.com' }))

    const response = await auth.handler(signUpRequest('other@example.com', 'test-password'))

    expect(response.status).toBe(200)
  })

  it('rejects a session cookie immediately after its session row is deleted', async () => {
    auth = createAuth(db, createAuthEnv())

    const signUpResponse = await auth.handler(signUpRequest('revoked@example.com', 'test-password'))
    expect(signUpResponse.status).toBe(200)

    const setCookies = signUpResponse.headers.getSetCookie()
    expect(setCookies.length).toBeGreaterThan(0)
    const headers = new Headers({ cookie: setCookies.map((cookie) => cookie.split(';')[0]).join('; ') })

    const session = await auth.api.getSession({ headers })
    expect(session?.user.email).toBe('revoked@example.com')

    db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(session?.user.id ?? '')
    expect(db.prepare('SELECT COUNT(*) AS count FROM "session"').get()).toEqual({ count: 0 })

    expect(await auth.api.getSession({ headers })).toBeNull()
  }, 30000)

  const providerCases: Array<{ label: string; overrides: Partial<AuthEnv>; expected: string[] }> = [
    { label: 'no social credentials', overrides: {}, expected: [] },
    {
      label: 'complete credentials for every provider',
      overrides: {
        GITHUB_CLIENT_ID: 'github-id',
        GITHUB_CLIENT_SECRET: 'github-secret',
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        DISCORD_CLIENT_ID: 'discord-id',
        DISCORD_CLIENT_SECRET: 'discord-secret',
      },
      expected: ['discord', 'github', 'google'],
    },
    {
      label: 'only one half of each credential pair',
      overrides: {
        GITHUB_CLIENT_ID: 'github-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        DISCORD_CLIENT_ID: 'discord-id',
      },
      expected: [],
    },
  ]

  it.each(providerCases)('configures social providers with $label', ({ overrides, expected }) => {
    auth = createAuth(db, createAuthEnv(overrides))

    expect(Object.keys(auth.options.socialProviders ?? {}).sort()).toEqual(expected)
  })

  it('uses the first trusted origin as the base URL', () => {
    auth = createAuth(db, createAuthEnv(), {
      trustedOrigins: ['http://example.test', 'http://localhost:5003'],
      port: 5003,
    })

    expect(auth.options.baseURL).toBe('http://example.test')
    expect(auth.options.trustedOrigins).toEqual(['http://example.test', 'http://localhost:5003'])
  })

  it('falls back to the server port when no trusted origin is configured', () => {
    auth = createAuth(db, createAuthEnv(), { trustedOrigins: [], port: 4321 })

    expect(auth.options.baseURL).toBe('http://localhost:4321')
  })

  it('serves auth requests through its handler', async () => {
    auth = createAuth(db, createAuthEnv())

    const res = await auth.handler(new Request(`${ORIGIN}/api/auth/ok`))

    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBeLessThan(500)
  })
})
