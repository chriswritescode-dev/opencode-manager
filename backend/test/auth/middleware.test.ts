import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { createAuthMiddleware } from '../../src/auth/middleware'
import type { AuthSessionReader } from '../../src/routes/auth'
import type { Session } from '../../src/auth'
import { readJson } from '../helpers/read-json'

const ErrorSchema = z.object({ error: z.string() })
const UserIdSchema = z.object({ userId: z.string() })

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

function createApp(getSession: AuthSessionReader['getSession']) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()
  app.use('/*', createAuthMiddleware({ api: { getSession } }))
  app.get('/', (c) => c.json({ userId: c.get('user').id }))
  return app
}

describe('createAuthMiddleware', () => {
  it('returns 401 when no session is found', async () => {
    const app = createApp(vi.fn(async () => null))

    const res = await app.request('/', { headers: { cookie: 'opencode.session=stale' } })

    expect(res.status).toBe(401)
    expect(await readJson(res, ErrorSchema)).toEqual({ error: 'Unauthorized' })
  })

  it('attaches the session and user and continues to the route', async () => {
    const session = createSession()
    const getSession = vi.fn<AuthSessionReader['getSession']>(async () => session)
    const app = createApp(getSession)

    const res = await app.request('/', { headers: { cookie: 'opencode.session=valid' } })

    expect(res.status).toBe(200)
    expect(await readJson(res, UserIdSchema)).toEqual({ userId: 'user-1' })
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when the session lookup throws', async () => {
    const app = createApp(vi.fn(async () => {
      throw new Error('database unavailable')
    }))

    const res = await app.request('/')

    expect(res.status).toBe(500)
    expect(await readJson(res, ErrorSchema)).toEqual({ error: 'Internal Server Error' })
  })
})
