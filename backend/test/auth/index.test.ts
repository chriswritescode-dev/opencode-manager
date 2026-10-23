import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuth } from '../../src/auth'
import { DatabaseSync } from 'node:sqlite'
import type { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { syncAdminFromEnv } from '../../src/routes/auth'

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

function resetEnv(): void {
  ENV.SERVER.PORT = 5003
  ENV.AUTH.TRUSTED_ORIGINS = 'http://localhost:5173,http://localhost:5003'
  ENV.AUTH.SECURE_COOKIES = false
  ENV.AUTH.ADMIN_EMAIL = undefined
  ENV.AUTH.ADMIN_PASSWORD = undefined
  ENV.AUTH.GITHUB_CLIENT_ID = undefined
  ENV.AUTH.GITHUB_CLIENT_SECRET = undefined
  ENV.AUTH.GOOGLE_CLIENT_ID = undefined
  ENV.AUTH.GOOGLE_CLIENT_SECRET = undefined
  ENV.AUTH.DISCORD_CLIENT_ID = undefined
  ENV.AUTH.DISCORD_CLIENT_SECRET = undefined
}

function createAuthDatabase(): Database {
  const db = new DatabaseSync(':memory:')
  const compatible = Object.assign(db, {
    run: (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params),
  }) as unknown as Database
  migrate(compatible, allMigrations)
  return compatible
}

describe('createAuth', () => {
  beforeEach(() => {
    resetEnv()
  })

  it('rejects HTTP signup in admin mode while allowing internal admin provisioning and sign-in', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    ENV.AUTH.ADMIN_PASSWORD = 'admin-password'
    const db = createAuthDatabase()
    const auth = createAuth(db)

    try {
      for (const email of ['other@example.com', ENV.AUTH.ADMIN_EMAIL]) {
        const response = await auth.handler(new Request('http://localhost:5173/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
          body: JSON.stringify({ email, password: 'test-password', name: 'Test' }),
        }))
        expect(response.status).toBe(403)
      }
      expect(db.prepare('SELECT COUNT(*) AS count FROM "user"').get()).toEqual({ count: 0 })
      await expect(auth.api.signUpEmail({
        body: { email: 'other@example.com', password: 'test-password', name: 'Other' },
      })).rejects.toThrow('Registration is disabled')

      await syncAdminFromEnv(auth, db)
      const response = await auth.handler(new Request('http://localhost:5173/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: ENV.AUTH.ADMIN_EMAIL, password: ENV.AUTH.ADMIN_PASSWORD }),
      }))
      expect(response.status).toBe(200)
      expect(db.prepare('SELECT COUNT(*) AS count FROM "user"').get()).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  }, 30000)

  it('allows signup without a complete preconfigured admin', async () => {
    ENV.AUTH.ADMIN_EMAIL = 'admin@example.com'
    const db = createAuthDatabase()
    const auth = createAuth(db)
    try {
      const response = await auth.handler(new Request('http://localhost:5173/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: 'other@example.com', password: 'test-password', name: 'Other' }),
      }))
      expect(response.status).toBe(200)
    } finally {
      db.close()
    }
  })

  it('rejects a session cookie immediately after its session row is deleted', async () => {
    const db = createAuthDatabase()
    const auth = createAuth(db)

    try {
      const signUpResponse = await auth.handler(new Request('http://localhost:5173/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({ email: 'revoked@example.com', password: 'test-password', name: 'Revoked' }),
      }))
      expect(signUpResponse.status).toBe(200)

      const setCookies = signUpResponse.headers.getSetCookie()
      expect(setCookies.length).toBeGreaterThan(0)
      const headers = new Headers({ cookie: setCookies.map((cookie) => cookie.split(';')[0]).join('; ') })

      const session = await auth.api.getSession({ headers })
      expect(session?.user.email).toBe('revoked@example.com')

      db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(session!.user.id)
      expect(db.prepare('SELECT COUNT(*) AS count FROM "session"').get()).toEqual({ count: 0 })

      expect(await auth.api.getSession({ headers })).toBeNull()
    } finally {
      db.close()
    }
  }, 30000)

  it('creates an auth instance without social providers and responds to requests', async () => {
    const db = createAuthDatabase()
    const auth = createAuth(db)

    expect(typeof auth.api.getSession).toBe('function')
    expect(auth.handler).toBeTypeOf('function')

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('creates an auth instance when all social providers are configured', async () => {
    ENV.AUTH.GITHUB_CLIENT_ID = 'github-id'
    ENV.AUTH.GITHUB_CLIENT_SECRET = 'github-secret'
    ENV.AUTH.GOOGLE_CLIENT_ID = 'google-id'
    ENV.AUTH.GOOGLE_CLIENT_SECRET = 'google-secret'
    ENV.AUTH.DISCORD_CLIENT_ID = 'discord-id'
    ENV.AUTH.DISCORD_CLIENT_SECRET = 'discord-secret'

    const db = createAuthDatabase()
    const auth = createAuth(db)

    expect(typeof auth.api.getSession).toBe('function')

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('ignores social providers with only one credential half configured', async () => {
    ENV.AUTH.GITHUB_CLIENT_ID = 'github-id'
    ENV.AUTH.GOOGLE_CLIENT_SECRET = 'google-secret'
    ENV.AUTH.DISCORD_CLIENT_ID = 'discord-id'

    const db = createAuthDatabase()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('falls back to the localhost port when trusted origins are empty', async () => {
    ENV.AUTH.TRUSTED_ORIGINS = ''
    ENV.SERVER.PORT = 4321
    ENV.AUTH.SECURE_COOKIES = true

    const db = createAuthDatabase()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('uses the first trusted origin as the base URL', async () => {
    ENV.AUTH.TRUSTED_ORIGINS = ' http://example.test ,http://localhost:5003'

    const db = createAuthDatabase()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://example.test/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })
})
