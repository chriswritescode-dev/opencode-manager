import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb } from '../helpers/assistant-workspace'
import { createAuth } from '../../src/auth'

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

function resetEnv(): void {
  ENV.SERVER.PORT = 5003
  ENV.AUTH.TRUSTED_ORIGINS = 'http://localhost:5173,http://localhost:5003'
  ENV.AUTH.SECURE_COOKIES = false
  ENV.AUTH.GITHUB_CLIENT_ID = undefined
  ENV.AUTH.GITHUB_CLIENT_SECRET = undefined
  ENV.AUTH.GOOGLE_CLIENT_ID = undefined
  ENV.AUTH.GOOGLE_CLIENT_SECRET = undefined
  ENV.AUTH.DISCORD_CLIENT_ID = undefined
  ENV.AUTH.DISCORD_CLIENT_SECRET = undefined
}

describe('createAuth', () => {
  beforeEach(() => {
    resetEnv()
  })

  it('creates an auth instance without social providers and responds to requests', async () => {
    const db = createTestDb()
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

    const db = createTestDb()
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

    const db = createTestDb()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('falls back to the localhost port when trusted origins are empty', async () => {
    ENV.AUTH.TRUSTED_ORIGINS = ''
    ENV.SERVER.PORT = 4321
    ENV.AUTH.SECURE_COOKIES = true

    const db = createTestDb()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://localhost/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })

  it('uses the first trusted origin as the base URL', async () => {
    ENV.AUTH.TRUSTED_ORIGINS = ' http://example.test ,http://localhost:5003'

    const db = createTestDb()
    const auth = createAuth(db)

    const res = await auth.handler(new Request('http://example.test/api/auth/ok'))
    expect(res).toBeInstanceOf(Response)

    db.close()
  })
})
