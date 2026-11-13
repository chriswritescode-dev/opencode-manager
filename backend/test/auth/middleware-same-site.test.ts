import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { getTrustedOrigins, parseTrustedOrigins } from '@opencode-manager/shared/config/env'
import { createAuthMiddleware } from '../../src/auth/middleware'
import type { AuthSessionReader } from '../../src/routes/auth'
import type { Session } from '../../src/auth'
import { expectLoggedMessage, expectNoSecretsLogged, testLogEntries } from '../helpers/log-assertions'

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
  getSession: AuthSessionReader['getSession'],
  trustedOrigins: string[] = [TRUSTED_ORIGIN],
) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()
  app.use('/*', createAuthMiddleware({ api: { getSession } }, () => trustedOrigins))
  app.get('/', (c) => c.json({ userId: c.get('user').id }))
  app.post('/', (c) => c.json({ ok: true }))
  app.put('/', (c) => c.json({ ok: true }))
  app.patch('/', (c) => c.json({ ok: true }))
  app.delete('/', (c) => c.json({ ok: true }))
  return app
}

describe('createAuthMiddleware same-site guard', () => {
  let getSession: ReturnType<typeof vi.fn<AuthSessionReader['getSession']>>

  beforeEach(() => {
    getSession = vi.fn<AuthSessionReader['getSession']>(async () => createSession())
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
    expect(testLogEntries('warn')).toHaveLength(1)
    expectLoggedMessage('Rejected cross-site request')
  })

  it('allows an unsafe same-site request from a trusted origin', async () => {
    const app = createApp(getSession)

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site', origin: TRUSTED_ORIGIN, cookie: 'opencode.session=valid' },
    })

    expect(res.status).toBe(200)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(testLogEntries('warn')).toHaveLength(0)
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

  it('does not log cookie names or values during the auth check', async () => {
    const originalDebug = process.env.DEBUG
    process.env.DEBUG = 'true'
    try {
      const app = createApp(getSession)

      const res = await app.request('/', { headers: { cookie: 'opencode.session=secret-token' } })

      expect(res.status).toBe(200)
      expectNoSecretsLogged(['opencode.session', 'secret-token'])
    } finally {
      if (originalDebug === undefined) {
        delete process.env.DEBUG
      } else {
        process.env.DEBUG = originalDebug
      }
    }
  })
})

describe('getTrustedOrigins', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseTrustedOrigins(' http://a.test ,, http://b.test ')).toEqual(['http://a.test', 'http://b.test'])
  })

  it('returns an empty list when configured empty', () => {
    expect(parseTrustedOrigins('')).toEqual([])
  })

  it('falls back to the local development origins', () => {
    expect(process.env.AUTH_TRUSTED_ORIGINS).toBeUndefined()
    expect(getTrustedOrigins()).toEqual([
      'http://localhost:5173',
      'http://localhost:5003',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5003',
    ])
  })
})
