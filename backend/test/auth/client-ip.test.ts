import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { DatabaseSync } from 'node:sqlite'
import type { Database } from 'bun:sqlite'
import { createAuth } from '../../src/auth'
import { AUTH_SOCKET_IP_HEADER, applyClientIpHeaders } from '../../src/auth/client-ip'
import { createAuthRoutes } from '../../src/routes/auth'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'

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

function socketEnv(address: string | undefined) {
  return {
    incoming: {
      socket: {
        remoteAddress: address,
        remotePort: 54321,
        remoteFamily: address?.includes(':') ? 'IPv6' : 'IPv4',
      },
    },
  }
}

function createAuthDatabase(): Database {
  const db = new DatabaseSync(':memory:')
  const compatible = Object.assign(db, {
    run: (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params),
  }) as unknown as Database
  migrate(compatible, allMigrations)
  return compatible
}

function signUpRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost:5003/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5003', ...headers },
    body: JSON.stringify({ email: 'spoof@example.com', password: 'test-password', name: 'Spoof' }),
  })
}

function readSessionIpAddress(db: Database): string {
  const row = db.prepare('SELECT ipAddress FROM "session" LIMIT 1').get() as { ipAddress: string }
  return row.ipAddress
}

function createCapturingHandler() {
  const received: Request[] = []
  const handler = vi.fn(async (request: Request) => {
    received.push(request)
    return new Response('ok')
  })
  return { received, handler }
}

describe('auth client ip headers', () => {
  it('overrides a client-supplied socket header with the socket address', () => {
    const headers = new Headers({ [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, '203.0.113.7')

    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('clears the socket header when the address cannot be resolved', () => {
    const headers = new Headers({ [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, undefined)

    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuthRoutes client ip forwarding', () => {
  it('sets the socket address on the auth request and ignores a spoofed socket header', async () => {
    const { received, handler } = createCapturingHandler()
    const app: Hono = createAuthRoutes({ handler } as unknown as ReturnType<typeof createAuth>)

    await app.fetch(
      new Request('http://localhost:5003/api/auth/get-session', {
        headers: { [AUTH_SOCKET_IP_HEADER]: '6.6.6.6', 'x-forwarded-for': '198.51.100.9' },
      }),
      socketEnv('203.0.113.7')
    )

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('omits the socket header when the connection info is unavailable', async () => {
    const { received, handler } = createCapturingHandler()
    const app: Hono = createAuthRoutes({ handler } as unknown as ReturnType<typeof createAuth>)

    await app.fetch(new Request('http://localhost:5003/api/auth/get-session', {
      headers: { [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' },
    }))

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuth client ip resolution', () => {
  it('records the socket address on a new session and ignores a spoofed forwarded header', async () => {
    const db = createAuthDatabase()
    const app: Hono = createAuthRoutes(createAuth(db))

    try {
      const response = await app.fetch(
        signUpRequest({ 'x-forwarded-for': '198.51.100.9', [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' }),
        socketEnv('203.0.113.7')
      )

      expect(response.status).toBe(200)
      expect(readSessionIpAddress(db)).toBe('203.0.113.7')
    } finally {
      db.close()
    }
  }, 30000)
})
