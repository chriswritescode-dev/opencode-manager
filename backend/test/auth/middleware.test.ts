import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from '../../src/auth/middleware'
import type { AuthInstance, Session } from '../../src/auth'

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

function createApp(getSession: (input: { headers: Headers }) => Promise<Session | null>) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()
  app.use('/*', createAuthMiddleware({ api: { getSession } } as unknown as AuthInstance))
  app.get('/', (c) => c.json({ userId: c.get('user').id }))
  return app
}

describe('createAuthMiddleware', () => {
  let getSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSession = vi.fn()
  })

  it('returns 401 when no session is found', async () => {
    getSession.mockResolvedValue(null)
    const app = createApp(getSession)

    const res = await app.request('/', { headers: { cookie: 'opencode.session=stale' } })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('attaches the session and user and continues to the route', async () => {
    const session = createSession()
    getSession.mockResolvedValue(session)
    const app = createApp(getSession)

    const res = await app.request('/', { headers: { cookie: 'opencode.session=valid' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1' })
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when the session lookup throws', async () => {
    getSession.mockRejectedValue(new Error('database unavailable'))
    const app = createApp(getSession)

    const res = await app.request('/')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
  })
})
