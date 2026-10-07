import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from '../../src/auth/middleware'
import type { AuthInstance, Session } from '../../src/auth'

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({ logger: loggerMock }))

const TRUSTED_ORIGIN = 'http://trusted.test'
const UNTRUSTED_ORIGIN = 'http://untrusted.test'

function createSession(): Session {
  return {
    session: {
      id: 'session-1',
      userId: 'user-1',
      token: 'token-1',
      expiresAt: new Date(Date.now() + 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'user',
    },
  }
}

function createApp(
  getSession: (input: { headers: Headers }) => Promise<Session | null>,
  trustedOrigins: string[] = [TRUSTED_ORIGIN],
) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()
  app.use('/*', createAuthMiddleware({ api: { getSession } } as unknown as AuthInstance, () => trustedOrigins))
  app.get('/', (c) => c.json({ userId: c.get('user').id }))
  app.post('/', (c) => c.json({ ok: true }))
  app.put('/', (c) => c.json({ ok: true }))
  app.patch('/', (c) => c.json({ ok: true }))
  app.delete('/', (c) => c.json({ ok: true }))
  return app
}

describe('createAuthMiddleware same-site guard', () => {
  let getSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    getSession = vi.fn()
    getSession.mockResolvedValue(createSession())
  })

  it('rejects an unsafe same-site request with an untrusted origin without looking up the session', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site', origin: UNTRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cross-site request rejected' })
    expect(getSession).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('/'))
  })

  it('allows an unsafe same-site request from a trusted origin', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site', origin: TRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('allows a same-origin request', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', origin: UNTRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('allows an unsafe request without a Sec-Fetch-Site header', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'POST',
      headers: { origin: UNTRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('allows a cross-site GET so WebSocket upgrades are unaffected', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'GET',
      headers: { 'sec-fetch-site': 'cross-site', origin: UNTRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('rejects a cross-site unsafe request with no origin', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'DELETE',
      headers: { 'sec-fetch-site': 'cross-site', cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cross-site request rejected' })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('rejects a cross-site PUT with an untrusted origin', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'sec-fetch-site': 'cross-site', origin: UNTRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(403)
    expect(getSession).not.toHaveBeenCalled()
  })
})

describe('getTrustedOrigins', () => {
  const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS

  afterEach(() => {
    if (originalTrustedOrigins === undefined) {
      delete process.env.AUTH_TRUSTED_ORIGINS
    } else {
      process.env.AUTH_TRUSTED_ORIGINS = originalTrustedOrigins
    }
    vi.resetModules()
  })

  async function loadTrustedOrigins(value?: string): Promise<string[]> {
    if (value === undefined) {
      delete process.env.AUTH_TRUSTED_ORIGINS
    } else {
      process.env.AUTH_TRUSTED_ORIGINS = value
    }
    vi.resetModules()
    const { getTrustedOrigins } = await import('@opencode-manager/shared/config/env')
    return getTrustedOrigins()
  }

  it('splits, trims, and drops empty entries', async () => {
    await expect(loadTrustedOrigins(' http://a.test ,, http://b.test ')).resolves.toEqual(['http://a.test', 'http://b.test'])
  })

  it('returns an empty list when configured empty', async () => {
    await expect(loadTrustedOrigins('')).resolves.toEqual([])
  })

  it('falls back to the local development origins', async () => {
    await expect(loadTrustedOrigins(undefined)).resolves.toEqual([
      'http://localhost:5173',
      'http://localhost:5003',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5003',
    ])
  })
})
