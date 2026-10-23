import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { DatabaseSync } from 'node:sqlite'
import type { Database } from 'bun:sqlite'
import { createAuth } from '../../src/auth'
import { AUTH_SOCKET_IP_HEADER } from '../../src/auth/client-ip'
import { applyClientIpHeaders, getClientIpHeaders, getTrustedProxyHeaders } from '../../src/auth/client-ip'
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
      TRUSTED_PROXY_HEADERS: '',
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

describe('auth client ip headers', () => {
  beforeEach(() => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = ''
  })

  it('trusts no proxy headers by default and resolves the socket address', () => {
    expect(getTrustedProxyHeaders()).toEqual([])
    expect(getClientIpHeaders()).toEqual([AUTH_SOCKET_IP_HEADER])
  })

  it('reads configured proxy headers in order before the socket address', () => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = ' CF-Connecting-IP , X-Forwarded-For '

    expect(getTrustedProxyHeaders()).toEqual(['cf-connecting-ip', 'x-forwarded-for'])
    expect(getClientIpHeaders()).toEqual(['cf-connecting-ip', 'x-forwarded-for', AUTH_SOCKET_IP_HEADER])
  })

  it('ignores empty, malformed and duplicate header names', () => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = 'x-real-ip,,X-Real-IP,not a header'

    expect(getTrustedProxyHeaders()).toEqual(['x-real-ip', 'x-real-ip'])
  })

  it('drops a client-supplied forwarded header and uses the socket address by default', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.9', [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, '203.0.113.7')

    expect(result.get('x-forwarded-for')).toBeNull()
    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('keeps the configured proxy header and still forwards the socket address', () => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = 'x-forwarded-for'
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.9' })

    const result = applyClientIpHeaders(headers, '203.0.113.7')

    expect(result.get('x-forwarded-for')).toBe('198.51.100.9')
    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('clears the socket header when the address cannot be resolved', () => {
    const headers = new Headers({ [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' })

    const result = applyClientIpHeaders(headers, undefined)

    expect(result.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuthRoutes client ip forwarding', () => {
  beforeEach(() => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = ''
  })

  it('passes the socket address to the auth handler and strips a spoofed forwarded header', async () => {
    const received: Request[] = []
    const handler = vi.fn(async (request: Request) => {
      received.push(request)
      return new Response('ok')
    })
    const app: Hono = createAuthRoutes({ handler } as unknown as ReturnType<typeof createAuth>)

    await app.fetch(
      new Request('http://localhost:5003/api/auth/get-session', {
        headers: { 'x-forwarded-for': '198.51.100.9' },
      }),
      socketEnv('203.0.113.7')
    )

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
    expect(received[0]?.headers.get('x-forwarded-for')).toBeNull()
  })

  it('forwards the configured proxy header when trusted', async () => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = 'x-forwarded-for'
    const received: Request[] = []
    const handler = vi.fn(async (request: Request) => {
      received.push(request)
      return new Response('ok')
    })
    const app: Hono = createAuthRoutes({ handler } as unknown as ReturnType<typeof createAuth>)

    await app.fetch(
      new Request('http://localhost:5003/api/auth/get-session', {
        headers: { 'x-forwarded-for': '198.51.100.9' },
      }),
      socketEnv('203.0.113.7')
    )

    expect(received[0]?.headers.get('x-forwarded-for')).toBe('198.51.100.9')
    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBe('203.0.113.7')
  })

  it('omits the socket header when the connection info is unavailable', async () => {
    const received: Request[] = []
    const handler = vi.fn(async (request: Request) => {
      received.push(request)
      return new Response('ok')
    })
    const app: Hono = createAuthRoutes({ handler } as unknown as ReturnType<typeof createAuth>)

    await app.fetch(new Request('http://localhost:5003/api/auth/get-session', {
      headers: { [AUTH_SOCKET_IP_HEADER]: '6.6.6.6' },
    }))

    expect(received[0]?.headers.get(AUTH_SOCKET_IP_HEADER)).toBeNull()
  })
})

describe('createAuth client ip resolution', () => {
  beforeEach(() => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = ''
  })

  it('records the socket address on a new session and ignores a spoofed forwarded header', async () => {
    const db = createAuthDatabase()
    const app: Hono = createAuthRoutes(createAuth(db))

    try {
      const response = await app.fetch(
        signUpRequest({ 'x-forwarded-for': '198.51.100.9' }),
        socketEnv('203.0.113.7')
      )

      expect(response.status).toBe(200)
      expect(readSessionIpAddress(db)).toBe('203.0.113.7')
    } finally {
      db.close()
    }
  }, 30000)

  it('records the trusted forwarded address when proxy headers are configured', async () => {
    ENV.AUTH.TRUSTED_PROXY_HEADERS = 'x-forwarded-for'
    const db = createAuthDatabase()
    const app: Hono = createAuthRoutes(createAuth(db))

    try {
      const response = await app.fetch(
        signUpRequest({ 'x-forwarded-for': '198.51.100.9' }),
        socketEnv('203.0.113.7')
      )

      expect(response.status).toBe(200)
      expect(readSessionIpAddress(db)).toBe('198.51.100.9')
    } finally {
      db.close()
    }
  }, 30000)
})
